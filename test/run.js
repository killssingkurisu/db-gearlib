#!/usr/bin/env node
'use strict';
// node test/run.js — checks the search language and the scan matching against the real data.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Q = require('../app/query.js');
const M = require('../app/model.js');

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
const run = (text) => {
    const p = Q.parse(text);
    if (p.error) throw new Error(text + ': ' + p.error);
    const f = Q.compile(p.ast);
    return items.filter(f);
};

check('catalog size', () => assert.strictEqual(items.length, 3546));
check('every scanned item matched', () => characters.forEach((c) => assert.deepStrictEqual(c.unmatched, [], c.name)));
check('three characters', () => assert.deepStrictEqual(characters.map((c) => c.cls).sort(), ['Mage', 'Paladin', 'Rogue']));
check('owned legendaries', () => assert.strictEqual(run('is:owned').length, 394 * 3));
check('no magic or rare owned', () => assert.strictEqual(run('is:owned rarity:magic,rare').length, 0));
check('equipped count', () => assert.strictEqual(run('is:equipped').length, 18));
check('scanned stats win', () => {
    const it = items.find((i) => i.name === 'Hulking Menace' && i.rarity === 'L');
    assert.deepStrictEqual(it.stats, { attack: 526, expertise: 452, defense: 0 });
    assert.strictEqual(it.statSource, 'scan');
});
check('implicit and', () => assert.ok(run('slot:hat rune:hemorrhage').length === 0)); // hats carry stat runes only
check('or with parentheses', () => {
    const a = run('class:rogue (slot:hat or slot:boots) rarity:L');
    assert.ok(a.length > 0 && a.every((i) => i.cls === 'Rogue' && (i.slot === 'hat' || i.slot === 'boots') && i.rarity === 'L'));
});
check('comma is any-of', () => assert.strictEqual(run('slot:hat,boots').length, run('slot:hat or slot:boots').length));
check('not and minus agree', () => assert.strictEqual(run('not class:mage').length, run('-class:mage').length));
check('rune by name or key', () => assert.strictEqual(run('rune:"heavy blow"').length, run('rune:ProcMassive').length));
check('rune and rune', () => {
    const a = run('rune:hemorrhage rune:"heavy blow"');
    assert.ok(a.length > 0 && a.every((i) => i.runes.includes('ProcMassive') && i.runes.includes('ProcMassiveTime')));
});
check('numbers', () => assert.ok(run('atk>=900').every((i) => i.stats.attack >= 900)));
check('range', () => assert.ok(run('level:10..20').every((i) => i.level >= 10 && i.level <= 20)));
check('magic part', () => assert.ok(run('magic:gold').every((i) => i.magicParts.includes('GoldDrop'))));
check('skill rune by name', () => assert.ok(run('skill:"charon\'s blades"').every((i) => i.skill === 'SeekingBlades')));
check('owner', () => assert.ok(run('owner:maxrogue').every((i) => i.cls === 'Rogue')));
check('bare word matches name', () => assert.ok(run('skull').some((i) => i.name === "Necromancer's Skull")));
check('errors are plain', () => {
    assert.ok(Q.parse('(slot:hat').error);
    assert.ok(Q.parse('slot:hat)').error);
    assert.ok(Q.parse('atk>=lots').error);
    assert.ok(Q.parse('or slot:hat').error);
    assert.strictEqual(Q.parse('').error, null);
});
check('describe', () => assert.strictEqual(Q.describe(Q.parse('a b|c').ast), 'a and b or c'));
check('parseScan rejects meter exports', () => assert.throws(() => M.parseScan({ format: 'dbb-dps' }), /DPS meter/));

console.log(passed + ' checks passed' + (process.exitCode ? ', some failed' : ''));
