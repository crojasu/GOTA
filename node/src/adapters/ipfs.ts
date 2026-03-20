/**
 * IPFS Adapter — wraps Helia/libp2p
 *
 * Extracted from the original monolithic index.ts.
 * Handles all IPFS-specific operations behind the ProtocolAdapter interface.
 */

import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { FsBlockstore } from 'blockstore-fs'
import { FsDatastore } from 'datastore-fs'
import { CID } from 'multiformats/cid'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import type {
  ProtocolAdapter,
  FileMeta,
  ContentId,
  AdapterHealth,
  AdapterMetrics,
} from './types.js'
import { createEmptyMetrics } from './types.js'

export interface IpfsAdapterConfig {
  port: number
  dataDir: string
  bootstrapPeers?: string[]
}

export class IpfsAdapter implements ProtocolAdapter {
  readonly name = 'ipfs'

  private helia!: Awaited<ReturnType<typeof createHelia>>
  private fs!: ReturnType<typeof unixfs>
  private libp2p!: Awaited<ReturnType<typeof createLibp2p>>
  private _metrics: AdapterMetrics = createEmptyMetrics()
  private startTime = Date.now()

  constructor(private config: IpfsAdapterConfig) {}

  async start(): Promise<void> {
    const { port, dataDir, bootstrapPeers = [] } = this.config

    // Ensure storage dirs exist
    for (const sub of ['', 'blocks', 'data']) {
      const dir = sub ? join(dataDir, sub) : dataDir
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }

    const blockstore = new FsBlockstore(join(dataDir, 'blocks'))
    const datastore = new FsDatastore(join(dataDir, 'data'))

    this.libp2p = await createLibp2p({
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${port + 1000}`],
      },
      transports: [tcp()],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        dht: kadDHT({ clientMode: false }),
        mdns: mdns(),
        ...(bootstrapPeers.length > 0
          ? { bootstrap: bootstrap({ list: bootstrapPeers }) }
          : {}),
      },
      datastore,
    })

    this.helia = await createHelia({
      libp2p: this.libp2p as any,
      blockstore,
      datastore,
    })
    this.fs = unixfs(this.helia)

    this.startTime = Date.now()
    console.log(`[ipfs] P2P listening on port ${port + 1000}`)
    console.log(`[ipfs] Node ID: ${this.libp2p.peerId.toString()}`)
  }

  async stop(): Promise<void> {
    await this.helia.stop()
  }

  // -- Content operations --

  async upload(data: Uint8Array, meta: FileMeta): Promise<ContentId> {
    const start = Date.now()
    const cid = await this.fs.addBytes(data)
    const latency = Date.now() - start

    this._metrics.uploads++
    this._metrics.uploadBytes += data.length
    this._metrics.lookups++
    this._metrics.latencies.push(latency)

    return { id: cid.toString(), protocol: this.name }
  }

  async download(id: string): Promise<{ data: Uint8Array; sizeBytes: number; latencyMs: number }> {
    const cid = CID.parse(id)
    const start = Date.now()

    const chunks: Uint8Array[] = []
    for await (const chunk of this.fs.cat(cid)) {
      chunks.push(chunk)
    }
    const latency = Date.now() - start

    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0)
    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    this._metrics.downloads++
    this._metrics.downloadBytes += totalSize
    this._metrics.latencies.push(latency)

    return { data: combined, sizeBytes: totalSize, latencyMs: latency }
  }

  async *stream(id: string): AsyncIterable<Uint8Array> {
    const cid = CID.parse(id)
    this._metrics.streamRequests++

    for await (const chunk of this.fs.cat(cid)) {
      this._metrics.streamChunks++
      yield chunk
    }
  }

  canResolve(id: string): boolean {
    try {
      CID.parse(id)
      return true
    } catch {
      return false
    }
  }

  // -- Network --

  async health(): Promise<AdapterHealth> {
    const peerCount = this.libp2p.getPeers().length
    this._metrics.peerCounts.push(peerCount)

    return {
      protocol: this.name,
      status: peerCount > 0 ? 'ok' : 'degraded',
      peers: peerCount,
      nodeId: this.libp2p.peerId.toString(),
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    }
  }

  async peers(): Promise<string[]> {
    return this.libp2p.getPeers().map(p => p.toString())
  }

  metrics(): AdapterMetrics {
    return this._metrics
  }

  async connect(multiaddr: string): Promise<void> {
    const { multiaddr: ma } = await import('@multiformats/multiaddr')
    const addr = ma(multiaddr)
    await this.libp2p.dial(addr as any)
  }

  /** Get libp2p multiaddrs for this node (used by /health) */
  getMultiaddrs(): string[] {
    return this.libp2p.getMultiaddrs().map(m => m.toString())
  }
}
