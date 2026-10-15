#!/usr/bin/env python3
"""Rebuilds the item list (data/catalog.json) from the game's own gear definitions.

  python3 tools/build_catalog.py --login Login.swz --game Game.swz

  Login.swz  GearTypes: every gear item's name, class, slot, id, rarity, stat focus, runes,
             skill rune, magic and level (use the file the live game serves)
  Game.swz   PowerModTypes: names and descriptions of skill runes that data/names.json
             doesn't have yet (the live game gives Legendaries their own skill runes,
             "LegendaryCleave" and so on, which add a bonus to another skill)

Writes data/catalog.json in DB Inventory Scanner's layout ({n, c, s, id, t, r, f, p, k, m, l}
per item), keeping its "charms" list, and adds the missing skill runes to data/names.json.
Only Magic, Rare and Legendary items are listed; the live game's 18 Mystic ("Y") versions of
the Treasure Trove items are left out for now.

Inventory scans (data/scans) carry stats read from the game, but their focus, runes, skill
rune and magic fields come from the scanner's own copy of this list, so this file, not the
scans, is what the table shows for them.
"""
import argparse
import html
import json
import os
import re
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SLOT = {"Sword": "mainhand", "Shield": "offhand", "Hat": "hat", "Armor": "armor", "Gloves": "gloves", "Boots": "boots"}
TIER = {"M": 0, "R": 1, "L": 2}
CLASSES = ("Paladin", "Rogue", "Mage")


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


def fields(body):
    body = re.sub(r"<GfxType>.*?</GfxType>", "", body, flags=re.S)
    return {k: html.unescape(v).strip() for k, v in re.findall(r"<(\w+)>([^<]*)</\1>", body)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", required=True)
    ap.add_argument("--game", required=True)
    a = ap.parse_args()

    gear, mystic = [], 0
    text = chunk(swz_chunks(a.login), "GearTypes")
    for m in re.finditer(r'<Gear GearName="([^"]*)" GearID="(\d+)" Type="([^"]*)">(.*?)</Gear>', text, re.S):
        gid, typ, d = int(m.group(2)), m.group(3), fields(m.group(4))
        cls, rarity = d.get("UsedBy", ""), d.get("Rarity", "")
        if gid == 0 or cls not in CLASSES or typ not in SLOT:
            continue
        if rarity == "Y":
            mystic += 1
            continue
        if rarity not in TIER:
            raise SystemExit("%s: unknown rarity %r" % (m.group(1), rarity))
        stat = d.get("StatRune", "")
        assert stat.startswith(cls), (m.group(1), stat)
        row = {"n": d.get("DisplayName", ""), "c": cls, "s": SLOT[typ], "id": gid, "t": TIER[rarity], "r": rarity,
               "f": stat[len(cls):], "p": [r for r in (d.get("ProcRune"), d.get("ProcRune2")) if r],
               "k": d.get("PowerRune", ""), "m": d.get("MagicRune", ""), "l": int(d.get("Level") or 0)}
        gear.append(row)

    cat_path = os.path.join(ROOT, "data/catalog.json")
    old = json.load(open(cat_path, encoding="utf-8"))
    out = {"version": old.get("version", 1), "gear": gear, "charms": old.get("charms", [])}
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    # Skill runes the names file doesn't know yet, from PowerModTypes "Rune<key>".
    names_path = os.path.join(ROOT, "data/names.json")
    names = json.load(open(names_path, encoding="utf-8"))
    mods = {}
    for m in re.finditer(r"<PowerModType>(.*?)</PowerModType>", chunk(swz_chunks(a.game), "PowerModTypes"), re.S):
        d = fields(m.group(1))
        if d.get("ModName"):
            mods[d["ModName"]] = d
    added = []
    for key in sorted({g["k"] for g in gear if g.get("k")}):
        if key in names["skillRunes"]:
            continue
        mod = mods.get("Rune" + key)
        if not mod:
            raise SystemExit("no PowerModType Rune%s for skill rune %s" % (key, key))
        base = key[len("Legendary"):] if key.startswith("Legendary") else key
        lines = [x.strip() for x in mod.get("Description", "").split("\n") if x.strip()]
        names["skillRunes"][key] = {"name": mod.get("DisplayName") or base, "desc": " · ".join(lines), "base": base}
        added.append(key)
    with open(names_path, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=1)

    missing_runes = sorted({r for g in gear for r in g["p"]} - set(names["runes"]))
    if missing_runes:
        raise SystemExit("runes without names in data/names.json: %s" % ", ".join(missing_runes))
    print("catalog: %d items (%d Mystic left out); names: %d skill runes added" % (len(gear), mystic, len(added)))


if __name__ == "__main__":
    main()
