/**
 * Protocol Registry
 *
 * Routes operations to the correct adapter based on content ID format
 * or broadcasts across all adapters (e.g., upload to multiple networks).
 */

import type {
  ProtocolAdapter,
  FileMeta,
  ContentId,
  AdapterHealth,
  AdapterMetrics,
} from './types.js'

export class ProtocolRegistry {
  private adapters = new Map<string, ProtocolAdapter>()

  register(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  get(name: string): ProtocolAdapter | undefined {
    return this.adapters.get(name)
  }

  all(): ProtocolAdapter[] {
    return [...this.adapters.values()]
  }

  names(): string[] {
    return [...this.adapters.keys()]
  }

  /** Find which adapter can resolve this content ID */
  resolve(id: string): ProtocolAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canResolve(id)) return adapter
    }
    return undefined
  }

  /** Upload to a specific protocol, or default to the first registered */
  async upload(
    data: Uint8Array,
    meta: FileMeta,
    protocol?: string
  ): Promise<ContentId> {
    const adapter = protocol
      ? this.adapters.get(protocol)
      : this.adapters.values().next().value

    if (!adapter) {
      throw new Error(`No adapter found for protocol: ${protocol ?? 'default'}`)
    }
    return adapter.upload(data, meta)
  }

  /** Upload to ALL registered protocols for maximum resilience */
  async uploadToAll(
    data: Uint8Array,
    meta: FileMeta
  ): Promise<ContentId[]> {
    const results: ContentId[] = []
    for (const adapter of this.adapters.values()) {
      try {
        results.push(await adapter.upload(data, meta))
      } catch (err) {
        console.error(`[registry] Upload failed on ${adapter.name}:`, err)
      }
    }
    return results
  }

  /** Download from whichever adapter recognizes the ID */
  async download(id: string): Promise<{
    data: Uint8Array
    sizeBytes: number
    latencyMs: number
    protocol: string
  }> {
    const adapter = this.resolve(id)
    if (!adapter) {
      throw new Error(`No adapter can resolve ID: ${id}`)
    }
    const result = await adapter.download(id)
    return { ...result, protocol: adapter.name }
  }

  /** Stream from whichever adapter recognizes the ID */
  async *stream(id: string): AsyncIterable<Uint8Array> {
    const adapter = this.resolve(id)
    if (!adapter) {
      throw new Error(`No adapter can resolve ID: ${id}`)
    }
    yield* adapter.stream(id)
  }

  /** Health of all adapters */
  async health(): Promise<AdapterHealth[]> {
    return Promise.all(this.all().map(a => a.health()))
  }

  /** Aggregated metrics across all adapters */
  aggregateMetrics(): Record<string, AdapterMetrics> {
    const result: Record<string, AdapterMetrics> = {}
    for (const [name, adapter] of this.adapters) {
      result[name] = adapter.metrics()
    }
    return result
  }

  /** Start all adapters */
  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start()
    }
  }

  /** Stop all adapters */
  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop()
    }
  }
}
