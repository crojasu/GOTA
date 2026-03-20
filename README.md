# GOTA

**Unified P2P Gateway — One interface for all decentralized networks**

> *A drop of water finds its way through any crack.*
> No server to shut down. No URL to block. No company to pressure.

Research prototype — NLnet NGI Zero Commons Fund application, April 2026.

---

## The problem

The technology for censorship-resistant file sharing already exists — IPFS, BitTorrent, Hypercore — but nobody can use it. Civil society organizations depend on Google Drive, Dropbox, and WeTransfer because decentralized alternatives require CLI tools, arcane configuration, and protocol-specific knowledge.

GOTA is the missing usability layer. One web interface to search, upload, and download files across multiple P2P networks — without knowing what a CID, infohash, or Hypercore key is.

---

## How it works

```
┌──────────────────────────────────────────────┐
│              GOTA Web (PWA)                   │
│  Search bar ─ Upload ─ Protocol selector      │
└──────────────────┬───────────────────────────┘
                   │ REST API
┌──────────────────▼───────────────────────────┐
│            GOTA Gateway                       │
│  ┌──────────────────────────────────────────┐ │
│  │         Protocol Registry                 │ │
│  │  ┌───────┐  ┌──────────┐  ┌───────────┐ │ │
│  │  │ IPFS  │  │BitTorrent│  │ Hypercore  │ │ │
│  │  │ Helia │  │WebTorrent│  │ Hyperdrive │ │ │
│  │  └───────┘  └──────────┘  └───────────┘ │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │  Circles — E2E encrypted groups          │ │
│  │  (protocol-agnostic, encrypt before      │ │
│  │   routing to any network)                │ │
│  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

- **Upload once, seed everywhere** — a single file is published to IPFS, BitTorrent, and Hypercore simultaneously
- **Search by name** — type a filename and find it across all networks, no need to know protocol IDs
- **Auto-detect on download** — paste a CID, infohash, or Hypercore key and GOTA routes to the right protocol
- **Circles** — E2E encrypted groups; content is encrypted before reaching any network
- **No install** — runs as a PWA in any browser

---

## Quick start

```bash
cd node
npm install
npm run dev
# Open http://localhost:3000
```

The web UI lets you:
- Search files by name across all networks
- Filter by category: Documents, Images, Video, Audio, Code, Archives
- Drag-and-drop upload to one or all networks
- Download by clicking a result or pasting a CID / infohash / key
- Browse recent uploads
- Live protocol status and peer counts

---

## API

### Content operations

```bash
# Upload to a specific protocol
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -d '{"filename":"doc.pdf","content":"<base64>","protocol":"ipfs"}'

# Upload to ALL protocols (maximum resilience)
curl -X POST http://localhost:3000/upload/all \
  -H "Content-Type: application/json" \
  -d '{"filename":"doc.pdf","content":"<base64>"}'

# Search files by name
curl http://localhost:3000/search?q=panama

# List recent uploads
curl http://localhost:3000/files?limit=20

# Download — auto-detects protocol from ID format
curl http://localhost:3000/download/<cid-or-infohash-or-key>

# Stream
curl http://localhost:3000/stream/<id>
```

### Circles (E2E encrypted groups)

```bash
# Create identity
curl -X POST http://localhost:3000/identity

# Create circle
curl -X POST http://localhost:3000/circle/create \
  -H "Content-Type: application/json" \
  -d '{"name":"evidence-2026","adminId":"<id>"}'

# Invite member
curl -X POST http://localhost:3000/circle/<circleId>/invite \
  -H "Content-Type: application/json" \
  -d '{"inviteePublicKey":"<pubkey>","adminId":"<id>"}'

# Upload to circle (encrypted before routing)
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -d '{"filename":"doc.pdf","content":"<base64>","circleId":"<circleId>"}'
```

### Network

```bash
# Gateway health (all protocols)
curl http://localhost:3000/health

# Available protocols
curl http://localhost:3000/protocols

# Connected peers (per protocol)
curl http://localhost:3000/peers

# Research metrics
curl http://localhost:3000/metrics
```

---

## Content ID formats

| Protocol | ID format | Example |
|----------|-----------|---------|
| IPFS | CID (bafkrei...) | `bafkreidquf5h5gjt56gne4trwws6vv7iq...` |
| BitTorrent | 40-char hex infohash | `3bb92f400a405718e662d9fc41ab9d06deea8fca` |
| Hypercore | 64-char hex key | `9454d30ab70baeb37901144958342e00adf47a1e...` |

The gateway auto-routes downloads to the correct protocol based on the ID format.

---

## Open research questions

**RQ1 — Cross-protocol resilience**
When content is seeded across IPFS, BitTorrent, and Hypercore simultaneously, how does availability change as peers churn? Does multi-protocol redundancy outperform single-protocol replication?

**RQ2 — Usable group access control without key management burden**
Circles encrypt content before protocol routing. How do non-technical users join/leave groups and recover access after device loss — without a key server?

**RQ3 — Browser-native P2P nodes**
The PWA currently talks to the gateway API. Can it participate directly in the DHT via WebRTC?

**RQ4 — Content moderation without central authority**
A permanent public layer across multiple protocols raises a governance problem: how does a serverless network handle illegal content without a central moderator?

---

## Repository structure

```
node/
  src/
    index.ts              # Gateway API (Fastify)
    adapters/
      types.ts            # ProtocolAdapter interface
      registry.ts         # Protocol router
      ipfs.ts             # IPFS adapter (Helia/libp2p)
      bittorrent.ts       # BitTorrent adapter (WebTorrent)
      hypercore.ts        # Hypercore adapter (Hyperdrive/Hyperswarm)
    circles.ts            # E2E encrypted groups (protocol-agnostic)
  web/
    index.html            # PWA frontend
    manifest.json         # PWA manifest
    sw.js                 # Service worker
simulation/
  run_simulation.py       # UX friction research orchestrator
  gota_client.py          # HTTP client for real node
  agents/                 # Three user personas
docker-compose.yml        # Two-node DHT test setup
```

---

## Stack

- **Protocols:** IPFS (Helia/libp2p), BitTorrent (WebTorrent), Hypercore (Hyperdrive/Hyperswarm)
- **Crypto:** libsodium (nacl/tweetnacl)
- **API:** Fastify
- **Frontend:** PWA (vanilla HTML/CSS/JS, no build step)

---

## Simulation results

Three user personas interact with the real gateway. Key finding from 5 simulation runs:

```
Top friction points:
  [3x] find_recovery_option: User doesn't know recovery exists
  [2x] circle_selection: Circle not found
  [2x] find_contact: How do I find someone's GOTA address?
```

Device recovery is the highest abandonment point. See `SIMULATION_RESULTS.md` for full data.

---

## License

AGPL-3.0

## Author

[Catalina Rojas Ugarte — Berlin, Germany](https://crojasu.github.io/)
Senior Software Engineer
Founder of [Femicide Media Watch](https://femicide-watch.up.railway.app)
github.com/crojasu
