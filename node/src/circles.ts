/**
 * Circles — Protocol-agnostic group encryption
 *
 * Circles work independently of the underlying P2P protocol.
 * Content is encrypted before being handed to any adapter.
 */

import nacl from 'tweetnacl'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

// ── Types ──────────────────────────────────────────────────────

export interface Circle {
  name: string
  adminPubKey: string
  memberPubKeys: string[]
  encryptedKey: string
  createdAt: number
}

export interface Identity {
  publicKey: string
  secretKey: string
}

// ── Stores (in-memory for prototype) ───────────────────────────

const circles = new Map<string, Circle>()
const keystore = new Map<string, Identity>()

// ── Crypto helpers ─────────────────────────────────────────────

export function generateIdentity(): Identity {
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

// ── Circle operations ──────────────────────────────────────────

export function createIdentity(): { id: string; identity: Identity } {
  const identity = generateIdentity()
  const id = identity.publicKey.slice(0, 16)
  keystore.set(id, identity)
  return { id, identity }
}

export function getIdentity(id: string): Identity | undefined {
  return keystore.get(id)
}

export function createCircle(name: string, adminId: string): {
  circleId: string
  circle: Circle
} | { error: string } {
  const admin = keystore.get(adminId)
  if (!admin) return { error: 'Admin identity not found' }

  const circleKey = nacl.randomBytes(32)
  const circleId = uint8ArrayToString(nacl.randomBytes(16), 'hex')
  const encryptedKey = encryptForRecipient(circleKey, admin.publicKey, admin.secretKey)

  const circle: Circle = {
    name,
    adminPubKey: admin.publicKey,
    memberPubKeys: [admin.publicKey],
    encryptedKey,
    createdAt: Date.now(),
  }

  circles.set(circleId, circle)
  return { circleId, circle }
}

export function getCircle(circleId: string): Circle | undefined {
  return circles.get(circleId)
}

export function inviteToCircle(
  circleId: string,
  inviteePublicKey: string,
  adminId: string
): { invitePayload: string; members: number } | { error: string; status?: number } {
  const circle = circles.get(circleId)
  if (!circle) return { error: 'Circle not found', status: 404 }

  const admin = keystore.get(adminId)
  if (!admin || admin.publicKey !== circle.adminPubKey) {
    return { error: 'Not circle admin', status: 403 }
  }

  if (circle.memberPubKeys.includes(inviteePublicKey)) {
    return { error: 'User already in circle', status: 409 }
  }

  const circleKey = decryptFromSender(circle.encryptedKey, admin.publicKey, admin.secretKey)
  if (!circleKey) return { error: 'Failed to decrypt circle key', status: 500 }

  const invitePayload = encryptForRecipient(circleKey, inviteePublicKey, admin.secretKey)
  circle.memberPubKeys.push(inviteePublicKey)

  return { invitePayload, members: circle.memberPubKeys.length }
}

export function recoverAccess(
  circleId: string,
  newPublicKey: string,
  adminId: string,
  lostPublicKey: string
): { recoveryPayload: string; members: number } | { error: string; status?: number } {
  const circle = circles.get(circleId)
  if (!circle) return { error: 'Circle not found', status: 404 }

  const admin = keystore.get(adminId)
  if (!admin || admin.publicKey !== circle.adminPubKey) {
    return { error: 'Not circle admin', status: 403 }
  }

  const idx = circle.memberPubKeys.indexOf(lostPublicKey)
  if (idx > -1) circle.memberPubKeys.splice(idx, 1)
  circle.memberPubKeys.push(newPublicKey)

  const circleKey = decryptFromSender(circle.encryptedKey, admin.publicKey, admin.secretKey)
  if (!circleKey) return { error: 'Recovery failed: could not decrypt circle key', status: 500 }

  const recoveryPayload = encryptForRecipient(circleKey, newPublicKey, admin.secretKey)
  return { recoveryPayload, members: circle.memberPubKeys.length }
}

// ── Encryption for upload ──────────────────────────────────────

/**
 * Encrypt data for a circle. Protocol-agnostic — call this before
 * handing data to any adapter.
 */
export function encryptForCircle(data: Uint8Array, circleId: string): Uint8Array | null {
  if (!circles.has(circleId)) return null
  // Production: AES-256-GCM with circle symmetric key
  // Prototype: prefix marker
  const marker = new TextEncoder().encode(`GOTA_CIRCLE:${circleId}:`)
  const combined = new Uint8Array(marker.length + data.length)
  combined.set(marker)
  combined.set(data, marker.length)
  return combined
}
