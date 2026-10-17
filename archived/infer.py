import argparse

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from skimage import data
from skimage.feature import Cascade

from model import CascadedNet

# ponytail: LBP cascade bundled with scikit-image, frontal faces only;
# swap in RetinaFace / YuNet once profile or occluded faces get missed
DETECTOR = Cascade(data.lbp_frontal_face_cascade_filename())
DETECT_SIDE = 320  # detection runs on a frame shrunk to this long side


def detect(frame):
    """frame: BGR uint8 HWC. Largest face as float (cx, cy, side) in frame pixels, or None."""
    s = min(1.0, DETECT_SIDE / max(frame.shape[:2]))
    gray = cv2.cvtColor(cv2.resize(frame, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    faces = DETECTOR.detect_multi_scale(img=gray, scale_factor=1.2, step_ratio=1,
                                        min_size=(24, 24), max_size=(DETECT_SIDE, DETECT_SIDE))
    if not faces:
        return None
    f = max(faces, key=lambda f: f["width"] * f["height"])
    return np.array([f["c"] + f["width"] / 2, f["r"] + f["height"] / 2, max(f["width"], f["height"])]) / s


def square(box, margin, h, w):
    """(cx, cy, side) -> integer x0, y0, side of a square lying inside the frame."""
    side = int(min(box[2] * margin, h, w))
    x0 = int(min(max(box[0] - side / 2, 0), w - side))
    y0 = int(min(max(box[1] - side / 2, 0), h - side))
    return x0, y0, side


@torch.no_grad()
def remove_makeup(net, frame, x0, y0, side, size, dev):
    """Adds the net's residual to the face square of a BGR uint8 frame, feathered at the square's edge."""
    crop = torch.from_numpy(frame[y0:y0 + side, x0:x0 + side, ::-1].copy()).to(dev).permute(2, 0, 1)[None] / 255
    small = F.interpolate(crop, size=(size, size), mode="bilinear", align_corners=False, antialias=True)
    # pasting the residual, not the output, keeps the frame's own detail above `size`
    # and makes an untrained net leave the frame untouched
    res = F.interpolate(net(small)[-1] - small, size=(side, side), mode="bilinear", align_corners=False)
    i = torch.arange(side, device=dev)
    t = (torch.minimum(i, side - 1 - i) / (side * 0.1)).clamp(max=1)
    out = (crop + res * t[:, None] * t[None, :]).clamp(0, 1)
    frame = frame.copy()
    frame[y0:y0 + side, x0:x0 + side] = (out[0].permute(1, 2, 0) * 255).round().byte().cpu().numpy()[:, :, ::-1]
    return frame


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--ckpt", required=True)
    p.add_argument("--out", required=True, help="output .mp4")
    p.add_argument("--size", type=int, default=256, help="must match the training --size")
    p.add_argument("--margin", type=float, default=1.3,
                   help="crop side / detected face side; tune until crops are framed like the training pairs")
    p.add_argument("--smooth", type=float, default=0.5,
                   help="weight of the previous frame's box; higher = steadier crop, slower to follow motion")
    args = p.parse_args(argv)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ck = torch.load(args.ckpt, map_location=dev, weights_only=True)
    net = CascadedNet(ck["stages"], ck["base"]).to(dev).eval()
    net.load_state_dict(ck["net"])

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {args.video}")
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    # ponytail: mp4v video only, the audio track is dropped; mux it back with ffmpeg if needed
    writer = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"), cap.get(cv2.CAP_PROP_FPS) or 30, (w, h))
    if not writer.isOpened():
        raise SystemExit(f"cannot write {args.out}")

    # ponytail: one face per video, and a lost face keeps its last box forever;
    # track per face and expire stale boxes once multi-person or cut-heavy video matters
    box, frames, missed = None, 0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        found = detect(frame)
        if found is None:
            missed += 1
        else:
            box = found if box is None else args.smooth * box + (1 - args.smooth) * found
        if box is not None:
            frame = remove_makeup(net, frame, *square(box, args.margin, h, w), args.size, dev)
        writer.write(frame)
        frames += 1
    cap.release()
    writer.release()
    print(f"{frames} frames written to {args.out}, no face detected in {missed}")
    return frames, missed


if __name__ == "__main__":
    main()
