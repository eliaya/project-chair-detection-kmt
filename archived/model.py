import torch
import torch.nn as nn
import torch.nn.functional as F


def block(cin, cout):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1), nn.InstanceNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1), nn.InstanceNorm2d(cout), nn.ReLU(inplace=True),
    )


def up(t):
    return F.interpolate(t, scale_factor=2.0, mode="bilinear", align_corners=False)


class UNet(nn.Module):
    """Predicts a residual image. Input H and W must be divisible by 8."""

    def __init__(self, cin, base=32):
        super().__init__()
        self.e1, self.e2, self.e3 = block(cin, base), block(base, base * 2), block(base * 2, base * 4)
        self.mid = block(base * 4, base * 8)
        self.d3, self.d2, self.d1 = block(base * 12, base * 4), block(base * 6, base * 2), block(base * 3, base)
        self.out = nn.Conv2d(base, 3, 1)
        # zero init: an untrained stage is the identity, so training starts from "no change"
        nn.init.zeros_(self.out.weight)
        nn.init.zeros_(self.out.bias)

    def forward(self, x):
        e1 = self.e1(x)
        e2 = self.e2(F.max_pool2d(e1, 2))
        e3 = self.e3(F.max_pool2d(e2, 2))
        m = self.mid(F.max_pool2d(e3, 2))
        d3 = self.d3(torch.cat([up(m), e3], 1))
        d2 = self.d2(torch.cat([up(d3), e2], 1))
        d1 = self.d1(torch.cat([up(d2), e1], 1))
        return self.out(d1)


class CascadedNet(nn.Module):
    """Each stage refines the previous stage's output; returns every stage's output."""

    # ponytail: all stages run at full resolution; make early stages low-res if fps falls short
    def __init__(self, stages=3, base=32):
        super().__init__()
        self.stages = nn.ModuleList(UNet(3 if i == 0 else 6, base) for i in range(stages))

    def forward(self, x):
        outs, cur = [], x
        for i, stage in enumerate(self.stages):
            cur = cur + stage(cur if i == 0 else torch.cat([x, cur], 1))
            outs.append(cur)
        return outs
