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
    def test_to_dict(self):
        from main import SeatState
        s = SeatState()
        d = s.to_dict()
        self.assertIn("status", d)
        self.assertIn("count", d)
        self.assertIn("duration_s", d)
        self.assertIn("last_seen_s", d)


def seat_box(poly):
    """A person box whose lower-body point is the centre of poly."""
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    return [cx - 50, cy - 140 * 0.67, 100, 140]


SQ = lambda x: [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]]
ZONE = {"id": "z1", "camera": "cam1", "seats": [
    [{"name": "A1", "vertices": SQ(0)}, {"name": "A2", "vertices": SQ(100)}],
    [{"name": "B1", "vertices": SQ(200)}],
]}


class TestOccupancyTracker(unittest.TestCase):
    """Per-seat state machine, driven through OccupancyTracker."""

    def setUp(self):
        from main import OccupancyTracker
        self.tracker = OccupancyTracker([ZONE], conf_frames=3, leave_grace_s=10.0)
        self.tracker.ensure_seats()

    def frame(self, *seat_polys):
        tracks = [(i, seat_box(p)) for i, p in enumerate(seat_polys)]
        return self.tracker.process_frame(tracks, ZONE)

    def test_seat_ids(self):
        self.assertEqual(sorted(self.tracker.states),
                         ["z1_t00_s00", "z1_t00_s01", "z1_t01_s00"])

    def test_only_the_seat_with_the_person_changes(self):
        r = self.frame(SQ(100))
        self.assertEqual(r["z1_t00_s01"]["status"], "confirming")
        self.assertEqual(r["z1_t00_s00"]["status"], "empty")
        self.assertEqual(r["z1_t01_s00"]["status"], "empty")

    def test_seated_after_three_frames(self):
        statuses = [self.frame(SQ(0))["z1_t00_s00"]["status"] for _ in range(3)]
        self.assertEqual(statuses, ["confirming", "confirming", "occupied"])

    def test_passer_by_does_not_occupy(self):
        self.frame(SQ(0))
        self.assertEqual(self.frame()["z1_t00_s00"]["status"], "empty")

    def test_back_within_grace_stays_occupied(self):
        for _ in range(3):
            self.frame(SQ(0))
        self.assertEqual(self.frame()["z1_t00_s00"]["status"], "leave_confirm")
        self.assertEqual(self.frame(SQ(0))["z1_t00_s00"]["status"], "occupied")

    def test_empty_after_grace(self):
        for _ in range(3):
            self.frame(SQ(0))
        self.frame()
        self.tracker.states["z1_t00_s00"].leave_start -= 11
        r = self.frame()
        self.assertEqual(r["z1_t00_s00"]["status"], "empty")
        self.assertEqual(r["z1_t00_s00"]["duration_s"], 0.0)

    def test_person_counts_for_one_seat_only(self):
        from main import OccupancyTracker
        overlap = {"id": "z2", "camera": "cam1", "seats": [
            [{"name": "X", "vertices": SQ(0)}, {"name": "Y", "vertices": SQ(0)}]]}
        t = OccupancyTracker([overlap])
        r = t.process_frame([(0, seat_box(SQ(0)))], overlap)
        self.assertEqual([r["z2_t00_s00"]["count"], r["z2_t00_s01"]["count"]], [1, 0])


