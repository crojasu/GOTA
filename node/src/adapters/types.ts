/**
 * Protocol Adapter Interface
 *
 * Every P2P protocol (IPFS, BitTorrent, Hypercore) implements this interface.
 * The gateway API delegates to adapters without knowing which protocol is underneath.
 */

export interface FileMeta {
  filename: string
  mimeType?: string
  sizeBytes?: number
}

export interface ContentId {
  /** Protocol-specific ID (CID for IPFS, infohash for BitTorrent, key for Hypercore) */
  id: string
  /** Which protocol produced this ID */
  protocol: string
}

export interface SearchResult {
  id: string
  protocol: string
  filename?: string
  sizeBytes?: number
  peers?: number
}

export interface AdapterHealth {
  protocol: string
  status: 'ok' | 'degraded' | 'offline'
  peers: number
  nodeId?: string
  uptime?: number
}

export interface AdapterMetrics {
  uploads: number
  downloads: number
  uploadBytes: number
  downloadBytes: number
  lookups: number
  latencies: number[]
  peerCounts: number[]
  streamRequests: number
  streamChunks: number
}

export function createEmptyMetrics(): AdapterMetrics {
  return {
    uploads: 0,
    downloads: 0,
    uploadBytes: 0,
    downloadBytes: 0,
    lookups: 0,
    latencies: [],
    peerCounts: [],
    streamRequests: 0,
    streamChunks: 0,
  }
}

export interface ProtocolAdapter {
  readonly name: string

  /** Initialize the adapter (start node, connect to network) */
  start(): Promise<void>

  /** Graceful shutdown */
  stop(): Promise<void>

  // -- Content operations --

  upload(data: Uint8Array, meta: FileMeta): Promise<ContentId>
  download(id: string): Promise<{ data: Uint8Array; sizeBytes: number; latencyMs: number }>
  stream(id: string): AsyncIterable<Uint8Array>

  // -- Discovery --

  /** Check if this adapter can resolve the given ID format */
  canResolve(id: string): boolean

  // -- Network --

  health(): Promise<AdapterHealth>
  peers(): Promise<string[]>
  metrics(): AdapterMetrics

  // -- Optional: direct connect for testing --

  connect?(multiaddr: string): Promise<void>
}
