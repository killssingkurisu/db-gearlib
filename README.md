# DB Gear Library

Every gear item in Dungeon Blitz (3,546 of them: 394 per class and rarity), what your scanned characters own, and filters that combine with and, or and not. Dressed like the DB DPS Launcher's Damage Meter.

Live page (once GitHub Pages is on): https://killssingkurisu.github.io/db-gearlib/

## Using it

- **Search box.** Words match item names and rune names. Fields narrow it down:
  `rune:hemorrhage (slot:main or slot:off) -class:mage`
  - `field:value`, with a comma for any-of: `slot:hat,boots`
  - a space or `and` between terms means both; `or` / `|` means either; `-`, `!` or `not` leaves out; parentheses group (and binds tighter than or)
  - numbers compare or take a range: `atk>=800`, `level:10..20`, `total>1000`
  - fields: `name class slot rarity focus rune skill magic owner is level id atk exp def total copies runecount`
  - `is:owned`, `is:missing`, `is:equipped`, `is:dupe`, `skill:none`
  - the line under the box shows how the search reads, with the grouping spelled out
- **Chips.** One click includes a value, a second click leaves it out, a third clears it. Chips in a group are or; groups are and with each other and with the search. Runes and Magic have an Any / All switch. The number on a chip is how many items it would match with everything else as it is.
- **Scans.** The three bundled scans (MaxMage, MaxRogue, Search Your Gear For) are on by default. Import more with *Import scans* or drop `DB inventory … .json` files on the page; an imported scan replaces the one of the same character. Imports stay in this browser. Turn any scan off with its dot.
- **Table.** One line per item, a column per field (Name, Class, Slot, Rarity, Focus, Lv, Atk, Exp, Def, Total, Rune 1, Rune 2, Skill rune, Magic, Owned by, ID). Click a header to sort by it, again to reverse; stat columns start highest first and unknown stats always sort last. The name column stays put when the table scrolls sideways. Click a name for gear ID, rune and skill rune text, and who owns how many.
- **CSV.** *Copy CSV* copies every matching row (not only the ones shown) with the same columns, ready to paste into a spreadsheet. *Download CSV* saves the same as a file; it shows only when the page is opened on its own, since framed previews can't save files.

## Stats

The game's stat tables don't match what the rebuilt game shows (see the scanner notes), so stats come only from scans: an item's own scanned stats, else the stats scanned on another item of the same class, slot, focus and rarity. Items nobody has scanned anything like show a dash. Today that means every Legendary has stats and Magic and Rare items don't, until someone scans some.

## Files

| Path | What |
|---|---|
| `index.html`, `app/gearlib.css`, `app/gearlib.js` | the page |
| `app/query.js` | the search language: `parse`, `compile`, `describe` (also runs in Node) |
| `app/model.js` | builds the item rows from the gear list and the scans; checks imported files |
| `app/data/gear-data.js` | generated: every item plus rune, skill rune and magic names |
| `app/data/seed-scans.js` | generated: the bundled scans, trimmed |
| `data/catalog.json` | the item list from DB Inventory Scanner (read from the game's Login.swz) |
| `data/names.json` | rune, skill rune and magic names from the DPS Calculator's game data |
| `data/scans/` | the bundled `dbb-inventory` scans |
| `app/fonts/` | Averia Serif Libre (SIL Open Font License), as in the launcher |

## Building and checking

```
node tools/build-data.js     # after changing data/: regenerates app/data
node test/run.js             # search language and scan matching against the real data
node tools/build-single.js   # optional: dist/gear-library.html, one self-contained file
```

No dependencies. The Actions workflow checks that `app/data` is up to date, runs the tests and publishes the repository root to GitHub Pages (Settings → Pages → Source: GitHub Actions).
