/**
 * Hypercore Adapter — wraps Hyperdrive + Hyperswarm
 *
 * Provides DHT-based file sharing through the Hypercore protocol.
 * Each upload creates a Hyperdrive, seeds it via Hyperswarm.
 * Content IDs are hex-encoded drive public keys.
 */

import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import { Readable } from 'stream'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

import type {
  ProtocolAdapter,
  FileMeta,
  ContentId,
  AdapterHealth,
  AdapterMetrics,
} from './types.js'
import { createEmptyMetrics } from './types.js'

export interface HypercoreAdapterConfig {
  dataDir: string
}

export class HypercoreAdapter implements ProtocolAdapter {
  readonly name = 'hypercore'

  private store!: any
  private swarm!: any
  private drives = new Map<string, any>()  // hex key → Hyperdrive
  private _metrics: AdapterMetrics = createEmptyMetrics()
  private startTime = Date.now()

  constructor(private config: HypercoreAdapterConfig) {}

  async start(): Promise<void> {
    const dir = this.config.dataDir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    this.store = new Corestore(dir)
    this.swarm = new Hyperswarm()

    // Replicate all cores when peers connect
    this.swarm.on('connection', (socket: any) => {
      this.store.replicate(socket)
    })

    this.startTime = Date.now()
    console.log('[hypercore] Corestore + Hyperswarm ready')
  }

  async stop(): Promise<void> {
    await this.swarm.destroy()
    await this.store.close()
  }

  // -- Content operations --

  async upload(data: Uint8Array, meta: FileMeta): Promise<ContentId> {
    const start = Date.now()

    // Create a new drive for this file
    const drive = new Hyperdrive(this.store)
    await drive.ready()

    const filename = meta.filename || 'file'
    await drive.put(`/${filename}`, Buffer.from(data))

    // Seed via swarm
    const discovery = this.swarm.join(drive.discoveryKey)
    await discovery.flushed()

    const key = drive.key.toString('hex')
    this.drives.set(key, drive)

    const latency = Date.now() - start
    this._metrics.uploads++
    this._metrics.uploadBytes += data.length
    this._metrics.lookups++
    this._metrics.latencies.push(latency)

    return { id: key, protocol: this.name }
  }

  async download(id: string): Promise<{ data: Uint8Array; sizeBytes: number; latencyMs: number }> {
    const start = Date.now()
    const drive = await this.getOrLoadDrive(id)

    // List files and read the first one
    const entries: any[] = []
    for await (const entry of drive.list('/')) {
      entries.push(entry)
    }

    if (entries.length === 0) {
      throw new Error('Drive is empty')
    }

    const path = entries[0].key
    const buf = await drive.get(path, { timeout: 15000 })
    if (!buf) throw new Error(`File not found: ${path}`)

    const latency = Date.now() - start
    this._metrics.downloads++
    this._metrics.downloadBytes += buf.length
    this._metrics.latencies.push(latency)

    return { data: new Uint8Array(buf), sizeBytes: buf.length, latencyMs: latency }
  }

  async *stream(id: string): AsyncIterable<Uint8Array> {
    this._metrics.streamRequests++
    const drive = await this.getOrLoadDrive(id)

    const entries: any[] = []
    for await (const entry of drive.list('/')) {
      entries.push(entry)
    }

    if (entries.length === 0) throw new Error('Drive is empty')

    const path = entries[0].key
    const rs: Readable = drive.createReadStream(path)

    for await (const chunk of rs) {
      this._metrics.streamChunks++
      yield chunk as Uint8Array
    }
  }

  /**
   * Hypercore IDs are 64-character hex public keys.
   */
  canResolve(id: string): boolean {
    return /^[a-f0-9]{64}$/i.test(id)
  }

  // -- Network --

  async health(): Promise<AdapterHealth> {
    const peerCount = this.swarm.connections.size
    this._metrics.peerCounts.push(peerCount)

    return {
      protocol: this.name,
      status: this.drives.size > 0 ? 'ok' : 'degraded',
      peers: peerCount,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    }
  }

  async peers(): Promise<string[]> {
    const result: string[] = []
    for (const conn of this.swarm.connections) {
      if (conn.remotePublicKey) {
        result.push(conn.remotePublicKey.toString('hex'))
      }
    }
    return result
  }

  metrics(): AdapterMetrics {
    return this._metrics
  }

  // -- Internal --

  private async getOrLoadDrive(hexKey: string): Promise<any> {
    let drive = this.drives.get(hexKey)
    if (drive) return drive

    // Load remote drive by key
    const key = Buffer.from(hexKey, 'hex')
    drive = new Hyperdrive(this.store, key)
    await drive.ready()

    // Join swarm to discover peers
    const discovery = this.swarm.join(drive.discoveryKey)
    const done = drive.findingPeers()
    await this.swarm.flush()
    done()

    this.drives.set(hexKey, drive)
    return drive
  }
}
