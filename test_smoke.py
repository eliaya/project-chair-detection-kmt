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

    def test_speed_of_moving_person(self):
        from main import ByteTrack
        bt = ByteTrack()
        tid = bt.update([[100, 100, 50, 100, 0.9]])[0][0]
        bt._tracks[tid]["t"] -= 1.0   # pretend one second passed
        bt.update([[106, 108, 50, 100, 0.9]])
        self.assertAlmostEqual(bt.speed[tid], 10.0, delta=0.1)   # 6-8-10 triangle

    def test_is_staff(self):
        from main import is_staff
        self.assertFalse(is_staff([0, 0, 100, 140], speed=5))     # seated
        self.assertTrue(is_staff([0, 0, 60, 180], speed=5))       # standing
        self.assertTrue(is_staff([0, 0, 100, 140], speed=200))    # walking past

    def test_iou_self(self):
        from main import ByteTrack
        self.assertAlmostEqual(ByteTrack._iou([0, 0, 100, 100], [0, 0, 100, 100]), 1.0)

    def test_iou_disjoint(self):
        from main import ByteTrack
        self.assertAlmostEqual(ByteTrack._iou([0, 0, 50, 50], [100, 100, 50, 50]), 0.0)


class TestCloudSync(unittest.TestCase):
    """SQLite outbox: nothing is lost while the Worker is unreachable."""

    URL = "http://127.0.0.1:1/api/occupancy"   # nothing listens on port 1

    def cloud(self, path=":memory:", **kw):
        from main import CloudSync
        return CloudSync(api_url=kw.pop("api_url", self.URL), device_id="t", queue_path=path, **kw)

    def test_submit_without_url_sends_nothing(self):
        from main import CloudSync
        cloud = CloudSync(api_url="", device_id="t", queue_path=":memory:")
        cloud.submit({"s1": {"status": "occupied"}})
        self.assertEqual(cloud.queued(), 0)

    def test_unreachable_server_queues(self):
        cloud = self.cloud()
        cloud.submit({"s1": {"status": "occupied"}})
        self.assertEqual(cloud.queued(), 1)

    def test_queue_survives_restart(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "q.db")
            self.cloud(path).submit({"s1": {"status": "occupied"}})
            again = self.cloud(path)
            sent = []
            again._send = lambda p: sent.append(p) or True
            again._last_heartbeat = 0
            again.heartbeat()
            self.assertEqual(sent[0]["occupancy"], {"s1": {"status": "occupied"}})
            self.assertEqual(again.queued(), 0)

    def test_offline_submit_waits_for_heartbeat_and_keeps_order(self):
        cloud = self.cloud()
        sent, up = [], [False]
        cloud._send = lambda p: up[0] and (sent.append(p["occupancy"]) or True)
        cloud.submit({"s1": {"status": "confirming"}})   # fails, goes offline
        cloud.submit({"s1": {"status": "occupied"}})     # offline: queued, not tried
        self.assertEqual((sent, cloud.queued()), ([], 2))
        up[0] = True
        cloud._last_heartbeat = 0
        cloud.heartbeat()
        self.assertEqual(sent[:2], [{"s1": {"status": "confirming"}},
                                    {"s1": {"status": "occupied"}}])
        self.assertEqual(cloud.queued(), 0)

    def test_submit_sends_only_status_changes(self):
        cloud = self.cloud()
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

    def test_http_errors(self):
        """400 is dropped (never succeeds); 401 stays queued (fix the token, then it goes)."""
        import http.server, threading
        codes = [400, 401]

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(codes.pop(0))
                self.end_headers()

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            cloud = self.cloud(api_url=f"http://127.0.0.1:{srv.server_port}/api/occupancy")
            cloud.submit({"s1": {"status": "occupied"}})
            self.assertEqual(cloud.queued(), 0)
            cloud.submit({"s1": {"status": "empty"}})
            self.assertEqual(cloud.queued(), 1)
        finally:
            srv.shutdown()

    def test_env_token_beats_config_placeholder(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"API_TOKEN": "real"}):
            self.assertEqual(self.cloud(token="YOUR_TOKEN").token, "real")


