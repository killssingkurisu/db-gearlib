/**
 * Turns the game's gear list and the scans into the rows the page shows.
 *
 * buildItems(gearData, scans) → { items, characters, statsNote }
 *   items       one per gear item in the game, with who owns it (from the scans) and its stats
 *   characters  one per scan: name, class, scannedAt, owned count, unmatched count
 *
 * Stats: the game's own tables don't match what the rebuilt game shows (see the scanner notes),
 * so stats come only from scans: the item's own scanned stats when someone owns it, else the
 * stats scanned on another item of the same class, slot, focus and rarity. Items with neither
 * have no stats (shown as a dash).
 *
 * parseScan(json) checks an imported file and returns the trimmed scan or throws with a reason.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GearModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const RARITY = ['M', 'R', 'L'];
    const RARITY_NAME = { M: 'Magic', R: 'Rare', L: 'Legendary' };
    const SLOTS = ['mainhand', 'offhand', 'hat', 'armor', 'gloves', 'boots'];
    const SLOT_NAME = { mainhand: 'Main hand', offhand: 'Off hand', hat: 'Hat', armor: 'Armor', gloves: 'Gloves', boots: 'Boots' };
    const FOCUS_NAME = { Attack: 'Attack', Expertise: 'Expertise', Armor: 'Defense', Balanced: 'Balanced', Spread: 'Spread' };
    const CLASSES = ['Paladin', 'Rogue', 'Mage'];
    const MAGIC_PART = { Speed: 'Move Speed', ItemDrop: 'Gear Find', GoldDrop: 'Gold Find', CraftDrop: 'Material Find' };

    function statsKey(s) {
        return s ? s.attack + '/' + s.expertise + '/' + s.defense : '';
    }

    function mode(list) {
        const counts = new Map();
        let best = null;
        let bestN = 0;
        for (const s of list) {
            const k = statsKey(s);
            const n = (counts.get(k) || 0) + 1;
            counts.set(k, n);
            if (n > bestN) { best = s; bestN = n; }
        }
        return best;
    }

    function cleanStats(s) {
        if (!s || typeof s !== 'object') return null;
        const a = Number(s.attack), e = Number(s.expertise), d = Number(s.defense);
        if (![a, e, d].every(isFinite)) return null;
        return { attack: a, expertise: e, defense: d };
    }

    function parseScan(json) {
        let s = json;
        if (typeof s === 'string') {
            try { s = JSON.parse(s); } catch (_e) { throw new Error('This file is not JSON.'); }
        }
        if (!s || typeof s !== 'object') throw new Error('This file is empty.');
        if (s.format === 'dbb-dps') throw new Error('This is a DPS meter export. The gear library reads inventory scans (dbb-inventory).');
        if (s.format !== 'dbb-inventory') throw new Error('This is not a DB Inventory Scanner file (format dbb-inventory).');
        const ch = s.character || {};
        if (!ch.name) throw new Error('The scan has no character name.');
        if (!CLASSES.includes(ch.class)) throw new Error('The scan\'s class "' + (ch.class || '') + '" is not Paladin, Rogue or Mage.');
        if (!Array.isArray(s.gear)) throw new Error('The scan has no gear list.');
        return {
            format: 'dbb-inventory',
            version: s.version || 1,
            scannedAt: s.scannedAt || null,
            character: { name: String(ch.name), class: ch.class },
            gear: s.gear.filter((g) => g && g.name).map((g) => ({
                name: String(g.name), gearId: Number(g.gearId) || 0, tier: Number(g.tier), slot: g.slot,
                equipped: !!g.equipped, stats: cleanStats(g.stats), charms: Array.isArray(g.charms) ? g.charms : [],
            })),
        };
    }

    function buildItems(data, scans) {
        const runeInfo = data.runes || {};
        const skillInfo = data.skillRunes || {};
        const magicInfo = data.magic || {};

        const dungeons = data.dungeons || {};
        const items = data.gear.map((row, index) => {
            const [name, cls, slot, id, tier, focus, runes, skill, magic, level, srcs] = row;
            // Where it comes from: dungeon drops ({ dungeon, name, zone, kind, by }) or one special source.
            const sources = (srcs || []).filter((s) => Array.isArray(s)).map(([dungeon, kind, by]) => ({
                dungeon, kind, by, name: dungeons[dungeon] ? dungeons[dungeon].name : dungeon, zone: dungeons[dungeon] ? dungeons[dungeon].zone : '',
            }));
            const special = (srcs || []).find((s) => typeof s === 'string') || '';
            const rarity = RARITY[tier] || 'M';
            const magicParts = magic ? magic.split('+') : [];
            return {
                index, name, cls, slot, id, tier, rarity, focus, level,
                runes: runes.slice(),
                runeNames: runes.map((r) => (runeInfo[r] ? runeInfo[r].name : r)),
                skill, skillName: skill ? (skillInfo[skill] ? skillInfo[skill].name : skill) : '',
                skillBase: skill ? (skillInfo[skill] && skillInfo[skill].base) || skill : '',
                magic, magicParts, magicName: magic ? (magicInfo[magic] || magicParts.map((m) => MAGIC_PART[m] || m).join(' + ')) : '',
                sources, special,
                owners: [], copies: 0, scanned: [], stats: null, statSource: null,
            };
        });

        const byClassIdTier = new Map();
        const byClassName = new Map();
        for (const it of items) {
            byClassIdTier.set(it.cls + '|' + it.id + '|' + it.tier, it);
            const k = it.cls + '|' + it.name.toLowerCase();
            if (!byClassName.has(k)) byClassName.set(k, []);
            byClassName.get(k).push(it);
        }

        const characters = [];
        for (const scan of scans) {
            const cls = scan.character.class;
            const who = scan.character.name;
            let matched = 0;
            const unmatched = [];
            const ownedHere = new Map();
            for (const g of scan.gear) {
                let it = byClassIdTier.get(cls + '|' + g.gearId + '|' + g.tier);
                if (!it || it.name.toLowerCase() !== g.name.toLowerCase()) {
                    const cands = byClassName.get(cls + '|' + g.name.toLowerCase()) || [];
                    it = cands.find((c) => c.tier === g.tier) || cands[0] || it || null;
                }
                if (!it) { unmatched.push(g.name); continue; }
                matched++;
                let o = ownedHere.get(it);
                if (!o) {
                    o = { name: who, cls, equipped: false, count: 0 };
                    ownedHere.set(it, o);
                    it.owners.push(o);
                }
                o.count++;
                if (g.equipped) o.equipped = true;
                it.copies++;
                if (g.stats) it.scanned.push(g.stats);
            }
            characters.push({ name: who, cls, scannedAt: scan.scannedAt, items: matched, distinct: ownedHere.size, unmatched });
        }

        // Stats: own scan first, then the same kind of item.
        const byKind = new Map();
        for (const it of items) {
            if (!it.scanned.length) continue;
            const k = it.cls + '|' + it.slot + '|' + it.focus + '|' + it.rarity;
            if (!byKind.has(k)) byKind.set(k, []);
            byKind.get(k).push(...it.scanned);
        }
        const kindStats = new Map();
        for (const [k, list] of byKind) kindStats.set(k, mode(list));
        for (const it of items) {
            if (it.scanned.length) {
                it.stats = mode(it.scanned);
                it.statSource = 'scan';
            } else {
                const s = kindStats.get(it.cls + '|' + it.slot + '|' + it.focus + '|' + it.rarity);
                if (s) { it.stats = s; it.statSource = 'kind'; }
            }
            it.total = it.stats ? it.stats.attack + it.stats.expertise + it.stats.defense : null;
        }

        return { items, characters };
    }

    /** "Bandit Camp", "Treasure Trove (lockbox)" or "" — for the table and the CSV. */
    function sourceText(it) {
        return it.sources.length ? it.sources.map((s) => s.name).join(' / ') : it.special;
    }
    function sourceZone(it) {
        return Array.from(new Set(it.sources.map((s) => s.zone))).join(' / ');
    }
    /** "Bandit Twin (boss)" or "Human lieutenants and mini-bosses". */
    function droppedBy(it) {
        return it.sources.map((s) => (s.kind === 'boss' ? s.by + ' (boss)' : s.by + ' lieutenants and mini-bosses')).join(' / ');
    }

    return {
        buildItems, parseScan, sourceText, sourceZone, droppedBy, RARITY, RARITY_NAME, SLOTS, SLOT_NAME, FOCUS_NAME, CLASSES, MAGIC_PART,
    };
});
