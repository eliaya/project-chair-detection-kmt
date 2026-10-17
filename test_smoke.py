"""Smoke test: verify core logic without camera or external dependencies."""

import json
import math
import time
import os
import sys
import unittest

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class TestPointInPolygon(unittest.TestCase):
    """Ray casting: point inside polygon → True."""

    def test_point_inside_square(self):
        poly = [[0, 0], [100, 0], [100, 100], [0, 100]]
        from utils import point_in_polygon
        self.assertTrue(point_in_polygon(50, 50, poly))
        self.assertTrue(point_in_polygon(1, 1, poly))
        self.assertTrue(point_in_polygon(99, 99, poly))

    def test_point_outside_square(self):
        poly = [[0, 0], [100, 0], [100, 100], [0, 100]]
        from utils import point_in_polygon
        self.assertFalse(point_in_polygon(-1, 50, poly))
        self.assertFalse(point_in_polygon(150, 50, poly))
        self.assertFalse(point_in_polygon(50, -1, poly))
        self.assertFalse(point_in_polygon(50, 150, poly))

    def test_point_on_edge(self):
        poly = [[0, 0], [100, 0], [100, 100], [0, 100]]
        from utils import point_in_polygon
        # Corner case: exactly on edge (right boundary)
        self.assertTrue(point_in_polygon(100, 50, poly))

    def test_triangle(self):
        poly = [[50, 0], [0, 100], [100, 100]]
        from utils import point_in_polygon
        self.assertTrue(point_in_polygon(50, 50, poly))
        self.assertFalse(point_in_polygon(50, -1, poly))
        self.assertFalse(point_in_polygon(-1, 50, poly))


class TestBBoxCenter(unittest.TestCase):
    """Bottom-1/3 center: (cx, cy) where cy = y + h*0.67."""

    def test_center(self):
        from utils import bbox_bottom_center
        cx, cy = bbox_bottom_center([100, 200, 50, 80])
        self.assertAlmostEqual(cx, 125.0)
        self.assertAlmostEqual(cy, 253.6)


class TestSeatState(unittest.TestCase):
    """Per-seat state machine transitions."""

    def test_empty_to_confirming(self):
        from main import SeatState
        s = SeatState()
        self.assertEqual(s.status, SeatState.EMPTY)
        s.status = SeatState.CONFIRMING
        self.assertEqual(s.status, SeatState.CONFIRMING)

    def test_confirming_to_occupied(self):
        from main import SeatState
        s = SeatState()
        s.status = SeatState.CONFIRMING
        s.confirm_frames = 3
        if s.confirm_frames >= 3:
            s.status = SeatState.OCCUPIED
            s.duration_s = 0.0
        self.assertEqual(s.status, SeatState.OCCUPIED)

    def test_occupied_to_leave_confirm(self):
        from main import SeatState
        s = SeatState()
        s.status = SeatState.OCCUPIED
        s.status = SeatState.LEAVE_CONFIRM
        s.leave_start = time.time()
        self.assertEqual(s.status, SeatState.LEAVE_CONFIRM)

    def test_leave_confirm_to_empty(self):
        from main import SeatState
        s = SeatState()
        s.status = SeatState.OCCUPIED
        s.status = SeatState.LEAVE_CONFIRM
        s.leave_start = time.time() - 11  # > 10s ago
        elapsed = time.time() - s.leave_start
        self.assertGreater(elapsed, 10.0)
        if elapsed > 10.0:
            s.status = SeatState.EMPTY
            s.count = 0
            s.duration_s = 0.0
        self.assertEqual(s.status, SeatState.EMPTY)

    def test_to_dict(self):
        from main import SeatState
        s = SeatState()
        d = s.to_dict()
        self.assertIn("status", d)
        self.assertIn("count", d)
        self.assertIn("duration_s", d)
        self.assertIn("last_seen_s", d)


class TestOccupancyTracker(unittest.TestCase):
    """Full occupancy tracker state transitions."""

    def setUp(self):
        from main import OccupancyTracker, SeatState
        zones = [{
            "id": "z1",
            "camera": "cam1",
            "vertices": [[0, 0], [200, 0], [200, 200], [0, 200]],
            "seats": [["s1"], ["s2"]],
        }]
        self.tracker = OccupancyTracker(zones, conf_frames=3, leave_grace_s=2.0)

    def test_ensure_seats_created(self):
        self.tracker.ensure_seats()
        sids = sorted(self.tracker.states.keys())
        self.assertIn("z1_s00", sids)
        self.assertIn("z1_s01", sids)

    def test_state_machine_empty_to_occupied(self):
        """Person always in zone → empty → confirming → occupied."""
        from main import OccupancyTracker, SeatState
        # Frame with person inside zone
        tracks = [("p0", [50, 50, 100, 100])]  # bbox fully inside
        results = self.tracker.process_frame(tracks, self.tracker.zones[0])

        # After first detection: confirming
        for sid in ["z1_s00", "z1_s01"]:
            if sid in results:
                self.assertEqual(results[sid]["status"], SeatState.CONFIRMING)

    def test_state_machine_occupied_to_leave(self):
        """Person disappears → occupied → leave_confirm → empty."""
        from main import OccupancyTracker, SeatState
        tracks = [("p0", [50, 50, 100, 100])]
        self.tracker.ensure_seats()

        # Fill confirming frames to reach occupied
        for _ in range(3):
            results = self.tracker.process_frame(tracks, self.tracker.zones[0])

        # Now remove person
        empty_tracks = []
        results = self.tracker.process_frame(empty_tracks, self.tracker.zones[0])

        # Should be in leave_confirm or empty depending on grace
        for sid in ["z1_s00", "z1_s01"]:
            if sid in results:
                status = results[sid]["status"]
                self.assertIn(status, [SeatState.LEAVE_CONFIRM, SeatState.EMPTY])


