# GOTA — Decentralized P2P Protocol for Uncensorable File Sharing

*A single drop finds its way through any crack.*  
No server to shut down. No URL to block. No company to pressure.

## The problem

Documents like the Epstein files, the Panama Papers, and countless 
human rights archives have been suppressed or erased because they 
lived on servers with a single point of failure: a URL that could 
be blocked, a company that could be pressured, a server that could 
be seized.

GOTA eliminates the server from the equation.

## Open research questions

1. **Resilient P2P federation without always-online nodes** — How do 
   you maintain content routing when most peers are intermittently 
   connected?

2. **Usable group access control without key management burden** — How 
   do you encrypt shared content for a group without requiring users 
   to manage cryptographic keys manually?

3. **P2P streaming of large media files** — How do you stream video 
   over WebRTC/libp2p without requiring full download first?

## Design goals

- Accessible via browser — no installation required (PWA)
- Usable by non-technical people
- No central server to attack, subpoena, or shut down
- End-to-end encrypted private circles for sensitive documents
- Public commons layer for content that should never disappear
- Free to use, forever

## Status

Active R&D — pre-prototype.  
Grant application pending: [NLnet NGI Zero Commons Fund](https://nlnet.nl/commonsfund/)

## Stack (planned)

- Protocol: IPFS/Helia, libp2p, DHT
- Crypto: libsodium
- Interface: Progressive Web App (TypeScript/React)
- Streaming: WebRTC datachannels

## License

AGPL-3.0

## Author

Catalina Rojas Ugarte — Berlin, Germany  
Senior Software Engineer  
Founder of [Femicide Media Watch](https://femicide-watch.up.railway.app)
