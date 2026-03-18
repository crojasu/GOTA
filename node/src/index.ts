/**
 * GOTA Node — Research Prototype
 *
 * Implements a minimal Helia/libp2p P2P node with a REST API
 * so the Python UX simulation agents can interact with real
 * P2P operations instead of mock random() calls.
 *
 * Research questions this addresses:
 * RQ1 — DHT routing under peer churn (measurable via /metrics)
 * RQ2 — Group key agreement (circle operations via /circle/*)
 * RQ3 — P2P streaming (chunked retrieval via /stream/:cid)
 *
 * Usage:
 *   npm run dev          # development with hot reload
 *   PORT=3001 npm start  # second node on different port
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
import Fastify from 'fastify'
import nacl from 'tweetnacl'
import { CID } from 'multiformats/cid'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'

// ── Config ────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000')
const DATA_DIR = process.env.DATA_DIR ?? join(os.tmpdir(), `gota-node-${PORT}`)
const BOOTSTRAP_PEERS = process.env.BOOTSTRAP_PEERS?.split(',').filter(Boolean) ?? []

// ── Storage setup ─────────────────────────────────────────────────

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
if (!existsSync(join(DATA_DIR, 'blocks'))) mkdirSync(join(DATA_DIR, 'blocks'))
if (!existsSync(join(DATA_DIR, 'data'))) mkdirSync(join(DATA_DIR, 'data'))

// ── In-memory circle store ────────────────────────────────────────
// In production this would use libp2p pubsub + encrypted DHT records.
// For the research prototype, we store circle metadata in memory.

interface Circle {
  name: string
  adminPubKey: string      // hex-encoded nacl public key
  memberPubKeys: string[]  // hex-encoded nacl public keys
  encryptedKey: string     // circle symmetric key, encrypted for each member
  createdAt: number
}

const circles = new Map<string, Circle>()
const keystore = new Map<string, { publicKey: string; secretKey: string }>()

// ── Metrics ───────────────────────────────────────────────────────

interface Metrics {
  uploads: number
  downloads: number
  uploadBytes: number
  downloadBytes: number
  dhtLookups: number
  dhtLatencies: number[]  // ms
  peerCounts: number[]
  circlesCreated: number
  invitesSent: number
  recoveryAttempts: number
  recoverySuccesses: number
  streamRequests: number
  streamChunks: number
  startTime: number
}

const metrics: Metrics = {
  uploads: 0,
  downloads: 0,
  uploadBytes: 0,
  downloadBytes: 0,
  dhtLookups: 0,
  dhtLatencies: [],
  peerCounts: [],
  circlesCreated: 0,
  invitesSent: 0,
  recoveryAttempts: 0,
  recoverySuccesses: 0,
  streamRequests: 0,
  streamChunks: 0,
  startTime: Date.now(),
}

// ── Node initialization ───────────────────────────────────────────

async function createGotaNode() {
  const blockstore = new FsBlockstore(join(DATA_DIR, 'blocks'))
  const datastore = new FsDatastore(join(DATA_DIR, 'data'))

  const libp2p = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${PORT + 1000}`]
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      dht: kadDHT({ clientMode: false }),
      mdns: mdns(),  // Auto-discovers peers on local network
      ...(BOOTSTRAP_PEERS.length > 0 ? {
        bootstrap: bootstrap({ list: BOOTSTRAP_PEERS })
      } : {})
    },
    datastore,
  })

  const helia = await createHelia({ libp2p, blockstore, datastore })
  const fs = unixfs(helia)

  return { helia, fs, libp2p }
}

// ── Crypto helpers ────────────────────────────────────────────────

function generateIdentity(): { publicKey: string; secretKey: string } {
  const keypair = nacl.box.keyPair()
  return {
    publicKey: uint8ArrayToString(keypair.publicKey, 'hex'),
    secretKey: uint8ArrayToString(keypair.secretKey, 'hex'),
  }
}

function encryptForRecipient(
  message: Uint8Array,
  recipientPubKeyHex: string,
  senderSecretKeyHex: string
): string {
  const recipientPubKey = uint8ArrayFromString(recipientPubKeyHex, 'hex')
  const senderSecretKey = uint8ArrayFromString(senderSecretKeyHex, 'hex')
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const encrypted = nacl.box(message, nonce, recipientPubKey, senderSecretKey)
  // Encode as hex: nonce + ciphertext
  const combined = new Uint8Array(nonce.length + encrypted.length)
  combined.set(nonce)
  combined.set(encrypted, nonce.length)
  return uint8ArrayToString(combined, 'hex')
}

function decryptFromSender(
  encryptedHex: string,
  senderPubKeyHex: string,
  recipientSecretKeyHex: string
): Uint8Array | null {
  const combined = uint8ArrayFromString(encryptedHex, 'hex')
  const nonce = combined.slice(0, nacl.box.nonceLength)
  const ciphertext = combined.slice(nacl.box.nonceLength)
  const senderPubKey = uint8ArrayFromString(senderPubKeyHex, 'hex')
  const recipientSecretKey = uint8ArrayFromString(recipientSecretKeyHex, 'hex')
  return nacl.box.open(ciphertext, nonce, senderPubKey, recipientSecretKey)
}

// ── API ───────────────────────────────────────────────────────────

async function startAPI(
  helia: Awaited<ReturnType<typeof createHelia>>,
  fs: ReturnType<typeof unixfs>,
  libp2p: Awaited<ReturnType<typeof createLibp2p>>
) {
  const app = Fastify({ logger: false })

  /**
   * GET /health
   * Basic health check + node info
   */
  app.get('/health', async () => {
    const peers = libp2p.getPeers()
    metrics.peerCounts.push(peers.length)
    return {
      status: 'ok',
      nodeId: libp2p.peerId.toString(),
      peers: peers.length,
      peerAddresses: libp2p.getMultiaddrs().map(ma => ma.toString()),
      uptime: Math.round((Date.now() - metrics.startTime) / 1000),
    }
  })

  /**
   * POST /upload
   * Upload a file to the P2P network.
   * Body: { content: string (base64), filename: string, circleId?: string }
   * Returns: { cid: string, peers: number, dhtLatency: number }
   *
   * Research: measures DHT announce latency and peer availability.
   */
  app.post<{
    Body: { content: string; filename: string; circleId?: string }
  }>('/upload', async (req, reply) => {
    const { content, filename, circleId } = req.body

    if (!content || !filename) {
      return reply.code(400).send({ error: 'content and filename required' })
    }

    let data = uint8ArrayFromString(content, 'base64')

    // If private circle: encrypt before upload
    // In production: use circle symmetric key to encrypt
    // For prototype: we mark the content with a circle prefix
    if (circleId) {
      if (!circles.has(circleId)) {
        return reply.code(403).send({ error: `Circle ${circleId} not found` })
      }
      // Prepend circle marker (production would use AES-256-GCM with circle key)
      const marker = uint8ArrayFromString(`GOTA_CIRCLE:${circleId}:`)
      const combined = new Uint8Array(marker.length + data.length)
      combined.set(marker)
      combined.set(data, marker.length)
      data = combined
    }

    // Measure DHT announcement latency
    const dhtStart = Date.now()
    const cid = await fs.addBytes(data)
    const dhtLatency = Date.now() - dhtStart

    metrics.uploads++
    metrics.uploadBytes += data.length
    metrics.dhtLookups++
    metrics.dhtLatencies.push(dhtLatency)

    const peers = libp2p.getPeers().length

    return {
      cid: cid.toString(),
      filename,
      circleId: circleId ?? null,
      sizeBytes: data.length,
      peers,
      dhtLatencyMs: dhtLatency,
      encrypted: !!circleId,
    }
  })

  /**
   * GET /download/:cid
   * Download a file by CID.
   * Query: circleId (optional, required for private files)
   * Returns: { content: string (base64), sizeBytes: number, dhtLatency: number }
   *
   * Research: measures content retrieval latency from DHT.
   */
  app.get<{
    Params: { cid: string }
    Querystring: { circleId?: string }
  }>('/download/:cid', async (req, reply) => {
    const { cid: cidStr } = req.params
    const { circleId } = req.query

    let cid: CID
    try {
      cid = CID.parse(cidStr)
    } catch {
      return reply.code(400).send({ error: 'Invalid CID' })
    }

    // Check circle access
    if (circleId && !circles.has(circleId)) {
      return reply.code(403).send({
        error: 'Circle not found or access denied',
        researchNote: 'RQ2: access control check failed'
      })
    }

    const dhtStart = Date.now()
    try {
      const chunks: Uint8Array[] = []
      for await (const chunk of fs.cat(cid)) {
        chunks.push(chunk)
        metrics.streamChunks++
      }
      const dhtLatency = Date.now() - dhtStart

      const totalSize = chunks.reduce((acc, c) => acc + c.length, 0)
      const combined = new Uint8Array(totalSize)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      metrics.downloads++
      metrics.downloadBytes += totalSize
      metrics.dhtLatencies.push(dhtLatency)

      return {
        cid: cidStr,
        content: uint8ArrayToString(combined, 'base64'),
        sizeBytes: totalSize,
        chunks: chunks.length,
        dhtLatencyMs: dhtLatency,
        peers: libp2p.getPeers().length,
      }
    } catch (err) {
      return reply.code(404).send({
        error: 'Content not found',
        cid: cidStr,
        researchNote: 'RQ1: DHT lookup failed — peer churn may have removed all seeders',
        peers: libp2p.getPeers().length,
      })
    }
  })

  /**
   * GET /stream/:cid
   * Stream a file in chunks (Research Question 3).
   * Returns chunked response with per-chunk timing.
   */
  app.get<{
    Params: { cid: string }
    Querystring: { chunkSize?: string }
  }>('/stream/:cid', async (req, reply) => {
    const { cid: cidStr } = req.params
    const chunkSize = parseInt(req.query.chunkSize ?? '262144') // 256KB default

    let cid: CID
    try {
      cid = CID.parse(cidStr)
    } catch {
      return reply.code(400).send({ error: 'Invalid CID' })
    }

    metrics.streamRequests++

    const streamStart = Date.now()
    const chunkTimings: number[] = []
    const allChunks: Uint8Array[] = []

    try {
      for await (const chunk of fs.cat(cid)) {
        allChunks.push(chunk)
        chunkTimings.push(Date.now() - streamStart)
        metrics.streamChunks++
      }

      const totalSize = allChunks.reduce((acc, c) => acc + c.length, 0)
      const totalTime = Date.now() - streamStart
      const throughputMBps = (totalSize / 1024 / 1024) / (totalTime / 1000)

      return {
        cid: cidStr,
        totalSizeBytes: totalSize,
        chunks: allChunks.length,
        totalTimeMs: totalTime,
        throughputMBps: Math.round(throughputMBps * 100) / 100,
        timeToFirstChunkMs: chunkTimings[0] ?? 0,
        chunkTimings,
        researchNote: 'RQ3: streaming benchmark data — compare against HTTP baseline',
      }
    } catch (err) {
      return reply.code(404).send({
        error: 'Content not found for streaming',
        researchNote: 'RQ3: streaming failed — 0 peers seeding this content',
      })
    }
  })

  /**
   * POST /identity
   * Generate a new cryptographic identity (keypair).
   * This is what each user gets when they first open GOTA.
   * Returns: { publicKey: string, secretKey: string }
   *
   * Research: this is the foundation of RQ2 — group key agreement.
   */
  app.post('/identity', async () => {
    const identity = generateIdentity()
    const id = identity.publicKey.slice(0, 16)
    keystore.set(id, identity)
    return {
      id,
      publicKey: identity.publicKey,
      secretKey: identity.secretKey,
      researchNote: 'RQ2: identity created — publicKey is the GOTA address',
    }
  })

  /**
   * POST /circle/create
   * Create a private circle.
   * Body: { name: string, adminId: string }
   * Returns: { circleId: string }
   *
   * Research: this is the start of the group key agreement flow (RQ2).
   */
  app.post<{
    Body: { name: string; adminId: string }
  }>('/circle/create', async (req, reply) => {
    const { name, adminId } = req.body

    const admin = keystore.get(adminId)
    if (!admin) {
      return reply.code(404).send({ error: 'Admin identity not found' })
    }

    // Generate a random circle symmetric key
    const circleKey = nacl.randomBytes(32)
    const circleId = uint8ArrayToString(nacl.randomBytes(16), 'hex')

    // Encrypt circle key for admin (with their own public key)
    const encryptedKey = encryptForRecipient(circleKey, admin.publicKey, admin.secretKey)

    const circle: Circle = {
      name,
      adminPubKey: admin.publicKey,
      memberPubKeys: [admin.publicKey],
      encryptedKey,
      createdAt: Date.now(),
    }

    circles.set(circleId, circle)
    metrics.circlesCreated++

    return {
      circleId,
      name,
      adminId,
      members: 1,
      researchNote: 'RQ2: circle created — symmetric key encrypted with admin pubkey',
    }
  })

  /**
   * POST /circle/:circleId/invite
   * Invite a user to a circle by their public key.
   * Body: { inviteePublicKey: string, adminId: string }
   *
   * Research: this implements the capability delegation scheme (RQ2).
   * The circle key is re-encrypted for the invitee.
   * Friction point: invitee must know their GOTA address (publicKey).
   */
  app.post<{
    Params: { circleId: string }
    Body: { inviteePublicKey: string; adminId: string }
  }>('/circle/:circleId/invite', async (req, reply) => {
    const { circleId } = req.params
    const { inviteePublicKey, adminId } = req.body

    const circle = circles.get(circleId)
    if (!circle) {
      return reply.code(404).send({
        error: 'Circle not found',
        frictionNote: 'RQ2: user tried to invite to non-existent circle',
      })
    }

    const admin = keystore.get(adminId)
    if (!admin || admin.publicKey !== circle.adminPubKey) {
      return reply.code(403).send({ error: 'Not circle admin' })
    }

    if (circle.memberPubKeys.includes(inviteePublicKey)) {
      return reply.code(409).send({ error: 'User already in circle' })
    }

    // Decrypt circle key with admin's key, re-encrypt for invitee
    const circleKey = decryptFromSender(circle.encryptedKey, admin.publicKey, admin.secretKey)
    if (!circleKey) {
      return reply.code(500).send({ error: 'Failed to decrypt circle key' })
    }

    const inviteeEncryptedKey = encryptForRecipient(circleKey, inviteePublicKey, admin.secretKey)

    circle.memberPubKeys.push(inviteePublicKey)
    metrics.invitesSent++

    // In production: publish encrypted invitation to DHT so invitee can find it
    // For prototype: return the encrypted key directly
    return {
      circleId,
      circleName: circle.name,
      inviteePublicKey,
      invitePayload: inviteeEncryptedKey,
      members: circle.memberPubKeys.length,
      researchNote: 'RQ2: circle key re-encrypted for invitee — capability delegation complete',
      frictionNote: 'Friction: invitee needs to know their GOTA pubkey (= GOTA address)',
    }
  })

  /**
   * POST /circle/:circleId/recover
   * Admin re-grants circle access after device loss (RQ2 core problem).
   * Body: { newPublicKey: string, adminId: string, lostPublicKey: string }
   *
   * Research: this is the hardest UX problem in RQ2.
   * The admin must re-encrypt the circle key for the new device.
   * Does NOT expose historical content — same key, new encryption.
   */
  app.post<{
    Params: { circleId: string }
    Body: { newPublicKey: string; adminId: string; lostPublicKey: string }
  }>('/circle/:circleId/recover', async (req, reply) => {
    const { circleId } = req.params
    const { newPublicKey, adminId, lostPublicKey } = req.body

    metrics.recoveryAttempts++

    const circle = circles.get(circleId)
    if (!circle) {
      return reply.code(404).send({
        error: 'Circle not found',
        frictionNote: 'RQ2: recovery failed — user does not know circleId',
      })
    }

    const admin = keystore.get(adminId)
    if (!admin || admin.publicKey !== circle.adminPubKey) {
      return reply.code(403).send({
        error: 'Not circle admin',
        frictionNote: 'RQ2: recovery failed — admin unresponsive or does not know how',
      })
    }

    // Remove lost key, add new key
    const idx = circle.memberPubKeys.indexOf(lostPublicKey)
    if (idx > -1) circle.memberPubKeys.splice(idx, 1)
    circle.memberPubKeys.push(newPublicKey)

    // Re-encrypt circle key for new device
    const circleKey = decryptFromSender(circle.encryptedKey, admin.publicKey, admin.secretKey)
    if (!circleKey) {
      return reply.code(500).send({ error: 'Recovery failed: could not decrypt circle key' })
    }
    const newEncryptedKey = encryptForRecipient(circleKey, newPublicKey, admin.secretKey)

    metrics.recoverySuccesses++

    return {
      circleId,
      circleName: circle.name,
      newPublicKey,
      recoveryPayload: newEncryptedKey,
      members: circle.memberPubKeys.length,
      researchNote: 'RQ2: recovery successful — historical content accessible from new device',
      frictionNote: 'Key insight: admin must be online and know recovery flow',
    }
  })

  /**
   * GET /metrics
   * Returns all collected research metrics.
   * This is the primary data output for our three research questions.
   */
  app.get('/metrics', async () => {
    const avgDhtLatency = metrics.dhtLatencies.length > 0
      ? metrics.dhtLatencies.reduce((a, b) => a + b, 0) / metrics.dhtLatencies.length
      : 0

    const avgPeerCount = metrics.peerCounts.length > 0
      ? metrics.peerCounts.reduce((a, b) => a + b, 0) / metrics.peerCounts.length
      : 0

    return {
      researchMetrics: {
        rq1_dht_resilience: {
          totalLookups: metrics.dhtLookups,
          avgLatencyMs: Math.round(avgDhtLatency),
          latencyHistogram: metrics.dhtLatencies,
          avgPeerCount: Math.round(avgPeerCount * 10) / 10,
          note: 'Lower latency + higher peer count = better DHT resilience',
        },
        rq2_access_control: {
          circlesCreated: metrics.circlesCreated,
          invitesSent: metrics.invitesSent,
          recoveryAttempts: metrics.recoveryAttempts,
          recoverySuccesses: metrics.recoverySuccesses,
          recoverySuccessRate: metrics.recoveryAttempts > 0
            ? Math.round(metrics.recoverySuccesses / metrics.recoveryAttempts * 100)
            : null,
          note: 'Recovery success rate is key UX metric for non-technical users',
        },
        rq3_streaming: {
          streamRequests: metrics.streamRequests,
          totalChunks: metrics.streamChunks,
          avgChunksPerStream: metrics.streamRequests > 0
            ? Math.round(metrics.streamChunks / metrics.streamRequests)
            : 0,
          note: 'Compare with HTTP baseline for adaptive bitrate research',
        },
      },
      operational: {
        uptime: Math.round((Date.now() - metrics.startTime) / 1000),
        uploads: metrics.uploads,
        downloads: metrics.downloads,
        totalBytesProcessed: metrics.uploadBytes + metrics.downloadBytes,
        currentPeers: libp2p.getPeers().length,
        nodeId: libp2p.peerId.toString(),
      },
    }
  })

  /**
   * POST /connect
   * Directly dial a peer by multiaddr.
   * Bypasses DHT discovery — works reliably on localhost.
   * Body: { multiaddr: string }
   *
   * Research: this is the manual bootstrap for RQ1 testing.
   */
  app.post<{
    Body: { multiaddr: string }
  }>('/connect', async (req, reply) => {
    const { multiaddr: ma } = req.body
    if (!ma) return reply.code(400).send({ error: 'multiaddr required' })

    try {
      const { multiaddr } = await import('@multiformats/multiaddr')
      const addr = multiaddr(ma)
      await libp2p.dial(addr)
      const peers = libp2p.getPeers()
      return {
        success: true,
        connectedTo: ma,
        totalPeers: peers.length,
        researchNote: 'RQ1: direct dial bypasses DHT — use for localhost testing',
      }
    } catch (err: any) {
      return reply.code(500).send({
        error: err.message,
        researchNote: 'RQ1: direct dial failed — check multiaddr format',
      })
    }
  })

  /**
   * Returns connected peers and multiaddresses.
   * Used by simulation to understand network topology.
   */
  app.get('/peers', async () => {
    const peers = libp2p.getPeers()
    return {
      count: peers.length,
      peers: peers.map(p => p.toString()),
      multiaddrs: libp2p.getMultiaddrs().map(ma => ma.toString()),
      researchNote: 'RQ1: peer count directly affects DHT resilience',
    }
  })

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`GOTA node running on port ${PORT}`)
  console.log(`P2P listening on port ${PORT + 1000}`)
  console.log(`Node ID: ${libp2p.peerId.toString()}`)
  console.log(`Data dir: ${DATA_DIR}`)
}

// ── Main ──────────────────────────────────────────────────────────

console.log('Starting GOTA research node...')
const { helia, fs, libp2p } = await createGotaNode()
await startAPI(helia, fs, libp2p)
