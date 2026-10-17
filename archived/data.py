import random
from pathlib import Path

import torch
import torchvision.transforms.functional as TF
from PIL import Image
from torch.utils.data import Dataset
from torchvision.io import decode_jpeg, encode_jpeg

EXT = {".png", ".jpg", ".jpeg"}
KINDS = ["dark", "blur", "jpeg"]


def degrade(x, kind):
    """x: float CHW in [0, 1]. Simulates low light, blur or compression."""
    if kind == "dark":
        return x * 0.35
    if kind == "blur":
        return TF.gaussian_blur(x, kernel_size=9, sigma=2.0)
    if kind == "jpeg":
        u8 = (x * 255).round().clamp(0, 255).to(torch.uint8)
        return decode_jpeg(encode_jpeg(u8, quality=20)).float() / 255
    raise ValueError(kind)


class PairDataset(Dataset):
    """root/makeup/NAME and root/bare/NAME are the same face, pixel aligned."""

    def __init__(self, root, split, size=256, degrade_p=0.0):
        self.root, self.size, self.train, self.degrade_p = Path(root), size, split == "train", degrade_p
        names = sorted(p.name for p in (self.root / "makeup").iterdir() if p.suffix.lower() in EXT)
        if len(names) < 2:
            raise ValueError(f"need at least 2 image pairs under {self.root}/makeup")
        # ponytail: split by filename, the same person can land in both splits;
        # split by identity once the data carries person ids
        n_val = max(1, len(names) // 10)
        self.names = names[:-n_val] if self.train else names[-n_val:]

    def __len__(self):
        return len(self.names)

    def load(self, sub, name):
        img = Image.open(self.root / sub / name).convert("RGB").resize((self.size, self.size), Image.BILINEAR)
        return TF.to_tensor(img)

    def __getitem__(self, i):
        x, y = self.load("makeup", self.names[i]), self.load("bare", self.names[i])
        if self.train:
            if random.random() < 0.5:
                x, y = x.flip(-1), y.flip(-1)
            if random.random() < self.degrade_p:
                x = degrade(x, random.choice(KINDS))
        return x, y
