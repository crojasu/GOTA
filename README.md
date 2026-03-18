# GOTA 💧

**Decentralized P2P Protocol for Uncensorable File Sharing**

> *A drop of water finds its way through any crack.*  
> No server to shut down. No URL to block. No company to pressure.

Research prototype — NLnet NGI Zero Commons Fund application, April 2026.

---

## The problem

Documents like the Epstein files, the Panama Papers, and countless human rights archives have been suppressed or erased because they lived on servers with a single point of failure: a URL that could be blocked, a company that could be pressured, a server that could be seized.

GOTA eliminates the server from the equation.

Civil society organizations currently depend on Google Drive, Dropbox, and WeTransfer — centralized services that can be taken down, surveilled, or blocked. Self-hosted alternatives (Nextcloud) require a server administrator and create a single point of failure. GOTA is what these tools cannot be: infrastructure with no central server to attack.

---

## Open research questions

GOTA investigates four problems in distributed systems and applied cryptography that remain without a complete, documented, open-source solution for civil society use cases:

**RQ1 — Resilient P2P federation without always-online nodes**  
libp2p's circuit relay exists but assumes reliable connectivity. How do you maintain content availability in a DHT network where most nodes are consumer devices offline the majority of the time — without a central coordinator, and without relay nodes reading the encrypted content they store?

**RQ2 — Usable group access control without key management burden**  
MLS/TreeKEM (RFC 9420) requires either a key server or client-side state that breaks on device loss. How do you implement capability delegation so non-technical users can join/leave private circles and recover access after device loss — without a key server?

**RQ3 — Browser-native P2P nodes**  
Browsers cannot receive incoming connections. How does a PWA participate meaningfully as a P2P node using WebRTC datachannels and service workers — and what is the minimum viable companion relay node?

**RQ4 — Content moderation without central authority**  
A permanent public layer raises a governance problem: how does a serverless network handle illegal content without a central moderator?

---

## Architecture

```
Public commons layer    → Open content, permanent, uncensorable
Private circles layer   → E2E encrypted groups, no server to subpoena
Browser PWA             → No installation required
Companion relay node    → Docker, 5 minutes, strengthens the network
```

Files are encrypted locally before leaving the device. Governments and third parties receive only encrypted chunks — mathematically useless without the circle key.

---

## This repository

### `node/` — Real P2P node (TypeScript/Helia)

A working Helia/libp2p node with a REST API. Measures real DHT latency, implements nacl encryption for private circles, and exposes research metrics for all three R&D questions.

```bash
cd node
npm install
npm run dev
# Node running on port 3000, P2P on port 4000
```

```bash
# Health check
curl http://localhost:3000/health

# Upload a file to the DHT
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.txt","content":"SGVsbG8gR09UQQ=="}'

# Create a cryptographic identity (RQ2)
curl -X POST http://localhost:3000/identity \
  -H "Content-Type: application/json" \
  -d '{}'

# View research metrics (DHT latency, access control, streaming)
curl http://localhost:3000/metrics
```

Two-node DHT setup (tests RQ1):

```bash
docker compose up
```

### `simulation/` — UX friction research agents (Python)

Three user personas interact with the real P2P node. Friction points emerge from actual protocol behavior, not mock random() calls.

- **Maya** — non-technical activist at Level Up UK
- **Helena** — intermediate researcher at Datos Contra Feminicidio
- **Tariq** — technical investigative journalist

```bash
# Run with node active at localhost:3000
cd simulation
python run_simulation.py --runs 5
```

### `SIMULATION_RESULTS.md` — Sample output

Representative results from 5 simulation runs. Key finding:

```
Top friction points:
  [3x] find_recovery_option: User doesn't know recovery exists
  [2x] circle_selection: Circle not found — user doesn't know they need to create it first
  [2x] find_contact: How do I find someone's GOTA address?
```

Device recovery is the highest abandonment point across all non-technical users. This is the core design problem of RQ2. The invite flow friction validates the Signal/WhatsApp bot integration as a primary onboarding path, not a feature.

---

## Pilot organizations

The following organizations have confirmed interest in participating in the validation phase:

- **Datos Contra Feminicidio** (femicidemap.net) — feminist data organization monitoring femicides across Latin America
- **Feminizidmap Berlin** (feminizidmap.org) — documenting femicides in Germany
- **Level Up UK** (welevelup.org) — feminist campaigning nonprofit, UK, active since 2012

---

## Sustainability

GOTA's cost model differs fundamentally from centralized alternatives. Signal requires ~$50M/year to operate because it runs servers that scale with users. GOTA has no servers to scale — each new user who joins becomes a node that distributes load. Bootstrap infrastructure costs ~€30/month regardless of network size.

Post-grant sustainability: organizational hosting fees for civil society groups that want managed nodes (€50–200/month), follow-on grants (Prototype Fund Germany, Open Technology Fund), and donations once the network reaches sufficient adoption.

---

## Stack

- Protocol: IPFS/Helia, libp2p, Kademlia DHT
- Crypto: libsodium (nacl), tweetnacl
- Interface: Progressive Web App (TypeScript/React) — planned
- Streaming: WebRTC datachannels — planned
- API: Fastify

---

## License

AGPL-3.0

## Author

Catalina Rojas Ugarte — Berlin, Germany  
Senior Software Engineer  
Founder of [Femicide Media Watch](https://femicide-watch.up.railway.app)  
github.com/crojasu
