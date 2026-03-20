/**
 * GOTA Gateway — Unified P2P Portal
 *
 * Protocol-agnostic REST API that routes operations across
 * multiple P2P networks (IPFS, BitTorrent, Hypercore).
 *
 * Phase 1: IPFS adapter (extracted from original monolith)
 * Phase 2: BitTorrent adapter (WebTorrent)
 * Phase 3: PWA frontend
 * Phase 4: Hypercore adapter
 */

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import os from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { ProtocolRegistry } from './adapters/registry.js'
import { IpfsAdapter } from './adapters/ipfs.js'
import { BitTorrentAdapter } from './adapters/bittorrent.js'
import { HypercoreAdapter } from './adapters/hypercore.js'
import * as circles from './circles.js'

// ── Config ────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000')
const DATA_DIR = process.env.DATA_DIR ?? join(os.tmpdir(), `gota-node-${PORT}`)
const BOOTSTRAP_PEERS = process.env.BOOTSTRAP_PEERS?.split(',').filter(Boolean) ?? []

// ── Protocol registry ─────────────────────────────────────────────

const registry = new ProtocolRegistry()

registry.register(new IpfsAdapter({
  port: PORT,
  dataDir: join(DATA_DIR, 'ipfs'),
  bootstrapPeers: BOOTSTRAP_PEERS,
}))

registry.register(new BitTorrentAdapter({
  downloadPath: join(DATA_DIR, 'torrents'),
}))

registry.register(new HypercoreAdapter({
  dataDir: join(DATA_DIR, 'hypercore'),
}))

// ── Circle metrics (protocol-agnostic) ────────────────────────────

const circleMetrics = {
  circlesCreated: 0,
  invitesSent: 0,
  recoveryAttempts: 0,
  recoverySuccesses: 0,
}

// ── API ───────────────────────────────────────────────────────────

const app = Fastify({ logger: false })

// ── Serve PWA ─────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'web'),
  prefix: '/',
  decorateReply: false,
})

/**
 * GET /health
 * Gateway health — shows status of all protocol adapters.
 */
app.get('/health', async () => {
  const adaptersHealth = await registry.health()
  const ipfs = registry.get('ipfs') as IpfsAdapter | undefined

  return {
    status: 'ok',
    gateway: {
      protocols: registry.names(),
      uptime: Math.round((Date.now() - startTime) / 1000),
    },
    adapters: adaptersHealth,
    // Backwards compatibility: flat fields the simulation expects
    nodeId: adaptersHealth[0]?.nodeId,
    peers: adaptersHealth.reduce((sum, a) => sum + a.peers, 0),
    peerAddresses: ipfs?.getMultiaddrs() ?? [],
    uptime: adaptersHealth[0]?.uptime ?? 0,
  }
})

/**
 * POST /upload
 * Upload a file. Routes to specified protocol or default (IPFS).
 * Body: { content: string (base64), filename: string, circleId?: string, protocol?: string }
 */
app.post<{
  Body: { content: string; filename: string; circleId?: string; protocol?: string }
}>('/upload', async (req, reply) => {
  const { content, filename, circleId, protocol } = req.body

  if (!content || !filename) {
    return reply.code(400).send({ error: 'content and filename required' })
  }

  let data = uint8ArrayFromString(content, 'base64')

  // Encrypt for circle (protocol-agnostic — before routing)
  if (circleId) {
    const encrypted = circles.encryptForCircle(data, circleId)
    if (!encrypted) {
      return reply.code(403).send({ error: `Circle ${circleId} not found` })
    }
    data = encrypted
  }

  const result = await registry.upload(data, { filename }, protocol)

  return {
    cid: result.id,
    protocol: result.protocol,
    filename,
    circleId: circleId ?? null,
    sizeBytes: data.length,
    peers: (await registry.health()).reduce((sum, a) => sum + a.peers, 0),
    encrypted: !!circleId,
  }
})

/**
 * POST /upload/all
 * Upload to ALL protocols for maximum resilience.
 * Body: { content: string (base64), filename: string, circleId?: string }
 */
