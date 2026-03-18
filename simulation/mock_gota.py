# Compatibility shim — keeps MockGOTA interface for agents
# Real client is in gota_client.py
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
    circle: Optional[str] = None
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
    friction_events: list = field(default_factory=list)
    message: str = ""
    time_seconds: float = 0.0

class MockGOTA:
    def __init__(self, user_technical_level="non-technical"):
        self.technical_level = user_technical_level
        self.circles = {}
        self.files = {}
        self.user_id = hashlib.sha256(str(random.random()).encode()).hexdigest()[:16]
        self.keypair = {"public": "pub", "private": "priv"}

    def upload_file(self, filename, size_mb, circle=None):
        start = time.time()
        friction = []
        if circle and circle not in self.circles:
            fail_prob = 0.5 if self.technical_level == "non-technical" else 0.05
            if random.random() < fail_prob:
                friction.append(FrictionEvent("upload", "circle_selection",
                    "Circle not found — user doesn't know they need to create it first",
                    self.technical_level != "non-technical", self._think_time()))
                if not friction[-1].recovered:
                    return OperationResult(False, friction, "User abandoned: circle concept unclear", time.time()-start)
            self.circles[circle] = [self.user_id]
        peers = random.randint(1, 8)
        content_hash = hashlib.sha256(f"{filename}{time.time()}".encode()).hexdigest()[:16]
        self.files[content_hash] = GotaFile(filename, size_mb, content_hash, circle, peers)
        return OperationResult(True, friction, f"File uploaded — hash: {content_hash}, {peers} peers seeding", time.time()-start)

    def invite_to_circle(self, circle_name, invitee_id):
        start = time.time()
        friction = []
        fail_prob = 0.3 if self.technical_level == "non-technical" else 0.05
        if random.random() < fail_prob:
            recovered = random.random() < (0.2 if self.technical_level == "non-technical" else 0.8)
            friction.append(FrictionEvent("invite", "find_contact",
                "How do I find someone's GOTA address?", recovered, self._think_time()))
            if not recovered:
                return OperationResult(False, friction, "User abandoned: GOTA address concept unclear", time.time()-start)
        if circle_name not in self.circles:
            self.circles[circle_name] = [self.user_id]
        self.circles[circle_name].append(invitee_id)
        return OperationResult(True, friction, f"Invited {invitee_id[:8]}... to {circle_name}", time.time()-start)

    def search(self, query, circle=None):
        start = time.time()
        results = [f for f in self.files.values() if query.lower() in f.name.lower()]
        return OperationResult(True, [], f"Found {len(results)} results for '{query}'", time.time()-start)

    def download(self, content_hash):
        start = time.time()
        if content_hash not in self.files:
            return OperationResult(False, [], "File not found", time.time()-start)
        f = self.files[content_hash]
        if f.peers == 0:
            return OperationResult(False, [], "No peers seeding", time.time()-start)
        return OperationResult(True, [], f"Downloaded {f.name} ({f.size_mb}MB) from {f.peers} peers", time.time()-start)

    def device_recovery(self, circle_name):
        start = time.time()
        friction = []
        fail_prob = 0.6 if self.technical_level == "non-technical" else 0.1
        if random.random() < fail_prob:
            recovered = random.random() < (0.2 if self.technical_level == "non-technical" else 0.7)
            friction.append(FrictionEvent("recovery", "find_recovery_option",
                "User doesn't know recovery exists", recovered, self._think_time()))
            if not recovered:
                return OperationResult(False, friction, "User abandoned: lost access permanently", time.time()-start)
        return OperationResult(True, friction, f"Access to {circle_name} restored", time.time()-start)

    def _think_time(self):
        base = {"non-technical": 12.0, "intermediate": 4.0, "technical": 1.0}
        b = base.get(self.technical_level, 5.0)
        return random.uniform(b*0.5, b*2.0)
