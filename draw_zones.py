"""座席区域の作成ツール。

1. Pi でカメラ画像を保存:      python3 draw_zones.py --snapshot cam1.jpg --device /dev/video0
2. 管理画面の「ゾーン」→「卓と座席」でその画像を選び、座席の角をクリックして保存する
   （オフラインで描くとき: python3 draw_zones.py --image cam1.jpg --prefix A --out zone_A.json
    の出力 "seats" を同じ欄に貼り付ける）

操作（画像ウィンドウ上）:
  左クリック        頂点を追加
  Enter / Space     いまの座席を確定（3点以上）
  t                 次の卓へ（以降の座席は新しい卓に入る）
  u / Backspace     最後の頂点を取り消し（頂点がなければ最後の座席を削除）
  s                 保存して終了
  q / Esc           保存せずに終了
"""

import argparse
import json
import sys

HELP = "click: point  Enter: seat  t: next table  u: undo  s: save  q: quit"


class ZoneDrawer:
    """Seats grouped by table, in camera-image pixels. Names are <prefix>01, 02, ..."""

    def __init__(self, prefix="A"):
        self.prefix = prefix
        self.tables = [[]]     # [[{"name", "vertices"}, ...], ...]
        self.points = []       # polygon being drawn

    MAX_POINTS = 32   # the API's limit per seat

    def click(self, x, y):
        if len(self.points) < self.MAX_POINTS:
            self.points.append([int(round(x)), int(round(y))])

    def close_seat(self):
        """Finish the current polygon as a seat. Returns False if it has under 3 points."""
        if len(self.points) < 3:
            return False
        n = sum(len(t) for t in self.tables) + 1
        self.tables[-1].append({"name": f"{self.prefix}{n:02d}", "vertices": self.points})
        self.points = []
        return True

    def new_table(self):
        if self.tables[-1]:
            self.tables.append([])

    def undo(self):
        if self.points:
            self.points.pop()
        elif self.tables[-1]:
            self.tables[-1].pop()
        elif len(self.tables) > 1:
            self.tables.pop()

    def seats(self):
        """The value for the zone's "seats" field (empty tables dropped)."""
        return [t for t in self.tables if t]


def handle_key(drawer, key):
    """Apply one key press. Returns "save", "quit" or None."""
    if key in (13, 10, 32):
        drawer.close_seat()
    elif key == ord("t"):
        drawer.close_seat()
        drawer.new_table()
    elif key in (ord("u"), 8, 127):
        drawer.undo()
    elif key == ord("s"):
        drawer.close_seat()
        return "save"
    elif key in (ord("q"), 27):
        return "quit"
    return None


def render(image, drawer, scale):
    """The image scaled for display, with seats, table numbers and the polygon in progress."""
    import cv2
    import numpy as np
    out = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    colors = [(80, 200, 80), (80, 160, 255), (255, 120, 80), (200, 80, 220), (60, 220, 220)]
    for ti, table in enumerate(drawer.tables):
        color = colors[ti % len(colors)]
        for seat in table:
            pts = (np.array(seat["vertices"]) * scale).astype(np.int32)
            cv2.polylines(out, [pts], True, color, 2)
            cx, cy = pts.mean(axis=0).astype(int)
            cv2.putText(out, f'{seat["name"]} (t{ti})', (int(cx) - 30, int(cy)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    if drawer.points:
        pts = (np.array(drawer.points) * scale).astype(np.int32)
        cv2.polylines(out, [pts], False, (0, 255, 255), 2)
        for p in pts:
            cv2.circle(out, (int(p[0]), int(p[1])), 4, (0, 255, 255), -1)
    status = f"table {len(drawer.tables) - 1}  seats {sum(len(t) for t in drawer.tables)}  | {HELP}"
    cv2.rectangle(out, (0, 0), (out.shape[1], 24), (0, 0, 0), -1)
    cv2.putText(out, status, (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    return out


def draw(image_path, prefix, out_path, max_width=1280):
    import cv2
    image = cv2.imread(image_path)
    if image is None:
        sys.exit(f"{image_path} を読めません")
    # Draw on a scaled copy; points are stored in camera pixels, as main.py sees them.
    scale = min(1.0, max_width / image.shape[1])
    drawer = ZoneDrawer(prefix)
    win = "draw_zones"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win, lambda ev, x, y, *_: ev == cv2.EVENT_LBUTTONDOWN
                         and drawer.click(x / scale, y / scale))
    print(HELP)
    while True:
        cv2.imshow(win, render(image, drawer, scale))
        action = handle_key(drawer, cv2.waitKey(30) & 0xFF)
        if action == "quit" or cv2.getWindowProperty(win, cv2.WND_PROP_VISIBLE) < 1:
            print("保存せずに終了しました")
            break
        if action == "save":
            seats = drawer.seats()
            with open(out_path, "w") as f:
                json.dump({"seats": seats}, f, ensure_ascii=False)
            print(f"{out_path} に保存しました（{len(seats)}卓 / {sum(len(t) for t in seats)}席）")
            print("管理画面の「卓と座席」に貼り付ける値:")
            print(json.dumps(seats, ensure_ascii=False))
            break
    cv2.destroyAllWindows()


def snapshot(path, device, width, height):
    import cv2
    cap = cv2.VideoCapture(int(str(device).replace("/dev/video", "")))
    if not cap.isOpened():
        sys.exit(f"{device} を開けません")
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    for _ in range(10):   # let auto exposure settle
        ok, frame = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"{device} から画像を取得できません")
    cv2.imwrite(path, frame)
    print(f"{path} を保存しました（{frame.shape[1]}×{frame.shape[0]}）")


def main(argv=None):
    p = argparse.ArgumentParser(description="座席区域の作成ツール")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--snapshot", metavar="JPG", help="カメラ画像を保存（Pi で実行）")
    g.add_argument("--image", metavar="JPG", help="この画像の上に座席を描く（開発PCで実行）")
    p.add_argument("--device", default="/dev/video0")
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=1080)
    p.add_argument("--prefix", default="A", help="座席名の頭文字（A → A01, A02, ...）")
    p.add_argument("--out", default="zone.json")
    args = p.parse_args(argv)
    if args.snapshot:
        snapshot(args.snapshot, args.device, args.width, args.height)
    else:
        draw(args.image, args.prefix, args.out)


if __name__ == "__main__":
    main()