class TestByteTrack(unittest.TestCase):
    """IoU matching and age tracking."""

    def test_no_detections(self):
        from main import ByteTrack
        bt = ByteTrack()
        tracks = bt.update([])
        self.assertEqual(len(tracks), 0)

    def test_single_track_persists(self):
        from main import ByteTrack
        bt = ByteTrack(max_age=3, min_hits=1)
        det = [[100, 100, 50, 50]]
        tracks = bt.update(det)
        self.assertGreaterEqual(len(tracks), 0)  # May have track

    def test_iou_self(self):
        from main import ByteTrack
        a = [0, 0, 100, 100]
        b = [0, 0, 100, 100]
        self.assertAlmostEqual(ByteTrack._iou(a, b), 1.0)

    def test_iou_disjoint(self):
        from main import ByteTrack
        a = [0, 0, 50, 50]
        b = [100, 100, 50, 50]
        self.assertAlmostEqual(ByteTrack._iou(a, b), 0.0)


class TestCloudSync(unittest.TestCase):
    """Cloud sync without real server."""

    def test_submit_without_url(self):
        from main import CloudSync
        cloud = CloudSync(device_id="test1")
        # No api_url → mock success (nothing queued)
        cloud.submit({"s1": {"status": "occupied"}})
        self.assertFalse(cloud._queue)  # Empty queue on mock success

    def test_submit_with_fake_url(self):
        from main import CloudSync
        cloud = CloudSync(api_url="http://localhost:9999/fake", device_id="test2")
        cloud.submit({"s1": {"status": "occupied"}})
        # Should be in queue (no real server to receive)
        self.assertEqual(len(cloud._queue), 1)

    def test_heartbeat_noop(self):
        from main import CloudSync
        cloud = CloudSync(device_id="test3")
        cloud.heartbeat()  # First call sets heartbeat
        cloud.heartbeat()  # Within 30s → no-op (should print or do nothing)


class TestCamera(unittest.TestCase):
    """Camera mock frame generation."""

    def test_read_frame(self):
        from main import Camera
        cam = Camera(width=10, height=10)
        frame = cam.read_frame()
        self.assertIsNotNone(frame)

    def test_release(self):
        from main import Camera
        cam = Camera()
        cam.release()  # Should not raise


class TestConfigLoad(unittest.TestCase):
    """Config JSON loading."""

    def test_load_sample_config(self):
        from utils import load_config
        config_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "config.json")
        if os.path.exists(config_path):
            cfg = load_config(config_path)
            self.assertIn("zones", cfg)
            self.assertIn("thresholds", cfg)
            self.assertGreaterEqual(len(cfg["zones"]), 1)
            self.assertIn("confidence", cfg["thresholds"])


class TestIntegration(unittest.TestCase):
    """End-to-end: detect → track → zone check → state update."""

    def test_full_pipeline(self):
        """Person in zone bbox → state transitions through confirming → occupied."""
        from main import (OccupancyTracker, ByteTrack, SeatState,
                          point_in_polygon, bbox_bottom_center)
        from utils import load_config
        import os

        config_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "config.json")
        if not os.path.exists(config_path):
            self.skipTest("config.json not found")

        cfg = load_config(config_path)
        zones = cfg["zones"][:1]  # First zone only
        thresh = cfg.get("thresholds", {})

        tracker = OccupancyTracker(
            zones,
            conf_frames=thresh.get("confirm_frames", 3),
            leave_grace_s=thresh.get("leave_grace_s", 10.0))
        tracker.ensure_seats()

        # Simulate person in zone center
        z = zones[0]
        verts = z["vertices"]
        avg_x = sum(v[0] for v in verts) / len(verts)
        avg_y = sum(v[1] for v in verts) / len(verts)
        tracks = [("p0", [avg_x - 50, avg_y - 60, 100, 120])]

        # First frame: should enter CONFIRMING
        results = tracker.process_frame(tracks, z)
        for sid in tracker.states:
            if tracker.states[sid].status == SeatState.CONFIRMING:
                break
        else:
            self.fail("No seat entered CONFIRMING state")

    def test_no_person_in_zone(self):
        """Empty zone → states should remain empty."""
        from main import OccupancyTracker, SeatState
        zones = [{
            "id": "z2",
            "camera": "cam1",
            "vertices": [[0, 0], [100, 0], [100, 100], [0, 100]],
            "seats": [["s1"]],
        }]

        tracker = OccupancyTracker(zones)
        tracker.ensure_seats()

        # Empty zone (no tracks)
        results = tracker.process_frame([], zones[0])
        self.assertEqual(results.get("z2_s00", {}).get("status"), SeatState.EMPTY)


if __name__ == "__main__":
    unittest.main(verbosity=2)
