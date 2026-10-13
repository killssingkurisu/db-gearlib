/**
 * The dropdown filters. Each is one <select>; an empty value means "any". All filters are and.
 *
 *   defs(data, picked)              the dropdowns, their options (with optgroups) and tests
 *   apply(items, defs, picked, q)   { results, counts } — counts[key][value] is how many items an
 *                                   option would show with the other filters as they are
 *   nameMatcher(q)                  the name search: every word typed must appear in the name, in
 *                                   any order, ignoring case, spaces and punctuation ("skull necro"
 *                                   finds Necromancer's Skull, "korgal" finds Kor'Gal's…); null when empty
 *
 * Works in the browser (window.GearFilters) and in Node (test/run.js).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GearFilters = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CLASSES = ['Paladin', 'Rogue', 'Mage'];
    const SLOTS = [['mainhand', 'Main hand'], ['offhand', 'Off hand'], ['hat', 'Hat'], ['armor', 'Armor'], ['gloves', 'Gloves'], ['boots', 'Boots']];
    const RARITIES = [['L', 'Legendary'], ['R', 'Rare'], ['M', 'Magic']];
    const FOCUSES = [['Attack', 'Attack'], ['Expertise', 'Expertise'], ['Armor', 'Defense'], ['Balanced', 'Balanced'], ['Spread', 'Spread']];

    function defs(data, picked) {
        const runes = data.runes || {};
        const opt = (v, label) => ({ v, label });
        const procs = Object.keys(runes).filter((k) => runes[k].kind === 'proc').map((k) => opt(k, runes[k].name));
        const stats = Object.keys(runes).filter((k) => runes[k].kind !== 'proc').map((k) => opt(k, runes[k].name));

        // Skill runes by the classes whose gear carries them.
        const skillCls = {};
        for (const row of data.gear) if (row[7]) (skillCls[row[7]] = skillCls[row[7]] || new Set()).add(row[1]);
        const skillName = (k) => (data.skillRunes && data.skillRunes[k] ? data.skillRunes[k].name : k);
        const skillGroups = [];
        for (const cls of CLASSES) {
            if (picked.class && picked.class !== cls) continue;
            const keys = Object.keys(skillCls).filter((k) => skillCls[k].size === 1 && skillCls[k].has(cls)).sort((a, b) => skillName(a).localeCompare(skillName(b)));
            if (keys.length) skillGroups.push({ label: cls, options: keys.map((k) => opt(k, skillName(k))) });
        }
        const shared = Object.keys(skillCls).filter((k) => skillCls[k].size > 1);
        skillGroups.push({ label: 'Every class', options: shared.map((k) => opt(k, skillName(k))).concat([opt('-', 'No skill rune')]) });

        // Magic bonuses: the exact combinations (two on Rare and Legendary, one on Magic), then "includes".
        const magicNames = data.magic || {};
        const magicKeys = Object.keys(magicNames);
        const parts = magicKeys.filter((k) => !k.includes('+'));
        const magicGroups = [
            { label: 'Two bonuses (Rare, Legendary)', options: magicKeys.filter((k) => k.includes('+')).map((k) => opt('=' + k, magicNames[k])) },
            { label: 'One bonus (Magic)', options: parts.map((k) => opt('=' + k, magicNames[k])) },
            { label: 'Includes', options: parts.map((k) => opt('+' + k, 'Any with ' + magicNames[k])) },
        ];

        // Where to get it: one optgroup per zone (in game order), then the items that are not dungeon drops.
        const dungeons = data.dungeons || {};
        const zones = [];
        for (const [level, d] of Object.entries(dungeons)) {
            let z = zones.find((g) => g.label === d.zone);
            if (!z) zones.push(z = { label: d.zone, options: [] });
            z.options.push(opt(level, d.name));
        }
        const specials = Array.from(new Set(data.gear.map((row) => (row[10] || []).find((s) => typeof s === 'string')).filter(Boolean)));
        if (specials.length) zones.push({ label: 'Not a dungeon drop', options: specials.sort().map((s) => opt('~' + s, s)) });

        return [
            { key: 'class', label: 'Class', any: 'Any class', options: CLASSES.map((c) => opt(c, c)), test: (it, v) => it.cls === v },
            { key: 'slot', label: 'Gear type', any: 'Any gear type', options: SLOTS.map(([v, l]) => opt(v, l)), test: (it, v) => it.slot === v },
            { key: 'rarity', label: 'Rarity', any: 'Any rarity', options: RARITIES.map(([v, l]) => opt(v, l)), test: (it, v) => it.rarity === v },
            { key: 'focus', label: 'Stat focus', any: 'Any focus', options: FOCUSES.map(([v, l]) => opt(v, l)), test: (it, v) => it.focus === v },
            {
                key: 'rune', label: 'Rune', any: 'Any rune',
                groups: [{ label: 'On critical hit (weapons)', options: procs }, { label: 'Stat', options: stats }],
                test: (it, v) => it.runes.includes(v),
            },
            { key: 'skill', label: 'Skill rune', any: 'Any skill rune', groups: skillGroups, test: (it, v) => (v === '-' ? !it.skill : it.skill === v) },
            {
                // "=Speed+GoldDrop" is that exact pair; "+GoldDrop" is any item with Gold Find in it.
                key: 'magic', label: 'Magic', any: 'Any magic', groups: magicGroups,
                test: (it, v) => (v[0] === '=' ? it.magic === v.slice(1) : it.magicParts.includes(v.slice(1))),
            },
            {
                key: 'where', label: 'Obtained in', any: 'Anywhere', groups: zones,
                test: (it, v) => (v[0] === '~' ? it.special === v.slice(1) : it.sources.some((s) => s.dungeon === v)),
            },
        ];
    }

    function optionsOf(def) {
        return def.groups ? def.groups.reduce((a, g) => a.concat(g.options), []) : def.options;
    }

    const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    function nameMatcher(q) {
        const parts = words(q).split(' ').filter(Boolean);
        if (!parts.length) return null;
        return (it) => {
            if (!it._words) { it._words = words(it.name); it._compact = it._words.replace(/ /g, ''); }
            return parts.every((p) => it._words.includes(p) || it._compact.includes(p)); // "korgal" finds Kor'Gal's
        };
    }

    function apply(allItems, list, picked, q) {
        const match = nameMatcher(q);
        const items = match ? allItems.filter(match) : allItems;
        const active = list.map((d) => (picked[d.key] ? d : null));
        const counts = {};
        for (const d of list) counts[d.key] = {};
        const results = [];
        for (const it of items) {
            let fails = 0;
            let failed = -1;
            for (let j = 0; j < list.length; j++) {
                if (active[j] && !active[j].test(it, picked[list[j].key])) { fails++; failed = j; if (fails > 1) break; }
            }
            if (fails > 1) continue;
            if (!fails) results.push(it);
            for (let j = 0; j < list.length; j++) {
                if (fails && j !== failed) continue;
                const d = list[j];
                const c = counts[d.key];
                c[''] = (c[''] || 0) + 1;
                for (const o of optionsOf(d)) if (d.test(it, o.v)) c[o.v] = (c[o.v] || 0) + 1;
            }
        }
        return { results, counts };
    }

    return { defs, apply, optionsOf, nameMatcher };
});
