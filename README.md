# DB Gear Library

Every gear item in Dungeon Blitz (3,546 of them: 394 per class and rarity) in one CSV-style table, with a dropdown per filter. Dressed like the DB DPS Launcher's Damage Meter.

Live page: https://killssingkurisu.github.io/db-gearlib/

## Using it

- **Table.** One line per item, a column per field: Name, Class, Type, Rarity, Focus, Lv, Atk, Exp, Def, Total, Rune 1, Rune 2, Skill rune, Magic, ID. Click a header to sort by it, again to reverse; stat columns start highest first and unknown stats always sort last. Click a name for the rune, skill rune and magic text.
- **Filters.** Separate dropdowns: Class, Gear type, Rarity, Stat focus, Rune (either rune slot), Skill rune (only the picked class's). They all apply together. Each option shows how many items it would give with the other dropdowns as they are.
- **CSV.** *Copy CSV* copies every matching row (not only the ones shown) with the same columns, ready to paste into a spreadsheet. *Download CSV* saves the same as a file; it shows only when the page is opened on its own, since framed previews can't save files.

## Stats

The game's stat tables don't match what the rebuilt game shows (see the scanner notes), so stats come from the inventory scans in `data/scans/` (MaxMage, MaxRogue, Search Your Gear For): an item's own scanned stats, else the stats scanned on another item of the same class, slot, focus and rarity, since those share them. The scans are all Legendaries, so every Legendary has stats and Magic and Rare items show a dash. Adding a scan with Magic or Rare gear to `data/scans/` and running `node tools/build-data.js` fills those in.

## Files

| Path | What |
|---|---|
| `index.html`, `app/gearlib.css`, `app/gearlib.js` | the page |
| `app/filters.js` | the dropdowns and the option counts (also runs in Node) |
| `app/model.js` | builds the item rows from the gear list and takes stats from the scans |
| `app/data/gear-data.js` | generated: every item plus rune, skill rune and magic names |
| `app/data/seed-scans.js` | generated: the scans, trimmed |
| `data/catalog.json` | the item list from DB Inventory Scanner (read from the game's Login.swz) |
| `data/names.json` | rune, skill rune and magic names from the DPS Calculator's game data |
| `data/scans/` | the `dbb-inventory` scans the stats come from |
| `app/fonts/` | Averia Serif Libre (SIL Open Font License), as in the launcher |

## Building and checking

```
node tools/build-data.js     # after changing data/: regenerates app/data
node test/run.js             # scan matching and the dropdown filters against the real data
node tools/build-single.js   # optional: dist/gear-library.html, one self-contained file
```

No dependencies. The Actions workflow checks that `app/data` is up to date, runs the tests and publishes the repository root to GitHub Pages (Settings → Pages → Source: GitHub Actions).
