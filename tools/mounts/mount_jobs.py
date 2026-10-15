#!/usr/bin/env python3
"""Reads every mount from the game's own data and writes what the Mounts page and the renderer need.

  python3 tools/mounts/mount_jobs.py --game Game.swz --login Login.swz --rigs <folder> [--jobs jobs.tsv]

  Game.swz   MountTypes: id, internal name, display name, rarity, level, idol cost, description
             (use the file the live game serves: its names are the real ones; the June 2026
             dungeon-blitz-r copy still calls 88 mounts "Ancient Crypt Walker")
  Login.swz  EntTypes: how each mount is drawn (rig, CustomArt sets, ColorSwaps, BaseAnim)
  <folder>   holds Animation_HorseMount.swf and Animation_DireMount.swf (the rigs)

Writes data/mounts.json, and with --jobs the job list for tools/mounts/Mount.java.

How the client draws a mount (SuperAnimData, GfxType, decompiled DungeonBlitz.swf):
  - the rig is the entity's AnimFile, class a__Animation, at its BaseAnim label (else "Ready");
  - each part on the rig whose class is X becomes X_<set>, trying the CustomArt sets from the
    last one to the first, and stays X when none exists;
  - every solid fill whose colour is a ColorSwap key takes the new colour. A key is 0xRRGGBB or
    a named colour (data/mounts/named-colors.json, DungeonBlitz.method_787); an unknown name
    reads as 0 (black), as uint(undefined) does in the client. The table is filled from the
    last swap to the first, so the first swap for a colour wins.
"""
import argparse
import json
import os
import re
import struct
import xml.etree.ElementTree as ET
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def rot(k, s):
    return ((k << (32 - s)) | (k >> s)) & 0xFFFFFFFF if s else k


def swz_chunks(path):
    """The client's packed XML: a rolling XOR key, then zlib per chunk (as in DB Inventory Scanner)."""
    raw = open(path, "rb").read()
    key, count = struct.unpack(">II", raw[:8])
    pos, rk, out = 8, key, []
    for _ in range(count):
        n = struct.unpack(">I", raw[pos:pos + 4])[0]
        pos += 4
        buf = bytearray(n)
        for j in range(n):
            buf[j] = raw[pos + j] ^ (rk & 0xFF)
            rk = rot(rk, j & 7)
        pos += n
        out.append(zlib.decompress(bytes(buf)).decode("utf-8", "replace"))
    return out


def chunk(chunks, root_tag):
    for c in chunks:
        if re.search(r"<%s\b" % root_tag, c[:400]):
            return c
    raise SystemExit("no <%s> in archive" % root_tag)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True)
    ap.add_argument("--login", required=True)
    ap.add_argument("--rigs", required=True)
    ap.add_argument("--jobs")
    a = ap.parse_args()

    named = {k: int(v, 16) for k, v in json.load(open(os.path.join(ROOT, "data/mounts/named-colors.json"))).items()}

    def color(s):
        s = s.strip()
        return int(s, 16) if s.startswith("0") else named.get(s, 0)

    ents = {}
    text = chunk(swz_chunks(a.login), "EntTypes")
    for m in re.finditer(r'<EntType EntName="([^"]*)"(?: parent="([^"]*)")?.*?</EntType>', text, re.S):
        ents[m.group(1)] = (m.group(2), ET.fromstring(m.group(0)))

    def gfx_chain(name):
        chain = []
        while name:
            parent, el = ents[name]
            chain.append(el.find("GfxType"))
            name = parent
        return [g for g in chain if g is not None]

    mounts, jobs = [], []
    root = ET.fromstring(chunk(swz_chunks(a.game), "MountTypes"))
    for m in root:
        key = m.get("MountName")
        if key.startswith("---"):
            continue
        chain = gfx_chain(key)
        anim = next(g.findtext("AnimFile") for g in chain if g.findtext("AnimFile"))
        base = next((g.findtext("BaseAnim") for g in chain if g.findtext("BaseAnim")), "Ready")
        sets, swaps = [], {}
        order = []
        for c in chain[0]:
            if c.tag.startswith("CustomArt"):
                f, s = c.text.strip().split("/")
                assert f == anim, (key, f)
                sets.append(s)
            elif c.tag.startswith("ColorSwap"):
                old, new = c.text.split("=")
                order.append((color(old), color(new)))
        for old, new in order:
            swaps.setdefault(old, new)
        mid = int(m.findtext("MountID"))
        mounts.append({
            "id": mid,
            "key": key,
            "name": (m.findtext("DisplayName") or "").strip(),
            "rarity": (m.findtext("DisplayRarity") or "").strip(),
            "level": int(m.findtext("MountLevel") or 0),
            "idols": int(m.findtext("IdolCost") or 0),
            "description": re.sub(r"\s+", " ", (m.findtext("Description") or "").strip()),
            "rig": "Horse" if "Horse" in anim else "Dire",
            "entity": (ents[key][1].findtext("DisplayName") or "").strip(),
        })
        jobs.append("\t".join(["%03d" % mid, os.path.join(a.rigs, anim), base, ",".join(sets),
                               ";".join("%06X=%06X" % kv for kv in swaps.items())]))

    mounts.sort(key=lambda x: x["id"])
    with open(os.path.join(ROOT, "data/mounts.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "MountTypes from the live game's Game.swz, drawing rules from its Login.swz EntTypes",
                   "mounts": mounts}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    if a.jobs:
        open(a.jobs, "w").write("\n".join(jobs) + "\n")
    print("%d mounts" % len(mounts))


if __name__ == "__main__":
    main()
