"""
GOTA Mock API
Simulates core protocol operations for UX friction research.
Each operation tracks success, failure, and friction points.
"""

import hashlib
import time
import random
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class GotaFile:
    name: str
    size_mb: float
    content_hash: str
    circle: Optional[str] = None  # None = public
    peers: int = 0


@dataclass
class FrictionEvent:
    operation: str
    step: str
    error: Optional[str]
    recovered: bool
    time_seconds: float


@dataclass
class OperationResult:
    success: bool
    friction_events: list[FrictionEvent] = field(default_factory=list)
    message: str = ""
    time_seconds: float = 0.0


class MockGOTA:
    """
    Simulates GOTA protocol with realistic friction points.
    
    Design: each operation has a base success rate, but non-technical
    users encounter specific friction events that may cause abandonment.
    """

    def __init__(self, user_technical_level: str = "non-technical"):
        """
        user_technical_level: "non-technical", "intermediate", "technical"
        """
        self.technical_level = user_technical_level
        self.circles = {}       # circle_name -> [member_ids]
        self.files = {}         # hash -> GotaFile
        self.user_id = self._generate_id()
        self.keypair = self._generate_keypair()
        self.friction_log = []

    # ── Core operations ──────────────────────────────────────────────

    def upload_file(self, filename: str, size_mb: float,
                    circle: Optional[str] = None) -> OperationResult:
        """Upload a file to public commons or a private circle."""
        start = time.time()
        friction = []

        # Step 1: File selection
        step1 = self._simulate_step(
            "file_selection",
            failure_msg="Could not locate file on device",
            fail_probability=0.05 if self.technical_level == "non-technical" else 0.01
        )
        friction.append(step1)
        if not step1.recovered:
            return OperationResult(False, friction,
                                   "User abandoned: could not find file", time.time() - start)

        # Step 2: Circle selection (if private)
        if circle:
            if circle not in self.circles:
                step2 = FrictionEvent(
                    "upload", "circle_selection",
                    error="Circle not found — user doesn't know they need to create it first",
                    recovered=self.technical_level != "non-technical",
                    time_seconds=self._think_time()
                )
                friction.append(step2)
                if not step2.recovered:
                    return OperationResult(False, friction,
                                           "User abandoned: circle concept unclear",
                                           time.time() - start)
                self.circles[circle] = [self.user_id]

        # Step 3: Encryption (automatic, but user sees a progress indicator)
        step3 = FrictionEvent(
            "upload", "local_encryption",
            error=None,
            recovered=True,
            time_seconds=size_mb * 0.02  # ~20ms per MB
        )
        friction.append(step3)

        # Step 4: P2P distribution
        peers_online = random.randint(1, 8)
        if peers_online == 0:
            step4 = FrictionEvent(
                "upload", "peer_discovery",
                error="No peers available — content stored locally only",
                recovered=self.technical_level == "technical",
                time_seconds=self._think_time()
            )
            friction.append(step4)
            if not step4.recovered:
                return OperationResult(False, friction,
                                       "User abandoned: upload appeared to fail",
                                       time.time() - start)
        else:
            step4 = FrictionEvent(
                "upload", "peer_distribution",
                error=None,
                recovered=True,
                time_seconds=size_mb * 0.1
            )
            friction.append(step4)

        # Success — register file
        content_hash = hashlib.sha256(
            f"{filename}{size_mb}{time.time()}".encode()
        ).hexdigest()[:16]

        self.files[content_hash] = GotaFile(
            name=filename,
            size_mb=size_mb,
            content_hash=content_hash,
            circle=circle,
            peers=peers_online
        )

        return OperationResult(
            True, friction,
            f"File uploaded — hash: {content_hash}, {peers_online} peers seeding",
            time.time() - start
        )

    def invite_to_circle(self, circle_name: str,
                         invitee_id: str) -> OperationResult:
        """Invite someone to a private circle."""
        start = time.time()
        friction = []

        # Step 1: Find invitee
        step1 = self._simulate_step(
            "invite", "find_contact",
            failure_msg="How do I find someone's GOTA address?",
            fail_probability=0.3 if self.technical_level == "non-technical" else 0.05
        )
        friction.append(step1)
        if not step1.recovered:
            return OperationResult(False, friction,
                                   "User abandoned: GOTA address concept unclear",
                                   time.time() - start)

        # Step 2: Generate encrypted invitation
        step2 = FrictionEvent(
            "invite", "generate_invitation",
            error=None,  # automatic
            recovered=True,
            time_seconds=0.1
        )
        friction.append(step2)

        # Step 3: Deliver invitation (via link, Signal, WhatsApp)
        delivery_friction = 0.1 if self.technical_level == "non-technical" else 0.02
        step3 = self._simulate_step(
            "invite", "deliver_invitation",
            failure_msg="Link sent but recipient doesn't know what to do with it",
            fail_probability=delivery_friction
        )
        friction.append(step3)
        if not step3.recovered:
            return OperationResult(False, friction,
                                   "Invitation delivered but recipient confused",
                                   time.time() - start)

        if circle_name not in self.circles:
            self.circles[circle_name] = [self.user_id]
        self.circles[circle_name].append(invitee_id)

        return OperationResult(
            True, friction,
            f"Invited {invitee_id[:8]}... to {circle_name}",
            time.time() - start
        )

    def search(self, query: str,
               circle: Optional[str] = None) -> OperationResult:
        """Search for files — public or within a circle."""
        start = time.time()
        friction = []

        # Step 1: Query understanding
        step1 = self._simulate_step(
            "search", "formulate_query",
            failure_msg="User doesn't know if they should use filename or description",
            fail_probability=0.15 if self.technical_level == "non-technical" else 0.02
        )
        friction.append(step1)

        # Step 2: DHT lookup
        peers_responding = random.randint(0, 15)
        if peers_responding < 2:
            step2 = FrictionEvent(
                "search", "dht_lookup",
                error="Network slow — few peers online",
                recovered=True,  # search degrades gracefully
                time_seconds=random.uniform(3.0, 8.0)
            )
        else:
            step2 = FrictionEvent(
                "search", "dht_lookup",
                error=None,
                recovered=True,
                time_seconds=random.uniform(0.2, 1.5)
            )
        friction.append(step2)

        # Results
        results = [f for f in self.files.values()
                   if query.lower() in f.name.lower()
                   and (circle is None or f.circle == circle)]

        return OperationResult(
            True, friction,
            f"Found {len(results)} results for '{query}'",
            time.time() - start
        )

    def download(self, content_hash: str) -> OperationResult:
        """Download a file by hash."""
        start = time.time()
        friction = []

        if content_hash not in self.files:
            return OperationResult(False, friction,
                                   "File not found on network", time.time() - start)

        gota_file = self.files[content_hash]

        # Check circle access
        if gota_file.circle:
            if gota_file.circle not in self.circles or \
               self.user_id not in self.circles[gota_file.circle]:
                step1 = FrictionEvent(
                    "download", "access_check",
                    error="Access denied — need circle membership",
                    recovered=False,
                    time_seconds=0.1
                )
                friction.append(step1)
                return OperationResult(
                    False, friction,
                    "User not in circle — must request access",
                    time.time() - start
                )

        # Peer availability
        if gota_file.peers == 0:
            step2 = FrictionEvent(
                "download", "peer_availability",
                error="No peers seeding this file — try again later",
                recovered=False,
                time_seconds=self._think_time()
            )
            friction.append(step2)
            return OperationResult(False, friction,
                                   "User confused: file exists but can't download",
                                   time.time() - start)

        # Download
        step3 = FrictionEvent(
            "download", "chunk_assembly",
            error=None,
            recovered=True,
            time_seconds=gota_file.size_mb * 0.15
        )
        friction.append(step3)

        return OperationResult(
            True, friction,
            f"Downloaded {gota_file.name} ({gota_file.size_mb}MB) from "
            f"{gota_file.peers} peers",
            time.time() - start
        )

    def device_recovery(self, circle_name: str) -> OperationResult:
        """Recover circle access after device loss."""
        start = time.time()
        friction = []

        # This is one of our core R&D problems — model the friction carefully
        step1 = self._simulate_step(
            "recovery", "find_recovery_option",
            failure_msg="User doesn't know recovery exists",
            fail_probability=0.6 if self.technical_level == "non-technical" else 0.1
        )
        friction.append(step1)
        if not step1.recovered:
            return OperationResult(
                False, friction,
                "User abandoned: lost access to circle permanently",
                time.time() - start
            )

        step2 = self._simulate_step(
            "recovery", "contact_circle_admin",
            failure_msg="Admin unresponsive or doesn't know how to re-grant access",
            fail_probability=0.4 if self.technical_level == "non-technical" else 0.15
        )
        friction.append(step2)
        if not step2.recovered:
            return OperationResult(
                False, friction,
                "Recovery failed: admin process unclear",
                time.time() - start
            )

        return OperationResult(
            True, friction,
            f"Access to {circle_name} restored",
            time.time() - start
        )

    # ── Helpers ──────────────────────────────────────────────────────

    def _simulate_step(self, operation: str,
                       step: str = "",
                       failure_msg: str = "",
                       fail_probability: float = 0.1) -> FrictionEvent:
        failed = random.random() < fail_probability
        # Non-technical users rarely recover from failures without help
        recovery_chance = {
            "non-technical": 0.2,
            "intermediate": 0.6,
            "technical": 0.95
        }.get(self.technical_level, 0.5)

        recovered = not failed or (random.random() < recovery_chance)
        return FrictionEvent(
            operation=operation,
            step=step,
            error=failure_msg if failed else None,
            recovered=recovered,
            time_seconds=self._think_time() if failed else 0.1
        )

    def _think_time(self) -> float:
        """Time a confused user spends before giving up or recovering."""
        base = {"non-technical": 12.0, "intermediate": 4.0, "technical": 1.0}
        return random.uniform(
            base.get(self.technical_level, 5.0) * 0.5,
            base.get(self.technical_level, 5.0) * 2.0
        )

    def _generate_id(self) -> str:
        return hashlib.sha256(str(random.random()).encode()).hexdigest()[:16]

    def _generate_keypair(self) -> dict:
        # Simulated keypair — real implementation uses libsodium
        seed = random.random()
        return {
            "public": hashlib.sha256(f"pub{seed}".encode()).hexdigest()[:32],
            "private": hashlib.sha256(f"priv{seed}".encode()).hexdigest()[:32]
        }
