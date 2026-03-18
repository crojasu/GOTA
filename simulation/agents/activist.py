"""
Agent: Maya — Activist, Level Up UK
Technical level: non-technical

Profile:
- Campaign coordinator at Level Up UK
- Uses WhatsApp and Google Drive daily
- No experience with P2P tools or cryptography
- Primary need: share sensitive campaign docs with UK colleagues
  without them being accessible to hostile actors

Tasks simulated:
1. Upload a sensitive legal document to a private circle
2. Invite a colleague to the circle
3. Search for and download a previously shared document
4. Recover circle access after getting a new phone
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mock_gota import MockGOTA
from dataclasses import dataclass
from typing import List


@dataclass
class TaskResult:
    task: str
    success: bool
    friction_points: List[str]
    abandoned_at: str | None
    total_time: float
    notes: str


class ActivistAgent:
    """
    Maya — non-technical activist at Level Up UK.
    Simulates realistic usage patterns and abandonment decisions.
    """

    def __init__(self):
        self.name = "Maya"
        self.org = "Level Up UK"
        self.gota = MockGOTA(user_technical_level="non-technical")
        self.colleague_id = "colleague_sarah_" + "a1b2c3d4"
        self.results: List[TaskResult] = []

    def run_all_tasks(self) -> List[TaskResult]:
        print(f"\n{'='*60}")
        print(f"AGENT: {self.name} ({self.org})")
        print(f"Technical level: non-technical")
        print(f"{'='*60}\n")

        self.results = [
            self.task_upload_sensitive_doc(),
            self.task_invite_colleague(),
            self.task_search_and_download(),
            self.task_device_recovery(),
        ]

        self._print_summary()
        return self.results

    def task_upload_sensitive_doc(self) -> TaskResult:
        """
        Task: Upload a legal document to the Level Up circle.
        Maya has never used a P2P tool before.
        """
        print("TASK 1: Upload legal document to private circle")
        print("-" * 40)

        result = self.gota.upload_file(
            filename="harassment_case_evidence_2024.pdf",
            size_mb=2.3,
            circle="levelup_uk_internal"
        )

        friction_points = [
            f.step + (f": {f.error}" if f.error else "")
            for f in result.friction_events if f.error
        ]

        abandoned_at = None
        if not result.success:
            abandoned_at = next(
                (f.step for f in result.friction_events
                 if f.error and not f.recovered), None
            )

        print(f"  Result: {'✓' if result.success else '✗'} {result.message}")
        for fp in friction_points:
            print(f"  ⚠ Friction: {fp}")
        print()

        return TaskResult(
            task="Upload sensitive document to private circle",
            success=result.success,
            friction_points=friction_points,
            abandoned_at=abandoned_at,
            total_time=result.time_seconds,
            notes="Maya confused by 'circle' concept vs Google Drive 'folder'"
        )

    def task_invite_colleague(self) -> TaskResult:
        """
        Task: Invite colleague Sarah to the Level Up circle.
        Key friction: Maya doesn't know Sarah's GOTA address.
        """
        print("TASK 2: Invite colleague to circle")
        print("-" * 40)

        result = self.gota.invite_to_circle(
            circle_name="levelup_uk_internal",
            invitee_id=self.colleague_id
        )

        friction_points = [
            f.step + (f": {f.error}" if f.error else "")
            for f in result.friction_events if f.error
        ]

        abandoned_at = None
        if not result.success:
            abandoned_at = next(
                (f.step for f in result.friction_events
                 if f.error and not f.recovered), None
            )

        print(f"  Result: {'✓' if result.success else '✗'} {result.message}")
        for fp in friction_points:
            print(f"  ⚠ Friction: {fp}")
        print()

        return TaskResult(
            task="Invite colleague to private circle",
            success=result.success,
            friction_points=friction_points,
            abandoned_at=abandoned_at,
            total_time=result.time_seconds,
            notes="Finding contact's GOTA address is biggest barrier — "
                  "WhatsApp bot integration would eliminate this"
        )

    def task_search_and_download(self) -> TaskResult:
        """
        Task: Find and download the harassment policy document
        that a colleague uploaded last week.
        """
        print("TASK 3: Search and download shared document")
        print("-" * 40)

        # First search
        search_result = self.gota.search(
            query="harassment policy",
            circle="levelup_uk_internal"
        )

        # Try to download the first result (may or may not exist)
        from mock_gota import GotaFile
        import hashlib
        import random

        # Simulate: a colleague uploaded this file
        test_hash = "abc123def456"
        self.gota.files[test_hash] = GotaFile(
            name="harassment_policy_2024.pdf",
            size_mb=1.1,
            content_hash=test_hash,
            circle="levelup_uk_internal",
            peers=3
        )
        self.gota.circles["levelup_uk_internal"] = [self.gota.user_id]

        download_result = self.gota.download(test_hash)

        all_friction = []
        for r in [search_result, download_result]:
            all_friction.extend([
                f.step + (f": {f.error}" if f.error else "")
                for f in r.friction_events if f.error
            ])

        success = search_result.success and download_result.success
        total_time = search_result.time_seconds + download_result.time_seconds

        print(f"  Search: {'✓' if search_result.success else '✗'} "
              f"{search_result.message}")
        print(f"  Download: {'✓' if download_result.success else '✗'} "
              f"{download_result.message}")
        for fp in all_friction:
            print(f"  ⚠ Friction: {fp}")
        print()

        return TaskResult(
            task="Search and download shared document",
            success=success,
            friction_points=all_friction,
            abandoned_at=None,
            total_time=total_time,
            notes="Search felt like Google — most intuitive step for Maya"
        )

    def task_device_recovery(self) -> TaskResult:
        """
        Task: Maya got a new phone. She needs to regain access to her circles.
        This is our hardest UX problem — models the recovery flow.
        """
        print("TASK 4: Recover circle access after new phone")
        print("-" * 40)

        result = self.gota.device_recovery("levelup_uk_internal")

        friction_points = [
            f.step + (f": {f.error}" if f.error else "")
            for f in result.friction_events if f.error
        ]

        abandoned_at = None
        if not result.success:
            abandoned_at = next(
                (f.step for f in result.friction_events
                 if f.error and not f.recovered), None
            )

        print(f"  Result: {'✓' if result.success else '✗'} {result.message}")
        for fp in friction_points:
            print(f"  ⚠ Friction: {fp}")
        print()

        return TaskResult(
            task="Device recovery — regain circle access after new phone",
            success=result.success,
            friction_points=friction_points,
            abandoned_at=abandoned_at,
            total_time=result.time_seconds,
            notes="CRITICAL: most non-technical users give up here. "
                  "Admin recovery flow must be redesigned — "
                  "this is Research Question 2"
        )

    def _print_summary(self):
        print(f"\n{'='*60}")
        print(f"SUMMARY: {self.name}")
        print(f"{'='*60}")
        completed = sum(1 for r in self.results if r.success)
        print(f"Tasks completed: {completed}/{len(self.results)}")
        total_friction = sum(len(r.friction_points) for r in self.results)
        print(f"Total friction events: {total_friction}")
        abandoned = [r for r in self.results if r.abandoned_at]
        if abandoned:
            print(f"Abandoned tasks: {len(abandoned)}")
            for r in abandoned:
                print(f"  - {r.task} (abandoned at: {r.abandoned_at})")
        print()


if __name__ == "__main__":
    agent = ActivistAgent()
    agent.run_all_tasks()
