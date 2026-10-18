"""テーブル稼働監視 main program.
YOLOv8n + ByteTrack で人物検出・追跡 → 座席区域判定 → 状態マシン → Cloudflare Workers 送信
"""

import argparse
import json
import math
import time
import threading
import os
from collections import deque
from datetime import datetime, timezone

from utils import load_config, point_in_polygon, bbox_bottom_center


# ---------------------------------------------------------------------------
# Camera (USB webcam capture, mock fallback)
# ---------------------------------------------------------------------------

class Camera:
    """USB webcam capture (device "/dev/videoN"). device=None, or a camera that
    cannot be opened, gives a gradient frame instead."""

    def __init__(self, device=None, width=1920, height=1080):
        self.device = device
        self.width = width
        self.height = height
        self._frame_idx = 0
        self._has_cam = False
        if device is None:
            return
        try:
            import cv2
            self._cap = cv2.VideoCapture(int(str(device).replace("/dev/video", "")))
            if self._cap.isOpened():
                # 1080p over USB 2.0 needs MJPEG; YUYV tops out at a few fps.
                self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
                self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # read the latest frame, not a queued one
                self._has_cam = True
            else:
                print(f"  [camera] {device} を開けません → グラデーション画像")
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

class Detector:
    """Person detection. The model is loaded once, not per frame."""

    def __init__(self, conf=0.1):
        from ultralytics import YOLO
        self.conf = conf   # low on purpose: ByteTrack uses the low-score boxes too
        self._model = YOLO("yolov8n.pt")

    def __call__(self, frame):
        """Returns [[x, y, w, h, score], ...] of persons."""
        results = self._model(frame, conf=self.conf, verbose=False)
        dets = []
        for b in results[0].boxes:
            if int(b.cls.item()) == 0:
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                dets.append([x1, y1, x2 - x1, y2 - y1, float(b.conf.item())])
        return dets


class MockDetector:
    """--mock: seated persons on the configured seats, each seat taken and
    left on its own schedule, so every state transition happens."""

    def __init__(self, zones, period_s=40):
        self.period_s = period_s
        self._seats = [seat["vertices"] for z in zones
                       for table in z["seats"] for seat in table]

    def __call__(self, frame):
        t = time.time()
        dets = []
        for k, poly in enumerate(self._seats):
            if (t / self.period_s + k * 0.37) % 1 < 0.6:  # seated 60% of the time
                cx = sum(p[0] for p in poly) / len(poly)
                cy = sum(p[1] for p in poly) / len(poly)
                w, h = 100, 140
                # Box whose lower-body point (bbox_bottom_center) is the seat centroid
                dets.append([cx - w / 2, cy - h * 0.67, w, h])
        return dets


# ---------------------------------------------------------------------------
# Tracker (ByteTrack-style IoU matching)
# ---------------------------------------------------------------------------

class ByteTrack:
    """ByteTrack association (Zhang et al., 2022): tracks are matched to high-score
    detections first, then to low-score ones, so a person who is partly hidden keeps
    the same id. Matching is greedy IoU without a Kalman filter: at about one frame
    per second seated people barely move between frames.

    update(dets) takes [x, y, w, h, score] (score defaults to 1.0) and returns
    [(track_id, [x, y, w, h])] for the tracks seen in this frame."""

    def __init__(self, high=0.5, low=0.1, match_iou=0.3, max_lost=30):
        self.high = high
        self.low = low
        self.match_iou = match_iou
        self.max_lost = max_lost    # frames a lost track is kept for re-matching
        self._tracks = {}           # id -> {"bbox": [x, y, w, h], "lost": int}
        self._next_id = 0

    def update(self, dets):
        dets = [(list(d[:4]), d[4] if len(d) > 4 else 1.0) for d in dets]
        high = [b for b, s in dets if s >= self.high]
        low = [b for b, s in dets if self.low <= s < self.high]
        pending = list(self._tracks)
        first, pending, new = self._match(pending, high)
        second, pending, _ = self._match(pending, low)   # unmatched low boxes are noise
        for tid, box in first + second:
            self._tracks[tid] = {"bbox": box, "lost": 0}
        for tid in pending:
            self._tracks[tid]["lost"] += 1
            if self._tracks[tid]["lost"] > self.max_lost:
                del self._tracks[tid]
        for box in new:
            self._tracks[self._next_id] = {"bbox": box, "lost": 0}
            self._next_id += 1
        return [(tid, t["bbox"]) for tid, t in self._tracks.items() if t["lost"] == 0]

    def _match(self, track_ids, boxes):
        """Greedy highest-IoU pairs. Returns (matches, unmatched ids, unmatched boxes)."""
        pairs = sorted(((self._iou(self._tracks[tid]["bbox"], b), tid, i)
                        for tid in track_ids for i, b in enumerate(boxes)), reverse=True)
        used_t, used_b, matches = set(), set(), []
        for iou, tid, i in pairs:
            if iou < self.match_iou:
                break
            if tid not in used_t and i not in used_b:
                used_t.add(tid)
                used_b.add(i)
                matches.append((tid, boxes[i]))
        return (matches, [t for t in track_ids if t not in used_t],
                [b for i, b in enumerate(boxes) if i not in used_b])

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
        self.count = 0              # persons in the seat polygon in the last frame
        self.last_seen = time.time()
        self.confirm_frames = 0
        self.leave_start = None
        self.occupied_since = None  # set when the seat becomes OCCUPIED

    @property
    def duration_s(self):
        """Seated time so far (wall clock, so it is right at any frame rate)."""
        return time.time() - self.occupied_since if self.occupied_since else 0.0

    def to_dict(self):
        elapsed = max(0, time.time() - self.last_seen)
        return {
            "status": self.status,
            "count": self.count,
            "duration_s": round(self.duration_s, 1),
            "last_seen_s": round(elapsed, 1),
        }


