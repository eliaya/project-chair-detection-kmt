"""テーブル稼働監視 main program.
YOLOv8n + ByteTrack で人物検出・追跡 → 座席区域判定 → 状態マシン → Cloudflare Workers 送信
"""

import argparse
import json
import math
import time
import threading
import os
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone

from utils import load_config, point_in_polygon, bbox_bottom_center


# ---------------------------------------------------------------------------
# Camera (USB webcam capture, mock fallback)
# ---------------------------------------------------------------------------

class Camera:
    """USB webcam capture. Falls back to gradient frame."""

    def __init__(self, device=0, width=1920, height=1080):
        self.device = device
        self.width = width
        self.height = height
        self._frame_idx = 0
        self._has_cam = False
        try:
            import cv2
            self._cap = cv2.VideoCapture(device)
            if self._cap.isOpened():
                self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
                self._has_cam = True
        except ImportError:
            pass

    def read_frame(self):
        if self._has_cam:
            ok, frame = self._cap.read()
            if ok:
                return frame
        # Mock: horizontal gradient frame
        t = time.time() + self._frame_idx * 0.1
        row = []
        for x in range(self.width):
            r = int(80 + 40 * math.sin(x / max(self.width, 1) * 6 + t)) & 0xFF
            g = int(100 + 50 * math.cos(x / max(self.width, 1) * 4 + t)) & 0xFF
            b = int(60 + 30 * math.sin((x + self.height) / max(self.width + self.height, 1) * 8 + t)) & 0xFF
            row.append([r, g, b])
        self._frame_idx += 1
        return row

    def release(self):
        if hasattr(self, "_cap"):
            self._cap.release()


# ---------------------------------------------------------------------------
# Detection (YOLOv8n placeholder)
# ---------------------------------------------------------------------------

def detect(frame, conf=0.5):
    """Person detection. Returns [[x, y, w, h], ...]."""
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")
        results = model(frame, conf=conf, verbose=False)
        dets = []
        for b in results[0].boxes:
            if int(b.cls.item()) == 0:
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                dets.append([x1, y1, x2 - x1, y2 - y1])
        return dets
    except ImportError:
        pass

    # Mock: two person boxes that drift slightly each frame
    w = getattr(frame, "width", 640) or 640
    h = getattr(frame, "height", 480) or 480
    cx, cy = w // 2, h // 2
    t = time.time() % 5
    ox = int(40 * math.sin(t * 2))
    oy = int(30 * math.cos(t * 3))
    return [
        [cx - 60 + ox, cy - 80 + oy, 120, 160],
        [cx + 60 + ox, cy - 40 + oy, 100, 140],
    ]


# ---------------------------------------------------------------------------
# Tracker (ByteTrack-style IoU matching)
# ---------------------------------------------------------------------------

class ByteTrack:
    """Minimal ByteTrack: IoU assignment + age tracking."""

    def __init__(self, max_age=3, min_hits=2):
        self.max_age = max_age
        self.min_hits = min_hits
        self._tracks = {}   # id -> {"bbox": [x,y,w,h], "age": int}
        self._next_id = 0

    def update(self, dets):
        matched = set()
        new_tracks = {}
        for det in dets:
            best_score = 0
            best_id = None
            for tid, t in self._tracks.items():
                if t["age"] >= self.max_age:
                    continue
                s = self._iou(det, t["bbox"])
                if s > best_score:
                    best_score = s
                    best_id = tid
                    matched.add(tid)
            if best_score > 0.3 and best_id is not None:
                new_tracks[best_id] = {
                    "bbox": det,
                    "age": self._tracks[best_id]["age"] + 1,
                }
            else:
                nid = self._next_id
                self._next_id += 1
                new_tracks[nid] = {"bbox": det, "age": 1}
        self._tracks = new_tracks
        return [(tid, t["bbox"]) for tid, t in self._tracks.items()
                if t["age"] >= self.min_hits]

    @staticmethod
    def _iou(a, b):
        x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
        x2 = min(a[0]+a[2], b[0]+b[2]); y2 = min(a[1]+a[3], b[1]+b[3])
        inter = max(0, x2-x1) * max(0, y2-y1)
        ua = a[2] * a[3]; ub = b[2] * b[3]
        return inter / max(ua + ub - inter, 1e-9)


