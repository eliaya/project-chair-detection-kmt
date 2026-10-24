"""テーブル稼働監視 main program.
YOLO26n (NCNN) + ByteTrack で人物検出・追跡 → 座席区域判定 → 状態マシン → Cloudflare Workers 送信
"""

import argparse
import hmac
import html
import json
import math
import re
import signal
import time
import threading
import os
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from utils import load_config, point_in_polygon, bbox_bottom_center

VERSION = "0.3.0"


# ---------------------------------------------------------------------------
# Camera (USB webcam capture, mock fallback)
# ---------------------------------------------------------------------------

class Camera:
    """USB webcam capture (device "/dev/videoN"). status is "ok", "open_failed" or
    "read_failed"; a failed camera returns None, so its seats are not judged on a fake
    frame, and is reopened every REOPEN_S seconds. device=None gives a gradient frame (mock)."""

    REOPEN_S = 10

    def __init__(self, device=None, width=1920, height=1080):
        self.device = device
        self.width = width
        self.height = height
        self.status = "ok"
        self._frame_idx = 0
        self._cap = None
        self._next_open = 0.0
        if device is not None:
            self._open()

    def _open(self):
        self._next_open = time.time() + self.REOPEN_S
        try:
            import cv2
        except ImportError:
            self.status = "open_failed"
            print("  [camera] OpenCV がありません (pip install opencv-python-headless)")
            return
        if self._cap is not None:
            self._cap.release()
        self._cap = cv2.VideoCapture(int(str(self.device).replace("/dev/video", "")))
        if not self._cap.isOpened():
            self.status = "open_failed"
            print(f"  [camera] {self.device} を開けません（{self.REOPEN_S}秒後に再試行）")
            return
        # 1080p over USB 2.0 needs MJPEG; YUYV tops out at a few fps.
        self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # read the latest frame, not a queued one
        if self.status != "ok":
            print(f"  [camera] {self.device} 復旧")
        self.status = "ok"

    def read_frame(self):
        if self.device is None:
            return self._gradient()
        if self.status != "ok":
            if time.time() < self._next_open:
                return None
            self._open()
            if self.status != "ok":
                return None
        ok, frame = self._cap.read()
        if not ok:
            self.status = "read_failed"
            self._next_open = time.time() + self.REOPEN_S
            print(f"  [camera] {self.device} から画像を取得できません（{self.REOPEN_S}秒後に再試行）")
            return None
        return frame

    def _gradient(self):
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
        if self._cap is not None:
            self._cap.release()


# ---------------------------------------------------------------------------
# Detection (YOLO26n on NCNN)
# ---------------------------------------------------------------------------

class Detector:
    """YOLO26n person detection on NCNN (no PyTorch on the Pi). The model is loaded
    once; export it on the dev PC with scripts/export_model.sh."""

    def __init__(self, model_dir="models/yolo26n_ncnn_model", conf=0.1, iou=0.7,
                 imgsz=640, threads=4):
        import ncnn
        if not os.path.exists(os.path.join(model_dir, "model.ncnn.param")):
            raise SystemExit(f"{model_dir} がありません。開発PCで scripts/export_model.sh を実行し、Pi にコピーしてください。")
        self.conf = conf   # low on purpose: ByteTrack uses the low-score boxes too
        self.iou = iou
        self.imgsz = imgsz
        self._ncnn = ncnn
        self._net = ncnn.Net()
        self._net.opt.num_threads = threads
        self._net.load_param(os.path.join(model_dir, "model.ncnn.param"))
        self._net.load_model(os.path.join(model_dir, "model.ncnn.bin"))

    def __call__(self, frame):
        """frame: BGR image. Returns [[x, y, w, h, score], ...] of persons."""
        import cv2
        import numpy as np
        h, w = frame.shape[:2]
        r = min(self.imgsz / h, self.imgsz / w)
        nh, nw = round(h * r), round(w * r)
        top, left = (self.imgsz - nh) // 2, (self.imgsz - nw) // 2
        # Letterbox like Ultralytics: keep the aspect ratio, pad with gray.
        canvas = np.full((self.imgsz, self.imgsz, 3), 114, np.uint8)
        canvas[top:top + nh, left:left + nw] = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
        blob = np.ascontiguousarray(canvas[:, :, ::-1].transpose(2, 0, 1), dtype=np.float32) / 255
        with self._net.create_extractor() as ex:
            ex.input("in0", self._ncnn.Mat(blob))
            _, out = ex.extract("out0")
        # out0: (84, 8400) = cx, cy, w, h in input pixels, then 80 class scores (0 = person).
        out = np.array(out)
        scores = out[4]
        keep = scores >= self.conf
        cx, cy, bw, bh = out[:4, keep]
        boxes = np.stack([(cx - bw / 2 - left) / r, (cy - bh / 2 - top) / r, bw / r, bh / r], axis=1)
        idx = cv2.dnn.NMSBoxes(boxes.tolist(), scores[keep].tolist(), self.conf, self.iou)
        return [[*boxes[i].tolist(), float(scores[keep][i])] for i in np.array(idx).flatten()]


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
        self._tracks = {}           # id -> {"bbox": [x, y, w, h], "lost": int, "t": float}
        self._next_id = 0
        self.speed = {}             # id -> px/s of the lower-body point at the last match

    def update(self, dets):
        dets = [(list(d[:4]), d[4] if len(d) > 4 else 1.0) for d in dets]
        high = [b for b, s in dets if s >= self.high]
        low = [b for b, s in dets if self.low <= s < self.high]
        pending = list(self._tracks)
        first, pending, new = self._match(pending, high)
        second, pending, _ = self._match(pending, low)   # unmatched low boxes are noise
        now = time.time()
        for tid, box in first + second:
            old = self._tracks[tid]
            (ox, oy), (nx, ny) = bbox_bottom_center(old["bbox"]), bbox_bottom_center(box)
            self.speed[tid] = math.hypot(nx - ox, ny - oy) / max(now - old["t"], 1e-3)
            self._tracks[tid] = {"bbox": box, "lost": 0, "t": now}
        for tid in pending:
            self._tracks[tid]["lost"] += 1
            if self._tracks[tid]["lost"] > self.max_lost:
                del self._tracks[tid]
                self.speed.pop(tid, None)
        for box in new:
            self._tracks[self._next_id] = {"bbox": box, "lost": 0, "t": now}
            self.speed[self._next_id] = 0.0
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


