#!/usr/bin/env node
'use strict';
// node test/run.js — checks the scan matching and the dropdown filters against the real data.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../app/model.js');
const F = require('../app/filters.js');

const root = path.join(__dirname, '..');
function loadWindowScript(file, name) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const window = {};
    new Function('window', src)(window);
    return window[name];
}
const data = loadWindowScript('app/data/gear-data.js', 'DBB_GEAR');
const seed = loadWindowScript('app/data/seed-scans.js', 'DBB_SEED_SCANS');
const { items, characters } = M.buildItems(data, seed);

let passed = 0;
function check(name, fn) {
    try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; }
}
const run = (picked, q) => F.apply(items, F.defs(data, picked), picked, q);

check('catalog size', () => assert.strictEqual(items.length, 3546));
check('every scanned item matched', () => characters.forEach((c) => assert.deepStrictEqual(c.unmatched, [], c.name)));
check('three characters', () => assert.deepStrictEqual(characters.map((c) => c.cls).sort(), ['Mage', 'Paladin', 'Rogue']));
check('scanned stats win', () => {
    const it = items.find((i) => i.name === 'Hulking Menace' && i.rarity === 'L');
    assert.deepStrictEqual(it.stats, { attack: 526, expertise: 452, defense: 0 });
    assert.strictEqual(it.statSource, 'scan');
});
check('no filters shows everything', () => assert.strictEqual(run({}).results.length, 3546));
check('class and slot', () => {
    const r = run({ class: 'Rogue', slot: 'mainhand' }).results;
    assert.ok(r.length > 0 && r.every((i) => i.cls === 'Rogue' && i.slot === 'mainhand'));
});
check('rune matches either rune', () => {
    const r = run({ rune: 'ProcMassiveTime' }).results;
    assert.ok(r.some((i) => i.runes[0] === 'ProcMassiveTime') && r.some((i) => i.runes[1] === 'ProcMassiveTime'));
    assert.ok(r.every((i) => i.runes.includes('ProcMassiveTime')));
    assert.ok(!r.some((i) => i.runes.includes('ProcMassive') && !i.runes.includes('ProcMassiveTime')));
});
check('focus', () => assert.ok(run({ focus: 'Armor' }).results.every((i) => i.focus === 'Armor')));
check('every Legendary has stats from the scans', () => assert.ok(items.filter((i) => i.rarity === 'L').every((i) => i.stats)));
check('no owner filter', () => assert.ok(!F.defs(data, {}).some((d) => d.key === 'owner')));
check('no skill rune', () => assert.ok(run({ skill: '-' }).results.every((i) => !i.skill)));
check('skill runes follow the class', () => {
    const defs = F.defs(data, { class: 'Mage' });
    const opts = F.optionsOf(defs.find((d) => d.key === 'skill')).map((o) => o.v);
    assert.ok(opts.includes('Meteor') && !opts.includes('SeekingBlades'));
});
check('counts match results', () => {
    const picked = { class: 'Paladin', rarity: 'L' };
    const { results, counts } = run(picked);
    assert.strictEqual(counts.slot[''], results.length);
    assert.strictEqual(counts.slot.offhand, run(Object.assign({ slot: 'offhand' }, picked)).results.length);
    assert.strictEqual(counts.class.Rogue, run({ class: 'Rogue', rarity: 'L' }).results.length);
});
// Drop sources: the same cases as the server's gear_drop_source_regression.ts.
const srcOf = (cls, id) => items.find((i) => i.cls === cls && i.id === id).sources.map((x) => x.dungeon + ':' + x.kind);
check('realm gear drops only in its dungeon', () => {
    assert.deepStrictEqual(srcOf('Mage', 522), ['BT_Mission1:realm']);   // Bandit Camp, not BT_Mission4
    assert.deepStrictEqual(srcOf('Mage', 512), ['BT_Mission4:realm']);   // Dereliction of Duty
    assert.deepStrictEqual(srcOf('Mage', 426), ['CH_Mission6:realm']);   // Mausoleum of the Wise
    assert.deepStrictEqual(srcOf('Mage', 1048), ['JC_Mission11:realm']); // not Hiding Out, not JC_Mission2
    assert.deepStrictEqual(srcOf('Mage', 1140), ['JC_Mini1:realm']);     // The West Wing only
    assert.deepStrictEqual(srcOf('Mage', 1047), ['JC_Mission5:realm']);  // Fable of the Lost Temple
});
check('boss gear drops from its boss in its dungeon', () => {
    assert.deepStrictEqual(srcOf('Mage', 515), ['BT_Mission1:boss']);
    assert.deepStrictEqual(srcOf('Mage', 422), ['CH_Mission6:boss']);
    assert.deepStrictEqual(srcOf('Mage', 525), ['SwampRoadConnectionMission:boss']);
});
check('every item has a source', () => assert.ok(items.every((i) => i.sources.length || i.special)));
check('obtained-in dropdown', () => {
    const r = run({ where: 'BT_Mission1' }).results;
    assert.ok(r.length > 0 && r.every((i) => i.sources.some((x) => x.dungeon === 'BT_Mission1')));
    assert.strictEqual(run({ where: '~Treasure Trove (lockbox)' }).results.length, 18 * 3);
    assert.strictEqual(run({ where: '~Halloween event' }).results.length, 3 * 3);
});
check('name search: any order, any case, punctuation ignored', () => {
    const r = run({}, 'skull NECRO').results;
    assert.deepStrictEqual(Array.from(new Set(r.map((i) => i.name))), ["Necromancer's Skull"]);
    const korgal = run({}, "kor'gal").results.length;
    assert.ok(korgal > 0 && run({}, 'korgal').results.length === korgal && run({}, 'KOR GAL').results.length === korgal);
    assert.strictEqual(run({}, '   ').results.length, 3546);
});
check('name search combines with dropdowns and drives counts', () => {
    const { results, counts } = run({ class: 'Mage' }, 'staff');
    assert.ok(results.length > 0 && results.every((i) => i.cls === 'Mage' && /staff/i.test(i.name)));
    assert.strictEqual(counts.class.Rogue, run({ class: 'Rogue' }, 'staff').results.length);
});
check('magic: exact pair or any that includes a bonus', () => {
    const pair = run({ magic: '=Speed+GoldDrop' }).results;
    assert.strictEqual(pair.length, 182 * 2);
    assert.ok(pair.every((i) => i.magic === 'Speed+GoldDrop'));
    const gold = run({ magic: '+GoldDrop' }).results;
    assert.strictEqual(gold.length, 283 + 2 * (205 + 204 + 182)); // Gold Find alone, and with each other bonus
    assert.strictEqual(run({ magic: '=GoldDrop' }).results.length, 283);
    const { counts } = run({ rarity: 'M' });
    assert.strictEqual(counts.magic['=ItemDrop+GoldDrop'] || 0, 0); // Magic items carry one bonus
});
check('parseScan rejects meter exports', () => assert.throws(() => M.parseScan({ format: 'dbb-dps' }), /DPS meter/));

