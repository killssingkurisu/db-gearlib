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
const run = (picked) => F.apply(items, F.defs(data, picked), picked);

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
check('parseScan rejects meter exports', () => assert.throws(() => M.parseScan({ format: 'dbb-dps' }), /DPS meter/));

console.log(passed + ' checks passed' + (process.exitCode ? ', some failed' : ''));