def is_staff(box, speed, max_aspect=2.0, max_speed=50.0):
    """Staff and passers-by are standing (tall box, height/width above max_aspect)
    or moving fast (lower-body point above max_speed px/s); they never take a seat."""
    return box[3] / max(box[2], 1e-9) > max_aspect or speed > max_speed


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


def annotate(frame, tracks, zones, states, max_width=960):
    """JPEG of a processed frame for the admin UI's live view: seats in their status color and
    tracked persons (white box + track id), scaled down to max_width. None for a mock frame."""
    import cv2
    import numpy as np
    if getattr(frame, "ndim", 0) != 3:
        return None
    scale = min(1.0, max_width / frame.shape[1])
    img = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    for z in zones:
        for ti, table in enumerate(z["seats"]):
            for si, seat in enumerate(table):
                st = states.get(OccupancyTracker._sid(z["id"], ti, si))
                pts = (np.array(seat["vertices"]) * scale).astype(np.int32)
                cv2.polylines(img, [pts], True, LIVE_COLORS.get(st and st.status, LIVE_COLORS[None]), 2)
    for tid, box in tracks:
        x, y, w, h = (int(v * scale) for v in box)
        cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 255), 2)
        cv2.putText(img, str(tid), (x + 2, max(y - 4, 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])[1].tobytes()


# BGR, the dashboard's colors: red occupied, green empty, orange confirming / leave_confirm
LIVE_COLORS = {SeatState.OCCUPIED: (60, 76, 231), SeatState.EMPTY: (113, 204, 46), None: (18, 156, 243)}


# ---------------------------------------------------------------------------
# Cloud Sync (HTTPS POST, SQLite offline buffer)
# ---------------------------------------------------------------------------

class CloudSync:
    """JSON sender to Cloudflare Workers. Payloads wait in a SQLite outbox until the
    Worker accepts them, so status changes survive network outages and reboots."""

    # shortcut: oldest payloads are dropped past this; at change-only rates that is days offline.
    MAX_QUEUE = 10_000

    def __init__(self, api_url=None, token=None, device_id="pi1", queue_path="queue.db"):
        self.api_url = api_url or os.environ.get("API_URL", "")
        # The env var wins: a config.json fallback only carries a placeholder token.
        self.token = os.environ.get("API_TOKEN") or token or ""
        self.device_id = device_id
        self._db = sqlite3.connect(queue_path)
        self._db.execute("CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        self._db.commit()
        self._online = True
        self._last_heartbeat = 0.0   # first heartbeat at once: the admin UI shows "connected"
        self._last = {}   # seat_id -> latest result, re-sent by heartbeat

    def _payload(self, occupancy):
        return {
            "device_id": self.device_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "occupancy": occupancy,
        }

    def queued(self):
        return self._db.execute("SELECT count(*) FROM outbox").fetchone()[0]

    def submit(self, results):
        """Send only seats whose status changed (keeps Workers/D1 in free tier)."""
        changed = {sid: r for sid, r in results.items()
                   if self._last.get(sid, {}).get("status") != r.get("status")}
        self._last.update(results)
        if not changed or not self.api_url:
            return
        self._db.execute("INSERT INTO outbox (payload) VALUES (?)", (json.dumps(self._payload(changed)),))
        self._db.execute("DELETE FROM outbox WHERE id <= (SELECT max(id) FROM outbox) - ?", (self.MAX_QUEUE,))
        self._db.commit()
        # While offline, only the heartbeat retries, so the loop does not wait on timeouts.
        if self._online:
            self._flush()

    def _flush(self):
        """Send queued payloads oldest first; stop at the first failure."""
        for row_id, payload in self._db.execute("SELECT id, payload FROM outbox ORDER BY id").fetchall():
            self._online = self._send(json.loads(payload))
            if not self._online:
                return False
            self._db.execute("DELETE FROM outbox WHERE id = ?", (row_id,))
            self._db.commit()
        return True

    def heartbeat(self, health=None):
        """Every 30 s: flush the outbox, then send all seats plus the Pi's health."""
        now = time.time()
        if now - self._last_heartbeat < 30 or not self.api_url:
            return
        self._last_heartbeat = now
        print(f"  [heartbeat] {self.device_id} (未送信 {self.queued()} 件)")
        # Full snapshot: keeps the device "online" (90 s rule) and repairs lost updates.
        if self._flush():
            payload = self._payload(dict(self._last))
            if health:
                payload["health"] = health
            self._online = self._send(payload)

    def _send(self, payload):
        req = urllib.request.Request(
            self.api_url, data=json.dumps(payload).encode(), method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            # A rejected payload never succeeds: drop it rather than block the queue.
            # 401/429/5xx keep it (a token fix or a retry can still deliver it).
            print(f"    [cloud err] HTTP {e.code}")
            return e.code in (400, 413)
        except OSError as e:
            print(f"    [cloud err] {e}")
            return False


# ---------------------------------------------------------------------------
# Settings (API_TOKEN, CONFIG_URL) entered on the dashboard's /setup page
# ---------------------------------------------------------------------------

class Settings:
    """API_TOKEN and CONFIG_URL in an env file (on the Pi: conf/kmt-occupancy.env, mounted at /conf).
    A save first fetches the config with them, so a typo never replaces working settings."""

    KEYS = ("API_TOKEN", "CONFIG_URL")

    def __init__(self, path):
        self.path = path
        self.values = {}
        try:
            with open(path) as f:
                for line in f:
                    k, sep, v = line.strip().partition("=")
                    if sep and k in self.KEYS:
                        self.values[k] = v
        except FileNotFoundError:
            pass

    @property
    def complete(self):
        return all(self.values.get(k) for k in self.KEYS)

    def save(self, form):
        """form: the /setup POST fields. Returns an error message, or None once saved."""
        url = form.get("config_url", "").strip()
        token = form.get("api_token", "").strip()
        current = self.values.get("API_TOKEN", "")
        # LAN-reachable page: once a token is set, only someone who knows it may replace it.
        if current and not hmac.compare_digest(form.get("current_token", "").encode(), current.encode()):
            return "現在のトークンが違います"
        # \S only: a newline would add lines to the env file
        if not re.fullmatch(r"https?://\S{1,2040}", url):
            return "設定 URL は http:// または https:// で始めてください（空白なし）"
        if not re.fullmatch(r"\S{1,512}", token):
            return "トークンを入力してください（空白なし）"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                json.load(resp)
        except urllib.error.HTTPError as e:
            return f"設定を取得できません: HTTP {e.code}" + ("（トークンが無効）" if e.code in (401, 403) else "")
        except (OSError, ValueError) as e:
            return f"設定を取得できません: {e}"
        tmp = self.path + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            f.write(f"API_TOKEN={token}\nCONFIG_URL={url}\n")
        os.replace(tmp, self.path)
        self.values = {"API_TOKEN": token, "CONFIG_URL": url}
        return None

    def page(self, msg="", ok=False):
        url = html.escape(self.values.get("CONFIG_URL", ""))
        state = "設定済み" if self.complete else "未設定（座席の検出は設定後に始まります）"
        note = f'<p class="{"ok" if ok else "err"}">{html.escape(msg)}</p>' if msg else ""
        current = ""
        if self.values.get("API_TOKEN"):
            current = ('<label>現在のトークン（変更の確認用。忘れた場合は Pi で '
                       'conf/kmt-occupancy.env を削除してコンテナを再起動）'
                       '<input name="current_token" type="password" required autocomplete="off"></label>')
        refresh = '<meta http-equiv="refresh" content="15;url=/">' if ok else ""
        return f"""<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
{refresh}<title>Pi 設定</title>
<style>body{{font-family:sans-serif;max-width:34em;margin:20px auto;padding:0 16px;background:#fafafa}}
label{{display:block;margin-top:14px}}input{{width:100%;padding:8px;box-sizing:border-box;font-size:1em}}
button{{margin-top:18px;padding:8px 24px;font-size:1em}}.err{{color:#c0392b}}.ok{{color:#27ae60}}</style></head>
<body><h1>Pi 設定</h1>
<p>状態: {state}</p>{note}
<form method="post" action="/setup">
<label>設定 URL<input name="config_url" type="url" required value="{url}" placeholder="https://&lt;worker&gt;/api/config"></label>
<label>デバイストークン（管理画面「デバイス」で発行）<input name="api_token" type="password" required autocomplete="off"></label>
{current}
<button>保存して再起動</button></form>
<p>保存の前に、設定 URL へこのトークンで接続して確認します。<a href="/">稼働状況</a></p>
</body></html>"""


# ---------------------------------------------------------------------------
# Dashboard HTTP Server (local occupancy display)
# ---------------------------------------------------------------------------

class DashboardServer(threading.Thread):
    """Simple HTTP server serving seat status dashboard."""

    def __init__(self, port=8080, state_source=None, settings=None, on_saved=None):
        super().__init__(daemon=True)
        self.port = port
        self._state_source = state_source
        self._settings = settings
        self._on_saved = on_saved
        self._server = None
        self._running = False

    def run(self):
        import http.server
        import socketserver
        state_source, page = self._state_source, self._html()
        settings, on_saved = self._settings, self._on_saved
        if settings:
            page = page.replace("</body>", '<p style="text-align:center"><a href="/setup">設定</a></p></body>')

        class H(http.server.BaseHTTPRequestHandler):
            def _page(self, body, code=200):
                self.send_response(code)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body.encode())

            def do_POST(self):
                if not settings or self.path != "/setup":
                    self.send_response(404)
                    self.end_headers()
                    return
                n = int(self.headers.get("Content-Length") or 0)
                if n > 8192:
                    self.send_response(413)
                    self.end_headers()
                    return
                form = {k: v[0] for k, v in urllib.parse.parse_qs(
                    self.rfile.read(n).decode("utf-8", "replace"), max_num_fields=10).items()}
                err = settings.save(form)
                if err:
                    self._page(settings.page(err), 400)
                    return
                self._page(settings.page("保存しました。再起動して新しい設定で始めます（約 15 秒）。", ok=True))
                print("  [setup] 設定を保存しました。再起動します")
                if on_saved:
                    on_saved()

            def do_GET(self):
                if settings and self.path == "/setup":
                    self._page(settings.page())
                elif self.path == "/api/state":
                    data = json.dumps(state_source() if state_source else {})
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data.encode())
                elif self.path == "/":
                    self._page(page)
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
# Live view uplink (WebSocket to the Worker)
# ---------------------------------------------------------------------------

class LiveUplink(threading.Thread):
    """Live view in the admin UI: a WebSocket to the Worker (web/worker/live.ts), which says
    which cameras are watched ({"watch": [...]}); only their frames go up, about once a
    second, as "<camera id>\\n<JPEG>". Outbound only, so it works behind the store's NAT."""

    RETRY_S = 30

    def __init__(self, config_url, token, frame_source):
        super().__init__(daemon=True)
        u = urllib.parse.urlsplit(config_url)
        self.url = urllib.parse.urlunsplit(
            ("wss" if u.scheme == "https" else "ws", u.netloc, "/api/live", "", ""))
        self.token = token
        self.frame_source = frame_source   # camera id -> JPEG bytes or None

    def run(self):
        try:
            from websockets.sync.client import connect
        except ImportError:
            print("  [live] websockets がありません（pip install websockets）。ライブ映像なし")
            return
        while True:
            try:
                with connect(self.url, open_timeout=10,
                             additional_headers={"Authorization": f"Bearer {self.token}"}) as ws:
                    print(f"  [live] {self.url} に接続")
                    self.serve(ws)
            except Exception as e:   # network, token, Worker restart: try again later
                print(f"  [live] 切断 ({e})。{self.RETRY_S}秒後に再接続")
            time.sleep(self.RETRY_S)

    def serve(self, ws):
        watch, next_send = [], 0.0
        while True:
            try:
                msg = ws.recv(timeout=max(0.0, next_send - time.time()))
                if isinstance(msg, str):
                    watch = json.loads(msg).get("watch", [])
                continue
            except TimeoutError:
                pass
            next_send = time.time() + 1.0
            for cid in watch:
                jpg = self.frame_source(cid)
                if jpg:
                    ws.send(cid.encode() + b"\n" + jpg)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run(cams, zones, detector, tracker, cloud, duration_s=None, interval_s=1.0,
        high_score=0.5, staff_aspect=2.0, staff_speed=50.0, live=None):
    """Every interval: each camera's frame → persons → its own tracker → its zones' seats.
    cams: [(camera_id, Camera)]. duration_s=None runs until interrupted.
    live: dict, gets each camera's (str id) latest (frame, tracks, zones) for LiveUplink."""
    live = {} if live is None else live
    trackers = {cid: ByteTrack(high=high_score) for cid, _ in cams}   # tracks live across frames
    zones_of = {cid: [z for z in zones if z.get("camera") == cid] for cid, _ in cams}
    start = time.time()
    frames = 0
    infer_ms = 0.0
    while duration_s is None or time.time() - start < duration_s:
        t0 = time.time()
        for cid, cam in cams:
            frame = cam.read_frame()
            if frame is None:
                # No fake frame: the Worker shows this camera's seats as unknown.
                live.pop(str(cid), None)
                continue
            t1 = time.time()
            dets = detector(frame)
            infer_ms = (time.time() - t1) * 1000
            bt = trackers[cid]
            tracks = [(tid, box) for tid, box in bt.update(dets)
                      if not is_staff(box, bt.speed[tid], staff_aspect, staff_speed)]
            for z in zones_of[cid]:
                cloud.submit(tracker.process_frame(tracks, z))
            live[str(cid)] = (frame, tracks, zones_of[cid])
        cloud.heartbeat(health={
            "version": VERSION,
            "queue": cloud.queued(),
            "infer_ms": round(infer_ms),
            "cameras": {cid: cam.status for cid, cam in cams},
        })
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
    p.add_argument("--settings", help="API_TOKEN・CONFIG_URL の env ファイル（/setup で入力。Pi: /conf/kmt-occupancy.env）")
    args = p.parse_args(argv)

    print("=" * 50)
    print(f" テーブル稼働監視システム v{VERSION}")
    print("=" * 50)

    settings = Settings(args.settings) if args.settings else None
    # After a save: leave through KeyboardInterrupt (cameras released); Docker's restart policy
    # starts main.py again with the new settings.
    restart = lambda: threading.Timer(1.0, os.kill, (os.getpid(), signal.SIGINT)).start()
    if settings:
        os.environ.update({k: v for k, v in settings.values.items() if v})
        if not settings.complete:
            srv = DashboardServer(port=args.dashboard_port, settings=settings, on_saved=restart)
            srv.start()
            print(f"  [setup] 未設定: http://<Pi の IP>:{args.dashboard_port}/setup で設定 URL とトークンを入力してください")
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
            finally:
                srv.stop()
            return
        args.config = settings.values["CONFIG_URL"]

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
        # Keep sending heartbeats so the admin UI shows the Pi as connected.
        print("カメラなし。管理画面でカメラを登録し、main.py を再起動してください。")
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
    srv = DashboardServer(port=args.dashboard_port, state_source=snap,
                          settings=settings, on_saved=restart)
    srv.start()
    live = {}
    if args.config.startswith(("http://", "https://")) and os.environ.get("API_TOKEN"):
        # Drawn and encoded only for watched cameras, so no cost while nobody watches.
        LiveUplink(args.config, os.environ["API_TOKEN"],
                   lambda cid: (got := live.get(cid)) and annotate(*got, tracker.states)).start()

    try:
        run(cams, zones, detector, tracker, cloud,
            duration_s=args.duration if args.mock else None,
            high_score=thresh.get("confidence", 0.5),
            staff_aspect=thresh.get("staff_aspect_ratio", 2.0),
            staff_speed=thresh.get("staff_speed_px", 50.0), live=live)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop()
        for _, cam in cams:
            cam.release()
        print("\nStopped.")


if __name__ == "__main__":
    main()