# ---------------------------------------------------------------------------
# State Machine (per seat)
# ---------------------------------------------------------------------------

class SeatState:
    """ occupancy state for a single seat. """
    EMPTY = "empty"
    CONFIRMING = "confirming"
    OCCUPIED = "occupied"
    LEAVE_CONFIRM = "leave_confirm"

    def __init__(self):
        self.status = self.EMPTY
        self.count = 0
        self.duration_s = 0.0
        self.last_seen = time.time()
        self.confirm_frames = 0
        self.leave_start = None

    def to_dict(self):
        elapsed = max(0, time.time() - self.last_seen)
        return {
            "status": self.status,
            "count": self.count,
            "duration_s": round(self.duration_s, 1),
            "last_seen_s": round(elapsed, 1),
        }


class OccupancyTracker:
    """Manages per-seat state machines across zones."""

    def __init__(self, zones, conf_frames=3, leave_grace_s=10.0):
        self.zones = zones
        self.conf_frames = conf_frames
        self.leave_grace_s = leave_grace_s
        self.states = {}   # seat_id -> SeatState

    @staticmethod
    def _sid(zone_id, idx):
        return f"{zone_id}_s{idx:02d}"

    def ensure_seats(self):
        """Create SeatState for every seat in zones."""
        for z in self.zones:
            for idx, seats in enumerate(z["seats"]):
                for _ in seats:
                    sid = self._sid(z["id"], idx)
                    if sid not in self.states:
                        self.states[sid] = SeatState()

    def process_frame(self, tracks, zone):
        """Update states from tracked persons. Returns per-seat result dicts."""
        results = {}
        occupied_sids = set()

        for _, box in tracks:
            cx, cy = bbox_bottom_center(box)
            if point_in_polygon(cx, cy, zone["vertices"]):
                for idx in range(len(zone["seats"])):
                    sid = self._sid(zone["id"], idx)
                    occupied_sids.add(sid)

        for z in self.zones:
            if z["id"] != zone["id"]:
                continue
            for idx, seat_ids in enumerate(z["seats"]):
                for si in range(len(seat_ids)):
                    sid = f"{zone['id']}_s{idx:02d}"
                    state = self.states.get(sid)
                    if state is None:
                        state = SeatState()
                        self.states[sid] = state

                    has_person = sid in occupied_sids
                    was_occupied = state.status == SeatState.OCCUPIED

                    if has_person:
                        state.count += 1
                        state.last_seen = time.time()
                        if state.status == SeatState.EMPTY:
                            state.status = SeatState.CONFIRMING
                            state.confirm_frames = 1
                        elif state.status == SeatState.CONFIRMING:
                            state.confirm_frames += 1
                            if state.confirm_frames >= self.conf_frames:
                                state.status = SeatState.OCCUPIED
                                state.duration_s = 0.0
                                print(f"  [着席] {sid}")
                        elif state.status == SeatState.LEAVE_CONFIRM:
                            state.status = SeatState.CONFIRMING
                            state.confirm_frames = 1
                            state.leave_start = None
                            print(f"  [復帰] {sid}")
                    else:
                        if was_occupied:
                            state.status = SeatState.LEAVE_CONFIRM
                            state.leave_start = time.time()
                            print(f"  [離席確認] {sid}")
                        elif state.status == SeatState.CONFIRMING:
                            state.status = SeatState.EMPTY
                            state.confirm_frames = 0
                        # LEAVE_CONFIRM stays until grace expires

                    if state.status == SeatState.OCCUPIED:
                        state.duration_s += 1.0
                    elif state.status == SeatState.LEAVE_CONFIRM and state.leave_start:
                        elapsed = time.time() - state.leave_start
                        if elapsed > self.leave_grace_s:
                            state.status = SeatState.EMPTY
                            state.count = 0
                            state.duration_s = 0.0
                            print(f"  [空席] {sid}")

                    results[sid] = state.to_dict()

        return results