app.post<{
  Body: { content: string; filename: string; circleId?: string }
}>('/upload/all', async (req, reply) => {
  const { content, filename, circleId } = req.body

  if (!content || !filename) {
    return reply.code(400).send({ error: 'content and filename required' })
  }

  let data = uint8ArrayFromString(content, 'base64')

  if (circleId) {
    const encrypted = circles.encryptForCircle(data, circleId)
    if (!encrypted) {
      return reply.code(403).send({ error: `Circle ${circleId} not found` })
    }
    data = encrypted
  }

  const results = await registry.uploadToAll(data, { filename })

  return {
    ids: results,
    filename,
    circleId: circleId ?? null,
    sizeBytes: data.length,
    protocols: results.map(r => r.protocol),
  }
})

/**
 * GET /download/:id
 * Download by content ID. Auto-detects which protocol to use.
 */
app.get<{
  Params: { id: string }
  Querystring: { circleId?: string }
}>('/download/:id', async (req, reply) => {
  const { id } = req.params
  const { circleId } = req.query

  if (circleId && !circles.getCircle(circleId)) {
    return reply.code(403).send({ error: 'Circle not found or access denied' })
  }

  try {
    const result = await registry.download(id)
    return {
      cid: id,
      protocol: result.protocol,
      content: uint8ArrayToString(result.data, 'base64'),
      sizeBytes: result.sizeBytes,
      dhtLatencyMs: result.latencyMs,
      peers: (await registry.health()).reduce((sum, a) => sum + a.peers, 0),
    }
  } catch {
    return reply.code(404).send({
      error: 'Content not found on any protocol',
      id,
      protocols: registry.names(),
    })
  }
})

/**
 * GET /stream/:id
 * Stream a file in chunks. Auto-detects protocol.
 */
app.get<{
  Params: { id: string }
}>('/stream/:id', async (req, reply) => {
  const { id } = req.params

  const adapter = registry.resolve(id)
  if (!adapter) {
    return reply.code(400).send({ error: `No protocol can resolve ID: ${id}` })
  }

  const streamStart = Date.now()
  const chunkTimings: number[] = []
  const allChunks: Uint8Array[] = []

  try {
    for await (const chunk of adapter.stream(id)) {
      allChunks.push(chunk)
      chunkTimings.push(Date.now() - streamStart)
    }

    const totalSize = allChunks.reduce((acc, c) => acc + c.length, 0)
    const totalTime = Date.now() - streamStart
    const throughputMBps = totalTime > 0
      ? (totalSize / 1024 / 1024) / (totalTime / 1000)
      : 0

    return {
      id,
      protocol: adapter.name,
      totalSizeBytes: totalSize,
      chunks: allChunks.length,
      totalTimeMs: totalTime,
      throughputMBps: Math.round(throughputMBps * 100) / 100,
      timeToFirstChunkMs: chunkTimings[0] ?? 0,
      chunkTimings,
    }
  } catch {
    return reply.code(404).send({ error: 'Content not found for streaming' })
  }
})

// ── Circle endpoints (protocol-agnostic) ──────────────────────────

app.post('/identity', async () => {
  const { id, identity } = circles.createIdentity()
  return { id, publicKey: identity.publicKey, secretKey: identity.secretKey }
})

app.post<{
  Body: { name: string; adminId: string }
}>('/circle/create', async (req, reply) => {
  const result = circles.createCircle(req.body.name, req.body.adminId)
  if ('error' in result) {
    return reply.code(404).send({ error: result.error })
  }
  circleMetrics.circlesCreated++
  return {
    circleId: result.circleId,
    name: result.circle.name,
    adminId: req.body.adminId,
    members: 1,
  }
})

app.post<{
  Params: { circleId: string }
  Body: { inviteePublicKey: string; adminId: string }
}>('/circle/:circleId/invite', async (req, reply) => {
  const result = circles.inviteToCircle(
    req.params.circleId,
    req.body.inviteePublicKey,
    req.body.adminId
  )
  if ('error' in result) {
    return reply.code(result.status ?? 500).send({ error: result.error })
  }
  circleMetrics.invitesSent++
  return {
    circleId: req.params.circleId,
    inviteePublicKey: req.body.inviteePublicKey,
    invitePayload: result.invitePayload,
    members: result.members,
  }
})

