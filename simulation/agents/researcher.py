"""
Agent: Helena — Researcher, Datos Contra Feminicidio
Technical level: intermediate

Profile:
- Data researcher documenting femicides across Latin America
- Comfortable with spreadsheets, Airtable, basic command line
- Has used Signal and encrypted email before
- Primary need: publish datasets that governments cannot take down,
  and share sensitive evidence with partner orgs across borders

Tasks simulated:
1. Publish a public dataset to the commons layer
2. Share a private evidence file with Feminizidmap Berlin
3. Verify that a published dataset is still accessible after 30 days
4. Stream a video testimony (P2P streaming research question)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mock_gota import MockGOTA, GotaFile
from agents.activist import TaskResult
from typing import List


class ResearcherAgent:
    """
    Helena — intermediate-technical researcher.
    Key use case: permanent, uncensorable publication of evidence.
    """

    def __init__(self):
        self.name = "Helena"
        self.org = "Datos Contra Feminicidio"
        self.gota = MockGOTA(user_technical_level="intermediate")
        self.partner_org_id = "feminizidmap_berlin_node"
        self.results: List[TaskResult] = []

    def run_all_tasks(self) -> List[TaskResult]:
        print(f"\n{'='*60}")
        print(f"AGENT: {self.name} ({self.org})")
        print(f"Technical level: intermediate")
        print(f"{'='*60}\n")

        self.results = [
            self.task_publish_public_dataset(),
            self.task_share_private_evidence(),
            self.task_verify_persistence(),
            self.task_stream_video_testimony(),
        ]

        self._print_summary()
        return self.results

    def task_publish_public_dataset(self) -> TaskResult:
        """
        Task: Publish femicide dataset to public commons.
        Helena wants it permanent and findable globally.
        """
        print("TASK 1: Publish dataset to public commons")
        print("-" * 40)

        result = self.gota.upload_file(
            filename="femicides_latam_2015_2024_unodc.csv",
            size_mb=3.2,
            circle=None  # public
        )

        friction_points = [
            f.step + (f": {f.error}" if f.error else "")
            for f in result.friction_events if f.error
        ]

        print(f"  Result: {'✓' if result.success else '✗'} {result.message}")
        for fp in friction_points:
            print(f"  ⚠ Friction: {fp}")

        # Helena's concern: will this still exist in 5 years?
        if result.success:
            try:
                peers = int(result.message.split()[-2])
            except (ValueError, IndexError):
                peers = 1
            if peers < 3:
                print(f"  ⚠ Concern: only {peers} peers seeding — "
                      f"persistence not guaranteed yet")
        print()

        return TaskResult(
            task="Publish dataset to public commons",
            success=result.success,
            friction_points=friction_points,
            abandoned_at=None,
            total_time=result.time_seconds,
            notes="Helena understood public vs circle distinction immediately. "
                  "Concern about long-term persistence with few peers — "
                  "important feedback for relay node design"
        )

    def task_share_private_evidence(self) -> TaskResult:
        """
        Task: Share sensitive testimony with Feminizidmap Berlin.
        Private circle, only the two orgs can access.
        """
        print("TASK 2: Share private evidence with partner org")
        print("-" * 40)

        # Create cross-org circle
        invite_result = self.gota.invite_to_circle(
            circle_name="dcf_feminizidmap_collab",
            invitee_id=self.partner_org_id
        )

        upload_result = None
        if invite_result.success:
            upload_result = self.gota.upload_file(
                filename="testimony_protected_witness_2024.mp4",
                size_mb=245.0,  # large video file
                circle="dcf_feminizidmap_collab"
            )

        all_friction = []
        for r in [invite_result, upload_result] if upload_result else [invite_result]:
            all_friction.extend([
                f.step + (f": {f.error}" if f.error else "")
                for f in r.friction_events if f.error
            ])

        success = invite_result.success and (
            upload_result.success if upload_result else False
        )

        print(f"  Invite: {'✓' if invite_result.success else '✗'} "
              f"{invite_result.message}")
        if upload_result:
            print(f"  Upload: {'✓' if upload_result.success else '✗'} "
                  f"{upload_result.message}")
        for fp in all_friction:
            print(f"  ⚠ Friction: {fp}")
        print()

        return TaskResult(
            task="Share private evidence with partner organization",
            success=success,
            friction_points=all_friction,
            abandoned_at=None,
            total_time=(invite_result.time_seconds +
                        (upload_result.time_seconds if upload_result else 0)),
            notes="Large video file (245MB) — streaming research question critical here. "
                  "Helena patient with upload time but worried about partner "
                  "being able to access it"
        )

    def task_verify_persistence(self) -> TaskResult:
        """
        Task: Check that dataset published 30 days ago is still accessible.
        Tests our DHT resilience research question.
        """
        print("TASK 3: Verify dataset still accessible after 30 days")
        print("-" * 40)

        # Simulate: the file was uploaded 30 days ago
        # Peers may have dropped — this tests our resilience research
        import hashlib, random

        old_hash = "old_dataset_30days"
        # Simulate peer churn: 30% chance file is still well-seeded
        peers_remaining = random.choices(
            [0, 1, 2, 5, 8],
            weights=[0.15, 0.20, 0.25, 0.25, 0.15]
        )[0]

        self.gota.files[old_hash] = GotaFile(
            name="femicides_latam_2015_2023_unodc.csv",
            size_mb=2.8,
            content_hash=old_hash,
            circle=None,
            peers=peers_remaining
        )

        download_result = self.gota.download(old_hash)

        persistence_ok = peers_remaining >= 2
        friction_points = [
            f.step + (f": {f.error}" if f.error else "")
            for f in download_result.friction_events if f.error
        ]

        print(f"  Peers still seeding: {peers_remaining}")
        print(f"  Result: {'✓' if download_result.success else '✗'} "
              f"{download_result.message}")
        if not persistence_ok:
            print(f"  ⚠ Research finding: file at risk with {peers_remaining} peers")
            print(f"    → Relay node design needed to guarantee persistence")
        print()

        return TaskResult(
            task="Verify dataset persistence after 30 days",
            success=download_result.success,
            friction_points=friction_points,
            abandoned_at=None,
            total_time=download_result.time_seconds,
            notes=f"Peer churn result: {peers_remaining} peers remaining. "
                  f"This directly validates Research Question 1 — "
                  f"relay nodes needed for civil society use case"
        )

    def task_stream_video_testimony(self) -> TaskResult:
        """
        Task: Stream a 1.4GB video testimony without downloading first.
        This is Research Question 3 — P2P streaming.
        """
        print("TASK 4: Stream video testimony (P2P streaming)")
        print("-" * 40)

        import hashlib, random

        video_hash = "testimony_video_stream"
        self.gota.files[video_hash] = GotaFile(
            name="testimony_full_recording.mp4",
            size_mb=1400.0,
            content_hash=video_hash,
            circle="dcf_feminizidmap_collab",
            peers=3
        )
        self.gota.circles["dcf_feminizidmap_collab"] = [self.gota.user_id]

        # Simulate streaming — key metrics for our research
        bandwidth_mbps = random.uniform(0.5, 10.0)
        buffer_events = max(0, int(3.0 / bandwidth_mbps))
        time_to_first_frame = 1400 / (bandwidth_mbps * 8) * 0.02  # 2% buffered
        playback_possible = bandwidth_mbps > 0.8

        friction_points = []
        if buffer_events > 2:
            friction_points.append(
                f"buffering: {buffer_events} stalls at {bandwidth_mbps:.1f}mbps"
            )
        if not playback_possible:
            friction_points.append(
                "bandwidth too low — must download fully before watching"
            )

        print(f"  Bandwidth: {bandwidth_mbps:.1f} mbps")
        print(f"  Time to first frame: {time_to_first_frame:.1f}s")
        print(f"  Buffer events: {buffer_events}")
        print(f"  Streaming viable: {'✓' if playback_possible else '✗'}")
        for fp in friction_points:
            print(f"  ⚠ Research finding: {fp}")
        print()

        return TaskResult(
            task="Stream video testimony without full download",
            success=playback_possible,
            friction_points=friction_points,
            abandoned_at=None if playback_possible else "bandwidth_insufficient",
            total_time=time_to_first_frame,
            notes=f"Bandwidth={bandwidth_mbps:.1f}mbps, "
                  f"buffers={buffer_events}. "
                  f"Research Q3: adaptive bitrate needed below 2mbps"
        )

    def _print_summary(self):
        print(f"\n{'='*60}")
        print(f"SUMMARY: {self.name}")
        print(f"{'='*60}")
        completed = sum(1 for r in self.results if r.success)
        print(f"Tasks completed: {completed}/{len(self.results)}")
        total_friction = sum(len(r.friction_points) for r in self.results)
        print(f"Total friction events: {total_friction}")
        print()


if __name__ == "__main__":
    agent = ResearcherAgent()
    agent.run_all_tasks()
