/**
 * BitTorrent Adapter — wraps WebTorrent
 *
 * Provides DHT-based file sharing through the BitTorrent protocol.
 * No trackers — uses DHT + local service discovery + peer exchange.
 */

import WebTorrent from 'webtorrent'
import { Readable } from 'stream'

import type {
  ProtocolAdapter,
  FileMeta,
  ContentId,
  AdapterHealth,
  AdapterMetrics,
} from './types.js'
import { createEmptyMetrics } from './types.js'

export interface BitTorrentAdapterConfig {
  downloadPath?: string
}

export class BitTorrentAdapter implements ProtocolAdapter {
  readonly name = 'bittorrent'

  private client!: InstanceType<typeof WebTorrent>
  private _metrics: AdapterMetrics = createEmptyMetrics()
  private startTime = Date.now()
  private config: BitTorrentAdapterConfig

  constructor(config: BitTorrentAdapterConfig = {}) {
    this.config = config
  }

  async start(): Promise<void> {
    this.client = new WebTorrent({
      tracker: false,
      dht: true,
      lsd: true,
      utPex: true,
    } as any)

    this.startTime = Date.now()

    // Wait for DHT to be ready
    await new Promise<void>((resolve) => {
      if ((this.client as any).dht) {
        (this.client as any).dht.once('ready', () => resolve())
        // Timeout after 5s — DHT may not have peers yet and that's fine
        setTimeout(resolve, 5000)
      } else {
        resolve()
      }
    })

    console.log('[bittorrent] WebTorrent client ready (DHT-only, no trackers)')
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.destroy((err: any) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // -- Content operations --

  async upload(data: Uint8Array, meta: FileMeta): Promise<ContentId> {
    const start = Date.now()

    const buf = Buffer.from(data) as any
    buf.name = meta.filename || 'file'

    return new Promise((resolve, reject) => {
      this.client.seed(buf, { announceList: [] }, (torrent: any) => {
        const latency = Date.now() - start

        this._metrics.uploads++
        this._metrics.uploadBytes += data.length
        this._metrics.lookups++
        this._metrics.latencies.push(latency)

        resolve({
          id: torrent.infoHash,
          protocol: this.name,
        })
      })
    })
  }

  async download(id: string): Promise<{ data: Uint8Array; sizeBytes: number; latencyMs: number }> {
    const start = Date.now()

    // Check if we're already seeding/have this torrent
    const existing = this.findTorrent(id)
    if (existing) {
      return this.readTorrent(existing, start)
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.client.remove(id, {}, () => {})
        reject(new Error(`Download timed out for infohash: ${id}`))
      }, 30000)

      this.client.add(id, { path: this.config.downloadPath }, (torrent: any) => {
        clearTimeout(timeout)
        this.readTorrent(torrent, start).then(resolve).catch(reject)
      })
    })
  }

  /** Find torrent in client.torrents by infohash (client.get() returns a stripped object) */
  private findTorrent(id: string): any {
    return this.client.torrents.find((t: any) => t.infoHash === id)
  }

  private async readTorrent(
    torrent: any,
    start: number
  ): Promise<{ data: Uint8Array; sizeBytes: number; latencyMs: number }> {
    const file = torrent.files[0]
    if (!file) throw new Error('Torrent has no files')

    // Use arrayBuffer() which works for both seeded and downloaded torrents
    const ab: ArrayBuffer = await file.arrayBuffer()
    const buf = Buffer.from(ab)
    const latency = Date.now() - start

    this._metrics.downloads++
    this._metrics.downloadBytes += buf.length
    this._metrics.latencies.push(latency)

    return { data: new Uint8Array(buf), sizeBytes: buf.length, latencyMs: latency }
  }

  async *stream(id: string): AsyncIterable<Uint8Array> {
    this._metrics.streamRequests++

    const torrent = this.findTorrent(id)
    if (!torrent) {
      throw new Error(`Torrent not found: ${id}`)
    }

    const file = torrent.files[0]
    if (!file) throw new Error('Torrent has no files')

    const nodeStream: Readable = file.createReadStream()
    for await (const chunk of nodeStream) {
      this._metrics.streamChunks++
      yield chunk as Uint8Array
    }
  }

  /**
   * BitTorrent IDs are 40-character hex infohashes or magnet URIs.
   */
  canResolve(id: string): boolean {
    if (/^[a-f0-9]{40}$/i.test(id)) return true
    if (id.startsWith('magnet:')) return true
    return false
  }

  // -- Network --

  async health(): Promise<AdapterHealth> {
    const peerCount = this.getPeerCount()
    this._metrics.peerCounts.push(peerCount)

    return {
      protocol: this.name,
      status: this.client.torrents.length > 0 ? 'ok' : 'degraded',
      peers: peerCount,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    }
  }

  async peers(): Promise<string[]> {
    const allPeers = new Set<string>()
    for (const torrent of this.client.torrents) {
      for (const wire of (torrent as any).wires ?? []) {
        if (wire.remoteAddress) {
          allPeers.add(`${wire.remoteAddress}:${wire.remotePort}`)
        }
      }
    }
    return [...allPeers]
  }

  metrics(): AdapterMetrics {
    return this._metrics
  }

  // -- Helpers --

  private getPeerCount(): number {
    let total = 0
    for (const torrent of this.client.torrents) {
      total += (torrent as any).numPeers ?? 0
    }
    return total
  }
}
