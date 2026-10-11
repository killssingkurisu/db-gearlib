/**
 * The search box's little language.
 *
 *   hemorrhage                     words match the item name (or any rune, skill rune or magic name)
 *   slot:hat                       field:value — the value is matched loosely (key or name, any case)
 *   slot:hat,boots                 a comma means "any of these"
 *   rune:"heavy blow"              quotes keep spaces together
 *   atk>=800  level<20  total>1000 numbers compare
 *   a and b   a b                  both (and is implied between terms)
 *   a or b    a | b                either
 *   not a     -a   !a              not
 *   ( ... )                        grouping
 *
 * parse(text) returns { ast, error }. compile(ast) returns a predicate over an item made by
 * the page (see itemFields below for what the fields read). Works in the browser
 * (window.GearQuery) and in Node (module.exports) so test/query.test.js can run it.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GearQuery = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SLOT_ALIASES = {
        mainhand: ['mainhand', 'main', 'mh', 'weapon', 'main hand'],
        offhand: ['offhand', 'off', 'oh', 'shield', 'off hand'],
        hat: ['hat', 'head', 'helm', 'helmet'],
        armor: ['armor', 'armour', 'chest', 'body'],
        gloves: ['gloves', 'hands', 'glove'],
        boots: ['boots', 'feet', 'boot'],
    };
    const RARITY_ALIASES = { M: ['m', 'magic'], R: ['r', 'rare'], L: ['l', 'legendary', 'leg'] };
    const FOCUS_ALIASES = {
        Attack: ['attack', 'atk'], Expertise: ['expertise', 'exp'], Armor: ['armor', 'defense', 'def'],
        Balanced: ['balanced', 'bal'], Spread: ['spread'],
    };
    const MAGIC_ALIASES = {
        Speed: ['speed', 'move', 'movement'], ItemDrop: ['item', 'gear', 'itemdrop', 'gearfind'],
        GoldDrop: ['gold', 'golddrop'], CraftDrop: ['craft', 'material', 'mat', 'craftdrop'],
    };

    /** Field names (and their aliases) to how they match. */
    const FIELDS = {
        name: 'name', n: 'name',
        class: 'class', c: 'class', cls: 'class',
        slot: 'slot', s: 'slot', type: 'slot',
        rarity: 'rarity', r: 'rarity', tier: 'rarity',
        focus: 'focus', f: 'focus',
        rune: 'rune', runes: 'rune', proc: 'rune',
        skill: 'skill', k: 'skill', skillrune: 'skill',
        magic: 'magic', m: 'magic',
        owner: 'owner', o: 'owner', char: 'owner', character: 'owner', on: 'owner',
        is: 'is', has: 'is',
        level: 'level', lvl: 'level', lv: 'level',
        id: 'id', gearid: 'id',
        attack: 'attack', atk: 'attack',
        expertise: 'expertise', exp: 'expertise',
        defense: 'defense', def: 'defense',
        total: 'total', stats: 'total',
        copies: 'copies', count: 'copies',
        runecount: 'runecount',
    };
    const NUMERIC = new Set(['level', 'id', 'attack', 'expertise', 'defense', 'total', 'copies', 'runecount']);

    /* ---------- tokens ---------- */

    function tokenize(text) {
        const out = [];
        let i = 0;
        const n = text.length;
        while (i < n) {
            const ch = text[i];
            if (/\s/.test(ch)) { i++; continue; }
            if (ch === '(' || ch === ')') { out.push({ t: ch, at: i }); i++; continue; }
            if (ch === '|') { out.push({ t: 'or', at: i }); i++; if (text[i] === '|') i++; continue; }
            if (ch === '&') { out.push({ t: 'and', at: i }); i++; if (text[i] === '&') i++; continue; }
            if ((ch === '-' || ch === '!') && i + 1 < n && !/[\s)]/.test(text[i + 1])) {
                out.push({ t: 'not', at: i }); i++; continue;
            }
            // A term: [field op] value, where value may be quoted.
            const start = i;
            let field = null;
            let op = null;
            const m = /^([A-Za-z]+)\s*(>=|<=|!=|:|=|>|<)/.exec(text.slice(i));
            if (m && FIELDS[m[1].toLowerCase()] !== undefined) {
                field = FIELDS[m[1].toLowerCase()];
                op = m[2];
                i += m[0].length;
                while (i < n && text[i] === ' ') i++;
            }
            let value = '';
            let quoted = false;
            if (text[i] === '"' || text[i] === "'") {
                const q = text[i];
                const end = text.indexOf(q, i + 1);
                if (end < 0) throw new QueryError('A quote is not closed.', i);
                value = text.slice(i + 1, end);
                quoted = true;
                i = end + 1;
            } else {
                const vs = i;
                while (i < n && !/[\s()|&]/.test(text[i])) {
                    if ((text[i] === '"' || text[i] === "'") && i > vs) {
                        const q = text[i];
                        const end = text.indexOf(q, i + 1);
                        if (end < 0) throw new QueryError('A quote is not closed.', i);
                        i = end + 1;
                    } else i++;
                }
                value = text.slice(vs, i).replace(/["']/g, '');
            }
            if (field && value === '') throw new QueryError('"' + text.slice(start, i).trim() + '" needs a value.', start);
            if (!field && !quoted) {
                const low = value.toLowerCase();
                if (low === 'and' || low === 'or' || low === 'not') { out.push({ t: low, at: start }); continue; }
            }
            out.push({ t: 'term', field: field || 'any', op: op || ':', value, at: start });
        }
        return out;
    }

    function QueryError(message, at) {
        this.message = message;
        this.at = at;
    }

    /* ---------- grammar ---------- */

    function parse(text) {
        const src = String(text || '').trim();
        if (!src) return { ast: null, error: null };
        try {
            const toks = tokenize(src);
            let p = 0;
            const peek = () => toks[p];
            const orExpr = () => {
                const parts = [andExpr()];
                while (peek() && peek().t === 'or') { p++; parts.push(andExpr()); }
                return parts.length === 1 ? parts[0] : { type: 'or', parts };
            };
            const andExpr = () => {
                const parts = [notExpr()];
                for (;;) {
                    const tk = peek();
                    if (!tk || tk.t === ')' || tk.t === 'or') break;
                    if (tk.t === 'and') { p++; }
                    parts.push(notExpr());
                }
                return parts.length === 1 ? parts[0] : { type: 'and', parts };
            };
            const notExpr = () => {
                const tk = peek();
                if (tk && tk.t === 'not') { p++; return { type: 'not', part: notExpr() }; }
                return atom();
            };
            const atom = () => {
                const tk = peek();
                if (!tk) throw new QueryError('The search ends too early.', src.length);
                if (tk.t === '(') {
                    p++;
                    const e = orExpr();
                    if (!peek() || peek().t !== ')') throw new QueryError('A "(" is not closed.', tk.at);
                    p++;
                    return e;
                }
                if (tk.t === 'term') { p++; return termNode(tk); }
                if (tk.t === ')') throw new QueryError('There is a ")" without a "(".', tk.at);
                throw new QueryError('"' + tk.t + '" needs something on both sides.', tk.at);
            };
            const ast = orExpr();
            if (p < toks.length) {
                const tk = toks[p];
                throw new QueryError(tk.t === ')' ? 'There is a ")" without a "(".' : 'Could not read the search after position ' + tk.at + '.', tk.at);
            }
            return { ast, error: null };
        } catch (e) {
            if (e instanceof QueryError) return { ast: null, error: e.message, at: e.at };
            throw e;
        }
    }

    function termNode(tk) {
        const field = tk.field;
        if (NUMERIC.has(field)) {
            if (tk.op === ':' || tk.op === '=') {
                const range = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/.exec(tk.value);
                if (range) return { type: 'range', field, lo: range[1] ? +range[1] : -Infinity, hi: range[2] ? +range[2] : Infinity };
            }
            const num = Number(tk.value);
            if (!isFinite(num)) throw new QueryError(field + ' takes a number, not "' + tk.value + '".', tk.at);
            return { type: 'num', field, op: tk.op === ':' ? '=' : tk.op, value: num };
        }
        if (tk.op !== ':' && tk.op !== '=' && tk.op !== '!=') {
            throw new QueryError(field + ' cannot be compared with ' + tk.op + '; use ' + field + ':value.', tk.at);
        }
        const values = tk.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (!values.length) throw new QueryError(field + ' needs a value.', tk.at);
        const node = { type: 'text', field, values, exact: tk.op === '=' };
        return tk.op === '!=' ? { type: 'not', part: Object.assign(node, { exact: true }) } : node;
    }

    /* ---------- matching ---------- */

    const lc = (s) => String(s || '').toLowerCase();
    const loose = (hay, v) => lc(hay).includes(v);

    function aliasMatch(table, key, v) {
        const list = table[key];
        if (!list) return lc(key) === v;
        return list.includes(v) || lc(key) === v;
    }

    function matchText(item, field, v, exact) {
        switch (field) {
            case 'any':
                return loose(item.name, v) || item.runeNames.some((r) => loose(r, v)) || item.runes.some((r) => lc(r) === v)
                    || loose(item.skillName, v) || lc(item.skill) === v;
            case 'name': return exact ? lc(item.name) === v : loose(item.name, v);
            case 'class': return exact ? lc(item.cls) === v : lc(item.cls).startsWith(v);
            case 'slot': return aliasMatch(SLOT_ALIASES, item.slot, v);
            case 'rarity': return aliasMatch(RARITY_ALIASES, item.rarity, v);
            case 'focus': return aliasMatch(FOCUS_ALIASES, item.focus, v) || (!exact && lc(item.focus).startsWith(v));
            case 'rune':
                // Keys match whole (ProcMassive is not ProcMassiveTime); names match loosely.
                return item.runes.some((r, i) => lc(r) === v || (exact ? lc(item.runeNames[i]) === v : loose(item.runeNames[i], v)));
            case 'skill':
                if (v === 'none') return !item.skill;
                return lc(item.skill) === v || (exact ? lc(item.skillName) === v : loose(item.skillName, v));
            case 'magic':
                if (v === 'none') return !item.magicParts.length;
                return item.magicParts.some((m) => aliasMatch(MAGIC_ALIASES, m, v)) || (!exact && loose(item.magicName, v));
            case 'owner':
                if (v === 'any' || v === 'anyone') return item.owners.length > 0;
                if (v === 'none' || v === 'nobody') return item.owners.length === 0;
                return item.owners.some((o) => (exact ? lc(o.name) === v : loose(o.name, v)));
            case 'is':
                if (v === 'owned' || v === 'have') return item.owners.length > 0;
                if (v === 'missing' || v === 'unowned' || v === 'notowned') return item.owners.length === 0;
                if (v === 'equipped' || v === 'worn') return item.owners.some((o) => o.equipped);
                if (v === 'dupe' || v === 'duplicate') return item.copies > 1;
                if (v === 'event' || v === 'set') return item.focus === 'Spread';
                if (v === 'stats' || v === 'known') return !!item.stats;
                if (SLOT_ALIASES[v]) return item.slot === v;
                if (Object.keys(RARITY_ALIASES).some((k) => RARITY_ALIASES[k].includes(v))) return aliasMatch(RARITY_ALIASES, item.rarity, v);
                return false;
            default: return false;
        }
    }

    function numberOf(item, field) {
        switch (field) {
            case 'level': return item.level;
            case 'id': return item.id;
            case 'copies': return item.copies;
            case 'runecount': return item.runes.length;
            case 'attack': return item.stats ? item.stats.attack : null;
            case 'expertise': return item.stats ? item.stats.expertise : null;
            case 'defense': return item.stats ? item.stats.defense : null;
            case 'total': return item.stats ? item.stats.attack + item.stats.expertise + item.stats.defense : null;
            default: return null;
        }
    }

    function compile(ast) {
        if (!ast) return () => true;
        switch (ast.type) {
            case 'and': { const fs = ast.parts.map(compile); return (it) => fs.every((f) => f(it)); }
            case 'or': { const fs = ast.parts.map(compile); return (it) => fs.some((f) => f(it)); }
            case 'not': { const f = compile(ast.part); return (it) => !f(it); }
            case 'text': {
                const vals = ast.values.map(lc);
                return (it) => vals.some((v) => matchText(it, ast.field, v, ast.exact));
            }
            case 'num': {
                const { field, op, value } = ast;
                return (it) => {
                    const x = numberOf(it, field);
                    if (x === null || x === undefined) return false;
                    switch (op) {
                        case '=': return x === value;
                        case '!=': return x !== value;
                        case '>': return x > value;
                        case '>=': return x >= value;
                        case '<': return x < value;
                        case '<=': return x <= value;
                        default: return false;
                    }
                };
            }
            case 'range': return (it) => { const x = numberOf(it, ast.field); return x !== null && x >= ast.lo && x <= ast.hi; };
            default: return () => true;
        }
    }

    /** Writes an AST back out as text (used by the tests and for the "reads as" line). */
    function describe(ast) {
        if (!ast) return '';
        switch (ast.type) {
            case 'and': return ast.parts.map((p) => (p.type === 'or' ? '(' + describe(p) + ')' : describe(p))).join(' and ');
            case 'or': return ast.parts.map(describe).join(' or ');
            case 'not': return 'not ' + (ast.part.type === 'and' || ast.part.type === 'or' ? '(' + describe(ast.part) + ')' : describe(ast.part));
            case 'text': return (ast.field === 'any' ? '' : ast.field + (ast.exact ? '=' : ':')) + ast.values.map((v) => (/\s/.test(v) ? '"' + v + '"' : v)).join(',');
            case 'num': return ast.field + (ast.op === '=' ? ':' : ast.op) + ast.value;
            case 'range': return ast.field + ':' + (isFinite(ast.lo) ? ast.lo : '') + '..' + (isFinite(ast.hi) ? ast.hi : '');
            default: return '';
        }
    }

    return { parse, compile, describe, FIELDS };
});
