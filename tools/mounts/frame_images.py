#!/usr/bin/env python3
"""Turns the renderer's full-stage PNGs into centred mount pictures.

The renderer draws each mount on the whole animation stage, so the mount sits somewhere
inside a large empty canvas. This crops to what is actually drawn, ignoring nearly clear
pixels and stray specks cut off from the mount by empty rows or columns (the armoured
dragons have a 3-pixel dot far above their heads), then scales it to fit a fixed 3:2 frame
with the same margin on every side, centred both ways, so every picture lines up.

  python3 tools/mounts/frame_images.py <render dir> data/mounts.json mounts

<render dir>/<id>/**/<frame>.png  ->  <out dir>/thumb/<MountName>.webp (192x128)
                                      <out dir>/large/<MountName>.webp (480x320)
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

SIZES = {"thumb": (192, 128, 6), "large": (480, 320, 12)}  # width, height, margin


def _span(counts, speck):
    """First and last index of the drawn part, dropping end bands of fewer than `speck` pixels."""
    on = np.flatnonzero(counts)
    bands = np.split(on, np.flatnonzero(np.diff(on) > 1) + 1)
    while len(bands) > 1 and counts[bands[0]].sum() < speck:
        bands.pop(0)
    while len(bands) > 1 and counts[bands[-1]].sum() < speck:
        bands.pop()
    return bands[0][0], bands[-1][-1] + 1


def content_box(im, threshold=24, speck=40):
    mask = np.asarray(im.getchannel("A")) > threshold
    y0, y1 = _span(mask.sum(axis=1), speck)
    x0, x1 = _span(mask[y0:y1].sum(axis=0), speck)
    return int(x0), int(y0), int(x1), int(y1)


def frame(im, w, h, pad):
    art = im.crop(content_box(im))
    scale = min((w - 2 * pad) / art.width, (h - 2 * pad) / art.height)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(art, ((w - art.width) // 2, (h - art.height) // 2), art)
    return out


def main():
    raw, meta, out = sys.argv[1:4]
    mounts = json.load(open(meta, encoding="utf-8"))
    mounts = mounts["mounts"] if isinstance(mounts, dict) else mounts
    for size in SIZES:
        os.makedirs(os.path.join(out, size), exist_ok=True)
    for m in mounts:
        files = glob.glob(os.path.join(raw, "%03d" % m["id"], "**", "*.png"), recursive=True)
        if len(files) != 1:
            raise SystemExit("expected one render for %s, found %d" % (m["key"], len(files)))
        im = Image.open(files[0]).convert("RGBA")
        for size, (w, h, pad) in SIZES.items():
            frame(im, w, h, pad).save(os.path.join(out, size, m["key"] + ".webp"), "WEBP", quality=90, method=4)
    print("framed %d mounts" % len(mounts))


if __name__ == "__main__":
    main()