# ---------------------------------------------------------------------------
# Cloud Sync (HTTPS POST, SQLite offline buffer)
# ---------------------------------------------------------------------------

class CloudSync:
    """JSON sender to Cloudflare Workers. Offline → local queue."""

    def __init__(self, api_url=None, token=None, device_id="pi1"):
        self.api_url = api_url or os.environ.get("API_URL", "")
        self.token = token or os.environ.get("API_TOKEN", "demo")
        self.device_id = device_id
        self._queue = deque()
        self._last_heartbeat = time.time()
        self._last = {}   # seat_id -> latest result, re-sent by heartbeat

    def _payload(self, occupancy):
        return {
            "device_id": self.device_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "occupancy": occupancy,
        }

    def submit(self, results):
        """Send only seats whose status changed (keeps Workers/D1 in free tier)."""
        changed = {sid: r for sid, r in results.items()
                   if self._last.get(sid, {}).get("status") != r.get("status")}
        self._last.update(results)
        if changed:
            payload = self._payload(changed)
            if not self._send(payload):
                self._queue.append(payload)

    def heartbeat(self):
        now = time.time()
        if now - self._last_heartbeat < 30:
            return
        self._last_heartbeat = now
        print(f"  [heartbeat] {self.device_id}")
        while self._queue:
            self._send(self._queue.popleft())
        # Full snapshot: keeps the device "online" (90 s rule) and repairs lost updates.
        if self._last:
            self._send(self._payload(dict(self._last)))

    def _send(self, payload):
        if not self.api_url:
            return True
        try:
            import requests
            resp = requests.post(
                self.api_url, json=payload,
                headers={"Authorization": f"Bearer {self.token}"}, timeout=5)
            return resp.ok
        except ImportError:
            pass  # No requests lib → mock success
        except Exception as e:
            print(f"    [cloud err] {e}")
        return False


# ---------------------------------------------------------------------------
# Dashboard HTTP Server (local occupancy display)
# ---------------------------------------------------------------------------

class DashboardServer(threading.Thread):
    """Simple HTTP server serving seat status dashboard."""

    def __init__(self, port=8080, state_source=None):
        super().__init__(daemon=True)
        self.port = port
        self._state_source = state_source
        self._server = None
        self._running = False

    def run(self):
        import http.server
        import socketserver

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/api/state":
                    snap = {}
                    try:
                        snap = {sid: st.to_dict() for sid, st in
                                (self._state_source() or {}).items()}
                    except Exception:
                        pass
                    data = json.dumps(snap)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data.encode())
                elif self.path == "/":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(self._html().encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, *a):
                pass

        self._server = socketserver.TCPServer(("", self.port), H)
        self._running = True
        print(f"  [dashboard] http://localhost:{self.port}")
        while self._running:
            self._server.handle_request()

    @staticmethod
    def _html():
        return """<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>テーブル稼働状況</title>
<style>body{font-family:sans-serif;margin:20px;background:#fafafa}
h1{text-align:center}
table{border-collapse:collapse;width:max-content;margin:20px auto}
td,th{border:1px solid #ccc;padding:16px;text-align:center;font-size:1.1em}
th{background:#f0f0f0}
.occupied{background:#e74c3c;color:white}
.empty{background:#2ecc71;color:white}
.confirming,.leave_confirm{background:#f39c12;color:white}
</style></head>
<body><h1>テーブル稼働状況</h1>
<div id="g"></div>
<script>
function u(){fetch("/api/state").then(r=>r.json()).then(d=>{var h="<table>";
for(var s in d){var v=d[s];h+='<tr><td>'+s+'</td><td class="'+v.status+'">'+
v.status+'</td></tr>'}h+="</table>";document.getElementById("g").innerHTML=h;
setTimeout(u,2000)};}u();</script>
</body></html>"""

    def stop(self):
        self._running = False
        if self._server:
            self._server.server_close()