app.post<{
  Params: { circleId: string }
  Body: { newPublicKey: string; adminId: string; lostPublicKey: string }
}>('/circle/:circleId/recover', async (req, reply) => {
  circleMetrics.recoveryAttempts++
  const result = circles.recoverAccess(
    req.params.circleId,
    req.body.newPublicKey,
    req.body.adminId,
    req.body.lostPublicKey
  )
  if ('error' in result) {
    return reply.code(result.status ?? 500).send({ error: result.error })
  }
  circleMetrics.recoverySuccesses++
  return {
    circleId: req.params.circleId,
    newPublicKey: req.body.newPublicKey,
    recoveryPayload: result.recoveryPayload,
    members: result.members,
  }
})

// ── Network endpoints ─────────────────────────────────────────────

app.post<{
  Body: { multiaddr: string }
}>('/connect', async (req, reply) => {
  const { multiaddr } = req.body
  if (!multiaddr) return reply.code(400).send({ error: 'multiaddr required' })

  // Try IPFS adapter (the only one with connect support for now)
  const ipfs = registry.get('ipfs')
  if (!ipfs?.connect) {
    return reply.code(501).send({ error: 'No adapter supports direct connect' })
  }

  try {
    await ipfs.connect(multiaddr)
    const health = await registry.health()
    return {
      success: true,
      connectedTo: multiaddr,
      totalPeers: health.reduce((sum, a) => sum + a.peers, 0),
    }
  } catch (err: any) {
    return reply.code(500).send({ error: err.message })
  }
})

app.get('/peers', async () => {
  const allPeers: Record<string, string[]> = {}
  for (const adapter of registry.all()) {
    allPeers[adapter.name] = await adapter.peers()
  }
  const total = Object.values(allPeers).reduce((sum, p) => sum + p.length, 0)

  return {
    count: total,
    byProtocol: allPeers,
    // Backwards compat
    peers: allPeers['ipfs'] ?? [],
    multiaddrs: (registry.get('ipfs') as IpfsAdapter)?.getMultiaddrs() ?? [],
  }
})

/**
 * GET /metrics
 * Aggregated metrics across all protocols + circle metrics.
 */
app.get('/metrics', async () => {
  const perAdapter = registry.aggregateMetrics()
  const health = await registry.health()

  // Aggregate for backwards compat
  const allLatencies = Object.values(perAdapter).flatMap(m => m.latencies)
  const avgLatency = allLatencies.length > 0
    ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
    : 0

  return {
    gateway: {
      protocols: registry.names(),
      perAdapter,
    },
    researchMetrics: {
      rq1_dht_resilience: {
        totalLookups: Object.values(perAdapter).reduce((sum, m) => sum + m.lookups, 0),
        avgLatencyMs: Math.round(avgLatency),
        avgPeerCount: health.reduce((sum, a) => sum + a.peers, 0),
      },
      rq2_access_control: {
        ...circleMetrics,
        recoverySuccessRate: circleMetrics.recoveryAttempts > 0
          ? Math.round(circleMetrics.recoverySuccesses / circleMetrics.recoveryAttempts * 100)
          : null,
      },
      rq3_streaming: {
        streamRequests: Object.values(perAdapter).reduce((sum, m) => sum + m.streamRequests, 0),
        totalChunks: Object.values(perAdapter).reduce((sum, m) => sum + m.streamChunks, 0),
      },
    },
    operational: {
      uptime: Math.round((Date.now() - startTime) / 1000),
      uploads: Object.values(perAdapter).reduce((sum, m) => sum + m.uploads, 0),
      downloads: Object.values(perAdapter).reduce((sum, m) => sum + m.downloads, 0),
      totalBytesProcessed: Object.values(perAdapter).reduce(
        (sum, m) => sum + m.uploadBytes + m.downloadBytes, 0
      ),
      currentPeers: health.reduce((sum, a) => sum + a.peers, 0),
      nodeId: health[0]?.nodeId,
    },
  }
})

/**
 * GET /protocols
 * List available protocols and their status. New endpoint for the gateway.
 */
app.get('/protocols', async () => {
  const health = await registry.health()
  return {
    available: health.map(h => ({
      name: h.protocol,
      status: h.status,
      peers: h.peers,
    })),
  }
})

// ── Start ─────────────────────────────────────────────────────────

const startTime = Date.now()

console.log('Starting GOTA gateway...')
await registry.startAll()
await app.listen({ port: PORT, host: '0.0.0.0' })

console.log(`GOTA gateway running on port ${PORT}`)
console.log(`Protocols: ${registry.names().join(', ')}`)
console.log(`Data dir: ${DATA_DIR}`)
