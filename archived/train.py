import argparse
import math
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision
from torch.utils.data import DataLoader

from data import PairDataset
from model import CascadedNet


class Perceptual(nn.Module):
    """L1 distance between VGG16 relu3_3 features."""

    def __init__(self, pretrained=True):
        super().__init__()
        vgg = torchvision.models.vgg16(weights="IMAGENET1K_V1" if pretrained else None)
        self.vgg = vgg.features[:16].eval().requires_grad_(False)
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, a, b):
        return F.l1_loss(self.vgg((a - self.mean) / self.std), self.vgg((b - self.mean) / self.std))


def random_affine(n, device, max_deg=5.0, max_shift=0.1, max_scale=0.05):
    """Small random rotation / scale / shift, standing in for motion between two frames."""
    ang = (torch.rand(n, device=device) * 2 - 1) * math.radians(max_deg)
    s = 1 + (torch.rand(n, device=device) * 2 - 1) * max_scale
    t = (torch.rand(n, 2, device=device) * 2 - 1) * max_shift
    rot = torch.stack([torch.stack([s * ang.cos(), -s * ang.sin()], 1),
                       torch.stack([s * ang.sin(), s * ang.cos()], 1)], 1)
    return torch.cat([rot, t.unsqueeze(-1)], 2)


def warp(img, theta):
    grid = F.affine_grid(theta, list(img.shape), align_corners=False)
    return F.grid_sample(img, grid, padding_mode="zeros", align_corners=False)


def temporal_loss(net, x, out):
    """The output for a moved frame should equal the moved output. No optical flow needed."""
    theta = random_affine(x.shape[0], x.device)
    mask = warp(torch.ones_like(x), theta)
    return (mask * (warp(out, theta) - net(warp(x, theta))[-1]).abs()).mean()


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="folder holding makeup/ and bare/")
    p.add_argument("--out", required=True, help="checkpoint folder; point it at Drive on Colab")
    p.add_argument("--size", type=int, default=256)
    p.add_argument("--stages", type=int, default=3)
    p.add_argument("--base", type=int, default=32)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--bs", type=int, default=16)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--lambda-perc", type=float, default=0.1)
    p.add_argument("--lambda-temp", type=float, default=1.0)
    p.add_argument("--degrade-p", type=float, default=0.3)
    p.add_argument("--workers", type=int, default=2)
    args = p.parse_args(argv)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    amp = dev == "cuda"
    ds = PairDataset(args.data, "train", args.size, args.degrade_p)
    dl = DataLoader(ds, batch_size=min(args.bs, len(ds)), shuffle=True, num_workers=args.workers, drop_last=True)
    net = CascadedNet(args.stages, args.base).to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    perc = Perceptual().to(dev) if args.lambda_perc > 0 else None
    scaler = torch.amp.GradScaler(dev, enabled=amp)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    ckpt, start, history = out / "last.pt", 0, []
    if ckpt.exists():  # Colab sessions get cut off; carry on from the last finished epoch
        ck = torch.load(ckpt, map_location=dev, weights_only=True)
        net.load_state_dict(ck["net"])
        opt.load_state_dict(ck["opt"])
        start, history = ck["epoch"], ck["history"]
        print(f"resumed from epoch {start}")

    for epoch in range(start, args.epochs):
        total = 0.0
        for x, y in dl:
            x, y = x.to(dev), y.to(dev)
            with torch.autocast(dev, enabled=amp):
                outs = net(x)
                loss = sum(F.l1_loss(o, y) for o in outs)
                if perc is not None:
                    loss = loss + args.lambda_perc * perc(outs[-1], y)
                if args.lambda_temp > 0:
                    loss = loss + args.lambda_temp * temporal_loss(net, x, outs[-1])
            opt.zero_grad()
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            total += loss.item()
        history.append(total / len(dl))
        print(f"epoch {epoch + 1}/{args.epochs} loss {history[-1]:.4f}", flush=True)
        tmp = out / "last.pt.tmp"
        torch.save({"net": net.state_dict(), "opt": opt.state_dict(), "epoch": epoch + 1, "history": history,
                    "stages": args.stages, "base": args.base}, tmp)
        tmp.replace(ckpt)  # atomic: a disconnect mid-save cannot corrupt the checkpoint
    return history


if __name__ == "__main__":
    main()
