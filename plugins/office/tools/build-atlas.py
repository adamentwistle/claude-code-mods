#!/usr/bin/env python3
"""Builds the office's picture-character atlas from Kenney's CC0 packs.

Usage: tools/build-atlas.py <folder holding the unzipped packs> [out folder]

The folder holds the unzipped `roguelike-indoors` and `roguelike-characters`
packs from https://kenney.nl (CC0). Only the
tiles the office uses are copied, into one indexed image:

  assets/office-atlas.bin   one byte per pixel, a palette index (0 is clear)
  assets/office-atlas.json  width, height, palette, and each tile's rect
  tests/atlas-fixture.ts    the same two, inlined, for the tests

Tiles are named `<pack>:<col>,<row>` after their place in the pack's sheet.
"""
import base64
import json
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..")

SHEETS = {
    "ind": ("roguelike-indoors/Tilesheets/roguelikeIndoor_transparent.png", 17),
    "chr": ("roguelike-characters/Spritesheet/roguelikeChar_transparent.png", 17),
}


def block(c0, c1, r0, r1):
    return [(c, r) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


WANTED = {
    "ind": [(0, 8)],  # the office chair, behind each person
    "chr": (
        block(0, 1, 0, 2)  # bodies, three skin tones
        + block(3, 4, 1, 9)  # trousers and shoes
        + block(6, 17, 0, 2)
        + block(6, 17, 5, 7)  # tops
        + [(c, r) for c in (19, 20, 23, 24) for r in (0, 1, 4, 5, 8, 9)]  # hair
        + [(c, r) for c in (21, 22, 25, 26) for r in (0, 4, 8)]  # beards
    ),
}


def main():
    tiles = []
    for pack, cells in WANTED.items():
        path, stride = SHEETS[pack]
        sheet = Image.open(os.path.join(SRC, path)).convert("RGBA")
        for c, r in cells:
            tiles.append((f"{pack}:{c},{r}", sheet.crop((c * stride, r * stride, c * stride + 16, r * stride + 16))))

    per_row = 16
    width = per_row * 16
    height = ((len(tiles) + per_row - 1) // per_row) * 16
    palette = [(0, 0, 0, 0)]
    index = {(0, 0, 0, 0): 0}
    data = bytearray(width * height)
    rects = {}
    for i, (name, im) in enumerate(tiles):
        x0, y0 = (i % per_row) * 16, (i // per_row) * 16
        rects[name] = [x0, y0, 16, 16]
        px = im.load()
        for y in range(16):
            for x in range(16):
                r, g, b, a = px[x, y]
                key = (0, 0, 0, 0) if a < 128 else (r, g, b, 255)
                if key not in index:
                    index[key] = len(palette)
                    palette.append(key)
                data[(y0 + y) * width + x0 + x] = index[key]
    if len(palette) > 256:
        raise SystemExit(f"{len(palette)} colours: more than one byte holds")

    meta = {"width": width, "height": height, "palette": palette, "sprites": rects}
    os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
    with open(os.path.join(OUT, "assets/office-atlas.bin"), "wb") as f:
        f.write(data)
    with open(os.path.join(OUT, "assets/office-atlas.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    with open(os.path.join(OUT, "tests/atlas-fixture.ts"), "w") as f:
        f.write("// Written by tools/build-atlas.py: the character atlas, inlined for the tests.\n")
        f.write(f"export const ATLAS_JSON = {json.dumps(json.dumps(meta, separators=(',', ':')))}\n")
        f.write(f"export const ATLAS_BIN = '{base64.b64encode(bytes(data)).decode()}'\n")
    print(f"{len(tiles)} tiles, {width}x{height}, {len(palette)} colours, {len(data)} bytes")


main()