# ---------------------------------------------------------------------------
# Mock loop (for testing without camera)
# ---------------------------------------------------------------------------

def _run_mock(config, duration_s=10):
    """Run with mock camera frames."""
    zones = config.get("zones", [])
    thresh = config.get("thresholds", {})
    tracker = OccupancyTracker(
        zones,
        conf_frames=thresh.get("confirm_frames", 3),
        leave_grace_s=thresh.get("leave_grace_s", 10.0))
    tracker.ensure_seats()
    cloud = CloudSync(device_id="pi-mock")
    cam = Camera(width=640, height=480)

    start = time.time()
    frames = 0
    while time.time() - start < duration_s:
        frame = cam.read_frame()
        dets = detect(frame, conf=thresh.get("confidence", 0.5))
        if zones:
            z = zones[0]
            tracks = ByteTrack().update(dets)
            results = tracker.process_frame(tracks, z)
            cloud.submit(results)

            frames += 1
            if frames % 3 == 0:
                print(f"\n--- Frame {frames} ---")
                for sid, st in sorted(results.items()):
                    if st["status"] != "empty":
                        print(f"  {sid}: {st['status']} dur={st['duration_s']}s")

        cloud.heartbeat()
        time.sleep(1.0)

    print(f"\nMock loop done: {frames} frames")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

def main(argv=None):
    p = argparse.ArgumentParser(description="テーブル稼働監視システム")
    p.add_argument("--config", default="config.json", help="設定JSONパス")
    p.add_argument("--mock", action="store_true", help="モックフレームでテスト")
    p.add_argument("--duration", type=int, default=10, help="モック秒数")
    p.add_argument("--dashboard-port", type=int, default=8080)
    args = p.parse_args(argv)

    print("=" * 50)
    print(" テーブル稼働監視システム v1.0")
    print("=" * 50)

    config = load_config(args.config)
    zones = config.get("zones", [])
    thresh = config.get("thresholds", {})

    tracker = OccupancyTracker(
        zones,
        conf_frames=thresh.get("confirm_frames", 3),
        leave_grace_s=thresh.get("leave_grace_s", 10.0))
    tracker.ensure_seats()

    cloud_cfg = config.get("cloud", {})
    cloud = CloudSync(
        api_url=cloud_cfg.get("api_url"),
        token=cloud_cfg.get("token"),
        device_id="pi1")

    snap = lambda: {sid: st.to_dict() for sid, st in tracker.states.items()}
    srv = DashboardServer(port=args.dashboard_port, state_source=snap)
    srv.start()

    try:
        if args.mock:
            _run_mock(config, duration_s=args.duration)
        else:
            cams = [Camera(
                device=int(c.get("device", 0).replace("/dev/video", "")),
                width=c.get("resolution", [1920, 1080])[0],
                height=c.get("resolution", [1920, 1080])[1])
                    for c in config.get("cameras", [])]
            if not cams:
                print("カメラなし。--mock でテストしてください。")
                return

            frames = 0
            while True:
                for cam in cams:
                    frame = cam.read_frame()
                    dets = detect(frame, conf=thresh.get("confidence", 0.5))
                    for z in zones:
                        tracks = ByteTrack().update(dets)
                        results = tracker.process_frame(tracks, z)
                        cloud.submit(results)
                cloud.heartbeat()
                frames += len(cams)
                if frames % 10 == 0:
                    print(f"  {frames} frames processed")
                time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop()
        print("\nStopped.")


if __name__ == "__main__":
    main()