class TestByteTrack(unittest.TestCase):
    def test_no_detections(self):
        from main import ByteTrack
        self.assertEqual(ByteTrack().update([]), [])

    def test_same_person_keeps_id_across_frames(self):
        from main import ByteTrack
        bt = ByteTrack()
        ids = [bt.update([[100 + i * 5, 100, 50, 100, 0.9]])[0][0] for i in range(10)]
        self.assertEqual(len(set(ids)), 1)

    def test_low_score_box_keeps_track_but_does_not_start_one(self):
        from main import ByteTrack
        bt = ByteTrack(high=0.5, low=0.1)
        tid = bt.update([[100, 100, 50, 100, 0.9]])[0][0]
        self.assertEqual(bt.update([[102, 100, 50, 100, 0.2]]), [(tid, [102, 100, 50, 100])])
        self.assertEqual(bt.update([[500, 100, 50, 100, 0.2]]), [])

    def test_lost_track_is_rematched(self):
        from main import ByteTrack
        bt = ByteTrack(max_lost=5)
        tid = bt.update([[100, 100, 50, 100, 0.9]])[0][0]
        bt.update([])
        bt.update([])
        self.assertEqual(bt.update([[100, 100, 50, 100, 0.9]])[0][0], tid)

    def test_two_people_two_ids(self):
        from main import ByteTrack
        bt = ByteTrack()
        bt.update([[0, 0, 50, 100, 0.9], [300, 0, 50, 100, 0.9]])
        tracks = bt.update([[2, 0, 50, 100, 0.9], [302, 0, 50, 100, 0.9]])
        self.assertEqual(sorted(tid for tid, _ in tracks), [0, 1])

    def test_iou_self(self):
        from main import ByteTrack
        self.assertAlmostEqual(ByteTrack._iou([0, 0, 100, 100], [0, 0, 100, 100]), 1.0)

    def test_iou_disjoint(self):
        from main import ByteTrack
        self.assertAlmostEqual(ByteTrack._iou([0, 0, 50, 50], [100, 100, 50, 50]), 0.0)


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

    def test_submit_sends_only_status_changes(self):
        from main import CloudSync
        cloud = CloudSync(device_id="test4")
        sent = []
        cloud._send = lambda p: sent.append(p) or True
        cloud.submit({"s1": {"status": "occupied", "count": 1}})
        cloud.submit({"s1": {"status": "occupied", "count": 2}})  # same status
        cloud.submit({"s1": {"status": "empty", "count": 0},
                      "s2": {"status": "empty", "count": 0}})
        self.assertEqual([p["occupancy"] for p in sent], [
            {"s1": {"status": "occupied", "count": 1}},
            {"s1": {"status": "empty", "count": 0},
             "s2": {"status": "empty", "count": 0}},
        ])
        cloud._last_heartbeat = 0
        cloud.heartbeat()  # full snapshot
        self.assertEqual(set(sent[-1]["occupancy"]), {"s1", "s2"})

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


class TestConfigURL(unittest.TestCase):
    """load_config from the Workers GET /api/config."""

    def test_load_from_url_with_token(self):
        import http.server
        import threading
        from unittest import mock
        from utils import load_config
        seen = {}

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen["auth"] = self.headers.get("Authorization")
                body = json.dumps({"zones": [], "thresholds": {}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.handle_request, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_port}/api/config"
        with mock.patch.dict(os.environ, {"API_TOKEN": "tok"}):
            cfg = load_config(url)
        srv.server_close()
        self.assertEqual(cfg, {"zones": [], "thresholds": {}})
        self.assertEqual(seen["auth"], "Bearer tok")

    def test_unreachable_url_falls_back_to_local_file(self):
        from utils import load_config
        cwd = os.getcwd()
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        try:
            cfg = load_config("http://127.0.0.1:1/api/config")
        finally:
            os.chdir(cwd)
        self.assertIn("zones", cfg)


class TestRun(unittest.TestCase):
    """main.run(): tracks persist across frames; cameras only feed their own zones."""

    def test_seats_get_occupied_through_the_loop(self):
        from main import run, OccupancyTracker, CloudSync, Camera
        other = {"id": "z9", "camera": "cam2", "seats": [[{"name": "C1", "vertices": SQ(0)}]]}
        tracker = OccupancyTracker([ZONE, other], conf_frames=3)
        tracker.ensure_seats()
        cloud = CloudSync(device_id="t")
        detector = lambda frame: [seat_box(SQ(0))]   # someone always on A1
        run([("cam1", Camera(width=4, height=4))], [ZONE, other], detector,
            tracker, cloud, duration_s=0.3, interval_s=0.05)
        self.assertEqual(tracker.states["z1_t00_s00"].status, "occupied")
        self.assertEqual(tracker.states["z1_t00_s01"].status, "empty")
        # cam2 is not running, so its zone is untouched even though the box overlaps C1.
        self.assertEqual(tracker.states["z9_t00_s00"].status, "empty")

    def test_mock_detector_sits_on_configured_seats(self):
        from main import MockDetector, OccupancyTracker
        dets = MockDetector([ZONE], period_s=1e9)(None)   # frozen schedule
        tracker = OccupancyTracker([ZONE])
        r = tracker.process_frame(list(enumerate(dets)), ZONE)
        self.assertEqual(sum(v["count"] for v in r.values()), len(dets))


class TestDashboardServer(unittest.TestCase):
    def test_state_endpoint(self):
        import urllib.request
        from main import DashboardServer
        srv = DashboardServer(port=0, state_source=lambda: {"s": {"status": "occupied"}})
        srv.start()
        for _ in range(100):
            if srv._server:
                break
            time.sleep(0.01)
        port = srv._server.server_address[1]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=5) as r:
            self.assertEqual(json.load(r), {"s": {"status": "occupied"}})
        srv.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