class TestCamera(unittest.TestCase):
    def test_mock_frame(self):
        from main import Camera
        cam = Camera(width=10, height=10)
        self.assertIsNotNone(cam.read_frame())
        cam.release()

    def test_missing_camera_gives_no_frame(self):
        from main import Camera
        cam = Camera(device="/dev/video97")
        self.assertEqual(cam.status, "open_failed")
        self.assertIsNone(cam.read_frame())
        cam.release()

    def test_read_failure_and_reopen(self):
        from main import Camera
        cam = Camera()
        cam.device = "/dev/video97"

        class Cap:
            def read(self):
                return False, None

            def release(self):
                pass

        cam._cap = Cap()
        self.assertIsNone(cam.read_frame())
        self.assertEqual(cam.status, "read_failed")
        opened = []
        cam._open = lambda: opened.append(1)
        self.assertIsNone(cam.read_frame())       # waits REOPEN_S before retrying
        self.assertEqual(opened, [])
        cam._next_open = 0
        cam.read_frame()
        self.assertEqual(opened, [1])


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
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            cache = os.path.join(d, "cache.json")
            with mock.patch.dict(os.environ, {"API_TOKEN": "tok"}):
                cfg = load_config(url, cache_path=cache)
            srv.server_close()
            self.assertEqual(cfg, {"zones": [], "thresholds": {}})
            self.assertEqual(seen["auth"], "Bearer tok")
            # Offline later: the cached copy is used, not the sample config.json.
            self.assertEqual(load_config("http://127.0.0.1:1/api/config", cache_path=cache), cfg)

    def test_unreachable_url_without_cache_falls_back_to_local_file(self):
        from utils import load_config
        cwd = os.getcwd()
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        try:
            cfg = load_config("http://127.0.0.1:1/api/config", cache_path="/nonexistent/c.json")
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
        cloud = CloudSync(api_url="", device_id="t", queue_path=":memory:")
        detector = lambda frame: [seat_box(SQ(0))]   # someone always on A1
        run([("cam1", Camera(width=4, height=4))], [ZONE, other], detector,
            tracker, cloud, duration_s=0.3, interval_s=0.05)
        self.assertEqual(tracker.states["z1_t00_s00"].status, "occupied")
        self.assertEqual(tracker.states["z1_t00_s01"].status, "empty")
        # cam2 is not running, so its zone is untouched even though the box overlaps C1.
        self.assertEqual(tracker.states["z9_t00_s00"].status, "empty")

    def test_standing_person_does_not_take_a_seat(self):
        from main import run, OccupancyTracker, CloudSync, Camera
        tracker = OccupancyTracker([ZONE], conf_frames=1)
        cx, cy = 50, 50   # centre of A1
        standing = [cx - 20, cy - 200 * 0.67, 40, 200]   # height/width 5
        run([("cam1", Camera(width=4, height=4))], [ZONE], lambda f: [standing], tracker,
            CloudSync(api_url="", device_id="t", queue_path=":memory:"),
            duration_s=0.2, interval_s=0.05)
        self.assertEqual(tracker.states["z1_t00_s00"].status, "empty")

    def test_failed_camera_is_not_judged_and_is_reported(self):
        from main import run, OccupancyTracker, CloudSync, VERSION

        class DeadCam:
            status = "open_failed"

            def read_frame(self):
                return None

        tracker = OccupancyTracker([ZONE])
        tracker.ensure_seats()
        cloud = CloudSync(api_url="http://x/api/occupancy", device_id="t", queue_path=":memory:")
        sent = []
        cloud._send = lambda p: sent.append(p) or True
        called = []
        run([("cam1", DeadCam())], [ZONE], lambda f: called.append(f) or [], tracker, cloud,
            duration_s=0.1, interval_s=0.05)
        self.assertEqual(called, [])                         # detector never sees a fake frame
        self.assertEqual(sent[0]["health"]["cameras"], {"cam1": "open_failed"})
        self.assertEqual(sent[0]["health"]["version"], VERSION)
        self.assertEqual(sent[0]["occupancy"], {})          # first heartbeat goes out at once

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


class TestDrawZones(unittest.TestCase):
    def draw_two_tables(self):
        from draw_zones import ZoneDrawer, handle_key
        d = ZoneDrawer(prefix="B")
        for x in (0, 100):                      # table 0: two seats
            for px, py in ((x, 0), (x + 90, 0), (x + 90, 90)):
                d.click(px, py)
            handle_key(d, 13)                   # Enter
        handle_key(d, ord("t"))
        for px, py in ((300, 0), (390, 0), (390, 90), (300, 90)):
            d.click(px + 0.4, py)               # stored as camera pixels (ints)
        return d, handle_key(d, ord("s"))       # s closes the open seat and saves

    def test_tables_seats_and_names(self):
        d, action = self.draw_two_tables()
        self.assertEqual(action, "save")
        seats = d.seats()
        self.assertEqual([[x["name"] for x in t] for t in seats], [["B01", "B02"], ["B03"]])
        self.assertEqual(seats[1][0]["vertices"], [[300, 0], [390, 0], [390, 90], [300, 90]])

    def test_needs_three_points_and_undo(self):
        from draw_zones import ZoneDrawer, handle_key
        d = ZoneDrawer()
        d.click(0, 0); d.click(10, 0)
        handle_key(d, 13)
        self.assertEqual(d.seats(), [])         # 2 points: not a seat
        d.click(10, 10); handle_key(d, 13)
        handle_key(d, ord("u"))                 # removes the seat
        self.assertEqual((d.seats(), d.points), ([], []))
        self.assertEqual(handle_key(d, 27), "quit")

    def test_output_works_in_main(self):
        """What draw_zones writes is what OccupancyTracker reads."""
        from main import OccupancyTracker
        d, _ = self.draw_two_tables()
        zone = {"id": "zB", "camera": "cam1", "seats": d.seats()}
        t = OccupancyTracker([zone])
        r = t.process_frame([(0, seat_box([[300, 0], [390, 0], [390, 90], [300, 90]]))], zone)
        self.assertEqual(r["zB_t01_s00"]["status"], "confirming")

    def test_render(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy / OpenCV not installed")
        from draw_zones import render
        d, _ = self.draw_two_tables()
        img = np.zeros((1080, 1920, 3), np.uint8)
        out = render(img, d, 0.5)
        self.assertEqual(out.shape, (540, 960, 3))
        self.assertGreater(out.sum(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
