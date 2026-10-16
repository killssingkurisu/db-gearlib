# DB Gear Library

Every gear item in Dungeon Blitz (3,546 of them: 394 per class and rarity) in one CSV-style table, with a dropdown per filter, and every mount (108) with its picture. Dressed like the DB DPS Launcher's Damage Meter. A top bar switches between the two sections, **Gears** and **Mounts**.

Live pages: https://ksgger.github.io/db-gearlib/ (Gears) and https://ksgger.github.io/db-gearlib/mounts.html (Mounts)

## Using it

- **Table.** One line per item, a column per field: Name, Class, Type, Rarity, Focus, Lv, Atk, Exp, Def, Total, Rune 1, Rune 2, Skill rune, Magic, Obtained in, ID. Click a header to sort by it, again to reverse; stat columns start highest first and unknown stats always sort last. Click a name for where it drops (dungeon, zone, boss or monsters), and the rune, skill rune and magic text.
- **Search.** The box above the dropdowns matches item names: every word typed must appear, in any order, ignoring case, spaces and punctuation (`skull necro` finds Necromancer's Skull, `korgal` finds Kor'Gal's…). It combines with the dropdowns, and their counts follow it. Press `/` to jump to it, Esc to clear it.
- **Filters.** Separate dropdowns: Class, Gear type, Rarity, Stat focus, Rune (either rune slot), Skill rune (only the picked class's), Magic (an exact bonus pair like Gear Find + Material Find, a single bonus on Magic items, or "Any with Gold Find"), Obtained in (every dungeon, grouped by zone, plus the items that aren't dungeon drops). They all apply together. Each option shows how many items it would give with the other dropdowns as they are.
- **CSV.** *Copy CSV* copies every matching row (not only the ones shown) with the same columns, ready to paste into a spreadsheet. *Download CSV* saves the same as a file; it shows only when the page is opened on its own, since framed previews can't save files.

## Mounts

- **Table.** One compact line per mount: ID, picture, name (in its rarity's colour), code name, rig (Horse or Dire), rarity, level, idol cost (a dash when the game doesn't sell it for idols) and description. Click a name or a picture for a larger picture and the details. Headers sort; search, dropdowns (Rig, Rarity, Level, Idols) and *Copy CSV* / *Download CSV* work as on the gear page.
- **Names** come from MountTypes in the Game.swz the live game serves (`/p/cdr/Game.swz`, read from DB DPS Launcher's cache on 2026-10-15). The June dungeon-blitz-r copy still calls 88 of the mounts "Ancient Crypt Walker"; the live file names all 108.
- **Pictures** are drawn from the game's own mount art, the way the client draws a mount (SuperAnimData in DungeonBlitz.swf): the rig (`Animation_HorseMount.swf` or `Animation_DireMount.swf`, class `a__Animation`) at its idle pose (`Ready`, or the entity's `BaseAnim`, `AltReady` for 12 dire mounts); each part `X` replaced by `X_<set>` from the entity's CustomArt sets, the last set that has one winning; then the entity's ColorSwaps on every solid fill (named colours such as `HmCoatLt` from the client's table). The rig's fire socket marker is left out. Each picture is cropped to the mount and centred in a 3:2 frame: 192×128 for the table, 480×320 when a row is opened. Utilities.swf's `ImageMount…` symbols are empty, so the game has no ready-made pictures. The picture for each mount is drawn from the entity with the same name as the mount (`MountDrake3` draws `MountDrake3`), which is how the client finds it, so a name always sits next to its own picture.

To redraw them (needs Java and the JPEXS FFDec library, `ffdec_lib.jar` and its `lib/`):

```
python3 tools/mounts/mount_jobs.py --game Game.swz --login Login.swz --rigs <folder with the two rig SWFs> --jobs jobs.tsv
javac -cp "ffdec_lib.jar:lib/*" -d out tools/mounts/Mount.java
java -cp "out:ffdec_lib.jar:lib/*" Mount jobs.tsv render 2
python3 tools/mounts/frame_images.py render data/mounts.json mounts
node tools/build-data.js
```

## Stats

The game's stat tables don't match what the rebuilt game shows (see the scanner notes), so stats come from the inventory scans in `data/scans/` (MaxRogue, Maxpaladin and Search Your Gear For, rescanned on 2026-10-15 after stats changed in game): an item's own scanned stats, else the stats scanned on another item of the same class, slot, focus and rarity, since those share them. The scans are all Legendaries, so every Legendary has stats and Magic and Rare items show a dash. Only The Empress Staff (Mage) was missed by the scan, so it shows the stats of its kind. Adding a scan with Magic or Rare gear to `data/scans/` and running `node tools/build-data.js` fills those in.

## Item details

Names, focus, runes, skill rune, magic and level come from GearTypes in the Login.swz the live game serves (`tools/build_catalog.py`, last run 2026-10-15 with the files from DB DPS Launcher's cache). A scan's own focus, rune and skill rune fields come from the scanner's older copy of that list, so the page doesn't use them. Since June the live game changed the focus of 47 items (on all three rarities), runes on 41 Legendary, 19 Rare and 19 Magic items, magic on 10, and gave 1,164 Legendaries their own skill runes: the same skill rune plus a bonus to another skill (Cleave on a Legendary also adds 10% Holy Smash damage vs Staggered). The Skill rune dropdown files those under their skill, and an item's details show the full bonus. The live list also has Mystic versions of the 18 Treasure Trove items; they aren't in the table yet.

To refresh it from newer game files: `python3 tools/build_catalog.py --login Login.swz --game Game.swz`, then `node tools/build-data.js`.

## Where gear comes from

`data/drops.json` follows the Dungeon Blitz R server's own drop rules (`GameData.getGearIdForEntity`): gear drops only from dungeon monsters. A boss drops its own list, only in its dungeon. Lieutenants and mini-bosses drop their realm's list (Human, Mummy, Shade…), only in the dungeons the client's drop-location tables give for that realm and gear level. Hard versions of a dungeon drop the same gear; Normal gives Magic and Rare, Hard adds Legendary. Every item drops in exactly one dungeon, except 24 that aren't dungeon drops: the 18 Spread items from the Treasure Trove lockbox, the three Halloween Pumpkin Heads and three special-reward helmets.

To regenerate it from a checkout of dungeon-blitz-r (needs Node for `npx tsx`):

```
python3 tools/extract_drops.py --repo ../dungeon-blitz-r
node tools/build-data.js
```

It reads GearTypes and EntTypes from `Login.swz`, English dungeon names from `Game.en.swz`, the boss and realm drop-location tables from `DungeonBlitz.swf` (with the server's `swfPatchUtils.ts`), and `gear_data.json` and `level_config.json` from the server. `test/run.js` checks the result against the cases in the server's `gear_drop_source_regression.ts`.

## Files

| Path | What |
|---|---|
| `index.html`, `app/gearlib.css`, `app/gearlib.js` | the Gears page |
| `mounts.html`, `app/mounts.js` | the Mounts page (same stylesheet) |
| `app/data/mount-data.js` | generated: every mount, from `data/mounts.json` |
| `data/mounts.json` | generated by `tools/mounts/mount_jobs.py`: every mount's id, names, rarity, level, idol cost, description, rig |
| `data/mounts/named-colors.json` | the client's named colours for ColorSwaps (DungeonBlitz.swf) |
| `mounts/thumb/`, `mounts/large/` | the mount pictures, one WebP per mount, by code name |
| `tools/mounts/` | `mount_jobs.py` (reads the game data), `Mount.java` (draws the mounts with JPEXS), `frame_images.py` (crops and centres) |
| `app/filters.js` | the name search, the dropdowns and the option counts (also runs in Node) |
| `app/model.js` | builds the item rows from the gear list and takes stats from the scans |
| `app/data/gear-data.js` | generated: every item plus rune, skill rune and magic names |
| `app/data/seed-scans.js` | generated: the scans, trimmed |
| `gear.csv` | generated: every item with the table's columns (also at /gear.csv on the site) |
| `data/catalog.json` | the item list, in DB Inventory Scanner's layout, made by `tools/build_catalog.py` from the live game's Login.swz |
| `data/names.json` | rune, skill rune and magic names from the DPS Calculator's game data, plus the Legendaries' skill runes from the live game's PowerModTypes |
| `data/drops.json` | generated by `tools/extract_drops.py`: the dungeon (or special source) of every gear id |
| `data/scans/` | the `dbb-inventory` scans the stats come from |
| `app/fonts/` | Averia Serif Libre (SIL Open Font License), as in the launcher |

## Building and checking

```
node tools/build-data.js     # after changing data/: regenerates app/data
node test/run.js             # scan matching, the dropdown filters and the mounts against the real data
node tools/build-single.js   # optional: dist/gear-library.html and dist/mounts.html, one self-contained file each
```

No dependencies. The Actions workflow checks that `app/data` is up to date, runs the tests, builds one self-contained file per page (`tools/build-single.js`) and publishes them with `gear.csv` and the `mounts/` pictures to GitHub Pages (Settings → Pages → Source: GitHub Actions). One file per page means a browser can never mix a cached old script with a new page.