class OccupancyTracker:
    """Manages per-seat state machines across zones.
    A seat is taken while a person's lower-body point lies in its polygon."""

    def __init__(self, zones, conf_frames=3, leave_grace_s=10.0):
        self.zones = zones
        self.conf_frames = conf_frames
        self.leave_grace_s = leave_grace_s
        self.states = {}   # seat_id -> SeatState

    @staticmethod
    def _sid(zone_id, table_idx, seat_idx):
        return f"{zone_id}_t{table_idx:02d}_s{seat_idx:02d}"

    def ensure_seats(self):
        """Create SeatState for every seat in zones."""
        for z in self.zones:
            for ti, table in enumerate(z["seats"]):
                for si, _ in enumerate(table):
                    self.states.setdefault(self._sid(z["id"], ti, si), SeatState())

    def process_frame(self, tracks, zone):
        """Update the zone's seats from tracked persons. Returns per-seat result dicts."""
        seats = [(self._sid(zone["id"], ti, si), seat["vertices"])
                 for ti, table in enumerate(zone["seats"])
                 for si, seat in enumerate(table)]
        persons = {sid: 0 for sid, _ in seats}
        for _, box in tracks:
            cx, cy = bbox_bottom_center(box)
            # Each person takes at most one seat, the first polygon that contains them.
            for sid, poly in seats:
                if point_in_polygon(cx, cy, poly):
                    persons[sid] += 1
                    break

        now = time.time()
        results = {}
        for sid, _ in seats:
            state = self.states.setdefault(sid, SeatState())
            state.count = persons[sid]
            if persons[sid]:
                state.last_seen = now
                if state.status == SeatState.EMPTY:
                    state.status = SeatState.CONFIRMING
                    state.confirm_frames = 1
                elif state.status == SeatState.CONFIRMING:
                    state.confirm_frames += 1
                if state.status == SeatState.CONFIRMING and state.confirm_frames >= self.conf_frames:
                    state.status = SeatState.OCCUPIED
                    state.occupied_since = now
                    print(f"  [着席] {sid}")
                elif state.status == SeatState.LEAVE_CONFIRM:
                    # Back within the grace period: still the same guest.
                    state.status = SeatState.OCCUPIED
                    state.leave_start = None
                    print(f"  [復帰] {sid}")
            elif state.status == SeatState.OCCUPIED:
                state.status = SeatState.LEAVE_CONFIRM
                state.leave_start = now
                print(f"  [離席確認] {sid}")
            elif state.status == SeatState.CONFIRMING:
                # Disappeared before confirmation: someone passing by.
                state.status = SeatState.EMPTY
                state.confirm_frames = 0
            elif (state.status == SeatState.LEAVE_CONFIRM
                  and now - state.leave_start > self.leave_grace_s):
                print(f"  [空席] {sid} 利用 {state.duration_s:.0f}秒")
                state.status = SeatState.EMPTY
                state.occupied_since = None
                state.leave_start = None
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
        state_source, html = self._state_source, self._html()

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/api/state":
                    data = json.dumps(state_source() if state_source else {})
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data.encode())
                elif self.path == "/":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())
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
# Main loop
# ---------------------------------------------------------------------------

def run(cams, zones, detector, tracker, cloud, duration_s=None, interval_s=1.0,
        high_score=0.5):
    """Every interval: each camera's frame → persons → its own tracker → its zones' seats.
    cams: [(camera_id, Camera)]. duration_s=None runs until interrupted."""
    trackers = {cid: ByteTrack(high=high_score) for cid, _ in cams}   # tracks live across frames
    zones_of = {cid: [z for z in zones if z.get("camera") == cid] for cid, _ in cams}
    start = time.time()
    frames = 0
    while duration_s is None or time.time() - start < duration_s:
        t0 = time.time()
        for cid, cam in cams:
            tracks = trackers[cid].update(detector(cam.read_frame()))
            for z in zones_of[cid]:
                cloud.submit(tracker.process_frame(tracks, z))
        cloud.heartbeat()
        frames += len(cams)
        if frames % 10 == 0:
            print(f"  {frames} frames processed")
        time.sleep(max(0.0, interval_s - (time.time() - t0)))
    return frames


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
        device_id="pi-mock" if args.mock else "pi1")

    cam_cfgs = config.get("cameras", [])
    if not cam_cfgs:
        print("カメラなし。設定にカメラを登録してください。")
        return
    if args.mock:
        cams = [(c["id"], Camera(width=640, height=480)) for c in cam_cfgs]
        detector = MockDetector(zones)
    else:
        cams = [(c["id"], Camera(
            device=c.get("device", "/dev/video0"),
            width=c.get("resolution", [1920, 1080])[0],
            height=c.get("resolution", [1920, 1080])[1])) for c in cam_cfgs]
        detector = Detector()

    snap = lambda: {sid: st.to_dict() for sid, st in tracker.states.items()}
    srv = DashboardServer(port=args.dashboard_port, state_source=snap)
    srv.start()

    try:
        run(cams, zones, detector, tracker, cloud,
            duration_s=args.duration if args.mock else None,
            high_score=thresh.get("confidence", 0.5))
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop()
        for _, cam in cams:
            cam.release()
        print("\nStopped.")


if __name__ == "__main__":
    main()
