"""Runs the whole pipeline on tiny fake pairs: python test_smoke.py"""
import tempfile
from pathlib import Path

import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from skimage import data
from torchvision.utils import save_image

import eval as evaluate
import infer
import train
from model import CascadedNet


def fake_pairs(root, n=40, size=32):
    for sub in ("makeup", "bare"):
        (root / sub).mkdir(parents=True)
    for i in range(n):
        bare = F.interpolate(torch.rand(1, 3, 4, 4), size=size, mode="bilinear", align_corners=False)[0]
        makeup = bare.clone()
        makeup[0, size // 2:, size // 4: 3 * size // 4] += 0.4  # red "lipstick" patch
        save_image(bare, root / "bare" / f"{i:03}.png")
        save_image(makeup.clamp(0, 1), root / "makeup" / f"{i:03}.png")


def demo():
    torch.manual_seed(0)
    x = torch.rand(2, 3, 32, 32)

    net = CascadedNet(stages=2, base=8)
    outs = net(x)
    assert len(outs) == 2 and all(torch.equal(o, x) for o in outs), "untrained net must be the identity"
    assert train.temporal_loss(net, x, outs[-1]).item() < 1e-6, "identity net must be temporally consistent"

    perc = train.Perceptual(pretrained=False)
    assert perc(x, x).item() == 0 and perc(x, 1 - x).item() > 0

    with tempfile.TemporaryDirectory() as d:
        root, out = Path(d) / "pairs", Path(d) / "run"
        fake_pairs(root)
        common = ["--data", str(root), "--out", str(out), "--size", "32", "--stages", "2", "--base", "8",
                  "--bs", "8", "--lr", "2e-3", "--lambda-perc", "0", "--degrade-p", "0", "--workers", "0"]
        hist = train.main(common + ["--epochs", "30"])
        assert len(hist) == 30 and hist[-1] < hist[0] * 0.5, hist
        assert len(train.main(common + ["--epochs", "31"])) == 31, "resume must continue, not restart"

        res = evaluate.main(["--data", str(root), "--ckpt", str(out / "last.pt"), "--size", "32"])
        assert res["clean"]["psnr_out"] > res["clean"]["psnr_in"] + 3, res["clean"]
        assert res["fps"] > 0

        # video inference: a real face photo, shifted a little each frame
        face = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
        box = infer.detect(face)
        assert box is not None and abs(box[0] - 222) < 30 and abs(box[1] - 114) < 30, box
        x0, y0, side = infer.square(box, 1.3, *face.shape[:2])
        assert (infer.remove_makeup(net, face, x0, y0, side, 64, "cpu") == face).all(), "identity net must not touch the frame"
        nn.init.constant_(net.stages[-1].out.bias, 0.2)
        diff = infer.remove_makeup(net, face, x0, y0, side, 64, "cpu") != face
        assert diff[y0 + side // 2, x0 + side // 2].all(), "face centre must change"
        diff[y0:y0 + side, x0:x0 + side] = False
        assert not diff.any(), "pixels outside the face square must not change"

        src, dst = str(Path(d) / "in.mp4"), str(Path(d) / "out.mp4")
        w = cv2.VideoWriter(src, cv2.VideoWriter_fourcc(*"mp4v"), 10, (512, 512))
        for i in range(5):
            w.write(torch.from_numpy(face).roll(4 * i, 1).numpy())
        w.release()
        assert infer.main(["--video", src, "--ckpt", str(out / "last.pt"), "--out", dst, "--size", "32"]) == (5, 0)
        cap = cv2.VideoCapture(dst)
        assert cap.get(cv2.CAP_PROP_FRAME_COUNT) == 5 and cap.read()[1].shape == (512, 512, 3)
    print("smoke test passed")


if __name__ == "__main__":
    demo()
