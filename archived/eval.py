import argparse
import time

import torch
from skimage.metrics import structural_similarity

from data import KINDS, PairDataset, degrade
from model import CascadedNet


def psnr(a, b):
    return (-10 * torch.log10(((a - b) ** 2).mean().clamp_min(1e-10))).item()


def ssim(a, b):
    return structural_similarity(a.permute(1, 2, 0).numpy(), b.permute(1, 2, 0).numpy(), channel_axis=2, data_range=1.0)


@torch.no_grad()
def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--ckpt", required=True)
    p.add_argument("--size", type=int, default=256)
    args = p.parse_args(argv)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ck = torch.load(args.ckpt, map_location=dev, weights_only=True)
    net = CascadedNet(ck["stages"], ck["base"]).to(dev).eval()
    net.load_state_dict(ck["net"])
    ds = PairDataset(args.data, "val", args.size)

    results = {}
    print(f"{'input':8} {'PSNR in':>8} {'PSNR out':>9} {'SSIM in':>8} {'SSIM out':>9}   ({len(ds)} val pairs)")
    for kind in ["clean"] + KINDS:
        rows = []
        for x, y in ds:
            if kind != "clean":
                x = degrade(x, kind)
            o = net(x[None].to(dev))[-1][0].clamp(0, 1).float().cpu()
            rows.append([psnr(x, y), psnr(o, y), ssim(x, y), ssim(o, y)])
        m = torch.tensor(rows).mean(0).tolist()
        results[kind] = dict(zip(["psnr_in", "psnr_out", "ssim_in", "ssim_out"], m))
        print(f"{kind:8} {m[0]:8.2f} {m[1]:9.2f} {m[2]:8.4f} {m[3]:9.4f}")

    x = torch.rand(1, 3, args.size, args.size, device=dev)
    for _ in range(3):
        net(x)
    if dev == "cuda":
        torch.cuda.synchronize()
    t = time.perf_counter()
    for _ in range(20):
        net(x)
    if dev == "cuda":
        torch.cuda.synchronize()
    results["fps"] = 20 / (time.perf_counter() - t)
    print(f"model only, {args.size}x{args.size}, {dev}: {results['fps']:.1f} fps")
    return results


if __name__ == "__main__":
    main()