/* ---------- Mounts ---------- */

const mounts = loadWindowScript('app/data/mount-data.js', 'DBB_MOUNTS').mounts;
const mount = (key) => mounts.find((m) => m.key === key);
// Width and height of a WebP file (VP8X, VP8 or VP8L).
function webpSize(file) {
    const b = fs.readFileSync(file);
    assert.strictEqual(b.toString('ascii', 0, 4) + b.toString('ascii', 8, 12), 'RIFFWEBP', file + ' is not a WebP');
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
}
check('108 mounts, ids 1 to 108, one each', () => {
    assert.strictEqual(mounts.length, 108);
    assert.deepStrictEqual(mounts.map((m) => m.id), Array.from({ length: 108 }, (_v, i) => i + 1));
    assert.strictEqual(new Set(mounts.map((m) => m.key)).size, 108);
});
check('mount names are the live game\'s, one per mount', () => {
    assert.strictEqual(new Set(mounts.map((m) => m.name)).size, 108);
    assert.deepStrictEqual(mounts.filter((m) => m.name === 'Ancient Crypt Walker').map((m) => m.key), ['MountInfernal']);
    assert.strictEqual(mount('MountDrake3').name, 'Flarecrest Fangrasaur');
    assert.strictEqual(mount('MountInfernal2').name, 'Lastlight Walker');
    assert.strictEqual(mount('MountWolfBear2').name, 'Nighthowl Wolfbear');
    assert.strictEqual(mount('MountDraftHorse').name, 'Buckskin Horse');
    assert.strictEqual(mount('MountLockbox01L02').name, 'Hatebreed Charger');
});
check('mount rigs, rarities and levels', () => {
    assert.strictEqual(mounts.filter((m) => m.rig === 'Horse').length, 63);
    assert.strictEqual(mounts.filter((m) => m.rig === 'Dire').length, 45);
    assert.deepStrictEqual(mounts.filter((m) => m.rarity === 'L').map((m) => m.key), ['MountLockbox01L01', 'MountLockbox01L02']);
    assert.ok(mounts.every((m) => m.level === 20 || m.level === 40));
});
check('every mount has both pictures at their frame size', () => {
    for (const m of mounts) {
        assert.deepStrictEqual(webpSize(path.join(root, 'mounts/thumb', m.key + '.webp')), [192, 128], m.key);
        assert.deepStrictEqual(webpSize(path.join(root, 'mounts/large', m.key + '.webp')), [480, 320], m.key);
    }
    assert.strictEqual(fs.readdirSync(path.join(root, 'mounts/thumb')).length, 108);
    assert.strictEqual(fs.readdirSync(path.join(root, 'mounts/large')).length, 108);
});
check('both pages carry the Gears | Mounts top bar', () => {
    for (const [file, on] of [['index.html', 'Gears'], ['mounts.html', 'Mounts']]) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(/<a class="tab[^"]*" href="\.\/"[^>]*>Gears<\/a>/.test(html) && /<a class="tab[^"]*" href="mounts\.html"[^>]*>Mounts<\/a>/.test(html), file);
        assert.ok(new RegExp('<a class="tab on"[^>]*aria-current="page">' + on + '</a>').test(html), file + ' marks ' + on);
    }
});

console.log(passed + ' checks passed' + (process.exitCode ? ', some failed' : ''));
