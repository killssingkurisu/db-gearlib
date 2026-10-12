#!/usr/bin/env python3
"""Build data/drops.json: where each gear item is obtained, dungeon by dungeon.

Follows the Dungeon Blitz R server's own drop rules (src/server/core/GameData.ts, getGearIdForEntity):
  - gear drops only from dungeon monsters;
  - a boss drops the gear in gear_data.json boss_drops[boss] whose GearTypes BossName is that boss,
    and only in the dungeon DungeonBlitz.swf's boss table (var_22) gives for it;
  - lieutenants and mini-bosses drop the gear in realm_drops[realm] whose GearTypes Realm is that
    realm, only in the dungeons the SWF's realm table (var_32) gives for realm + gear level, else in
    dungeons whose base level equals the gear level;
  - Hard versions of a dungeon drop the same gear. Normal mode gives Magic and Rare, Hard adds
    Legendary (RewardHandler's tier weights).

Inputs, from a checkout of dungeon-blitz-r (pass its root as --repo):
  src/client/content/localhost/p/cbp/Login.swz       GearTypes (Realm, BossName, Level), EntTypes
  src/client/content/localhost/p/cbq/Game.en.swz     LevelTypes (English dungeon names), LockboxTypes
  src/client/content/localhost/p/cbp/DungeonBlitz.swf  the drop-location tables
  src/server/data/gear_data.json, src/server/data/level_config.json
  src/server/scripts/swfPatchUtils.ts                 the server's SWF reader (run with npx tsx)

Run: python3 tools/extract_drops.py --repo ../dungeon-blitz-r
"""
import argparse
import collections
import json
import os
import re
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


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
            return ET.fromstring(c.encode("utf-8"))
    raise SystemExit("no <%s> in archive" % root_tag)


def text(el, tag):
    t = el.find(tag)
    return (t.text or "").strip() if t is not None and t.text else ""


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").strip().lower())


def strip_hard(s):
    return re.sub(r"Hard$", "", (s or "").strip(), flags=re.I)


def dungeon_key(level):
    return norm(re.sub(r"^a_Level_", "", strip_hard(level), flags=re.I))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", required=True, help="root of a dungeon-blitz-r checkout")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "drops.json"))
    a = ap.parse_args()
    p = lambda *parts: os.path.join(a.repo, *parts)
    content = p("src", "client", "content", "localhost", "p")

    # Levels in level_config order, with the zone named by the "-----ZONE-----" separators.
    levels, order, zone = {}, [], ""
    for name, spec in json.load(open(p("src", "server", "data", "level_config.json"))).items():
        if name.startswith("--"):
            zone = name.strip("- ").title().replace("Wolfs End", "Wolf's End")
            continue
        parts = spec.split(" ")
        if len(parts) < 4:
            continue
        levels[name] = {"swf": parts[0], "base": int(parts[2]), "dungeon": parts[3].lower() == "true",
                        "hard": len(parts) > 4 and parts[4] == "Hard", "zone": zone}
        order.append(name)
    key_to_level = {}
    for name, lv in levels.items():
        if lv["hard"]:
            continue
        for alias in (name, lv["swf"].split("/")[-1]):
            key_to_level.setdefault(dungeon_key(alias), name)

    game = swz_chunks(os.path.join(content, "cbq", "Game.en.swz"))
    english = {lt.get("LevelName"): text(lt, "DisplayName") for lt in chunk(game, "LevelTypes") if text(lt, "DisplayName")}
    lockbox = {lb.get("LockboxName"): text(lb, "DisplayName") for lb in chunk(game, "LockboxTypes")}

    login = swz_chunks(os.path.join(content, "cbp", "Login.swz"))
    ent_names = {}
    for e in chunk(login, "EntTypes"):
        name = e.get("EntName") or ""
        if name and text(e, "DisplayName"):
            ent_names[norm(strip_hard(name))] = text(e, "DisplayName")

    # SWF drop-location tables, read with the server's own SWF reader.
    with tempfile.TemporaryDirectory() as tmp:
        locs_path = os.path.join(tmp, "locs.json")
        subprocess.run(["npx", "--yes", "tsx@4.19.2", os.path.join(HERE, "swf-drop-locations.ts"),
                        p("src", "server", "scripts", "swfPatchUtils.ts"),
                        os.path.join(content, "cbp", "DungeonBlitz.swf"), locs_path], check=True)
        locs = json.load(open(locs_path))
    boss_loc, realm_loc = {}, collections.defaultdict(set)
    for e in locs:
        if e["map"] == "var_22":
            boss_loc[norm(strip_hard(e["key"]))] = dungeon_key(e["level"])
        else:
            realm_loc[norm(e["key"])].add(dungeon_key(e["level"]))

    gd = json.load(open(p("src", "server", "data", "gear_data.json")))
    boss_lists = {norm(strip_hard(k)): set(v) for k, v in gd["boss_drops"].items()}
    realm_lists = {norm(k): set(v) for k, v in gd["realm_drops"].items()}

    rules, special = collections.defaultdict(set), {}
    for g in chunk(login, "GearTypes"):
        gid = int(g.get("GearID") or 0)
        if gid <= 0:
            continue
        realm, boss, lvl = text(g, "Realm"), strip_hard(text(g, "BossName")), int(text(g, "Level") or 0)
        if (realm or boss) and lvl > 0:
            rules[gid].add((realm, boss, lvl))
        gname = g.get("GearName") or ""
        m = re.match(r"Unique\w+?(Lockbox\d+)Gear", gname)
        if m:
            special[gid] = lockbox.get(m.group(1), m.group(1)) + " (lockbox)"
        elif gname.startswith("SpecialHalloween"):
            special[gid] = "Halloween event"
        elif gname.startswith("Special"):
            special[gid] = "Special reward"

    dungeons, items = {}, {}
    for gid in sorted(rules):
        found = []
        for realm, boss, lvl in sorted(rules[gid]):
            if boss:
                if gid in boss_lists.get(norm(boss), ()) and norm(boss) in boss_loc:
                    found.append((boss_loc[norm(boss)], "boss", ent_names.get(norm(boss), boss)))
                continue
            if gid not in realm_lists.get(norm(realm), ()):
                continue
            keys = realm_loc.get(norm(realm + str(lvl))) or {
                dungeon_key(n) for n, lv in levels.items() if lv["dungeon"] and not lv["hard"] and lv["base"] == lvl}
            for k in sorted(keys):
                found.append((k, "realm", realm))
        out = []
        for k, kind, who in found:
            level = key_to_level.get(k)
            if not level:
                raise SystemExit("gear %d: dungeon %s is not in level_config.json" % (gid, k))
            dungeons[level] = {"name": english.get(level, level), "zone": levels[level]["zone"], "order": order.index(level)}
            out.append({"dungeon": level, "kind": kind, "by": who})
        if out:
            items[str(gid)] = out
    for gid, label in special.items():
        if str(gid) not in items:
            items[str(gid)] = [{"special": label}]

    result = {
        "source": "dungeon-blitz-r server drop rules (GameData.getGearIdForEntity) with the client's drop-location tables",
        "dungeons": dict(sorted(dungeons.items(), key=lambda kv: kv[1]["order"])),
        "gear": items,
    }
    for d in result["dungeons"].values():
        del d["order"]
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    print("wrote %s: %d gear ids, %d dungeons, %d special" % (a.out, len(items), len(dungeons), sum(1 for v in items.values() if "special" in v[0])))


if __name__ == "__main__":
    main()
