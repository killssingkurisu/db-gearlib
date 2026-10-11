/* DB Gear Library: every gear item in the game, what the scanned characters own, and filters.
 *
 * Two ways to filter, combined with and:
 *   the search box   GearQuery's little language (and / or / not / parentheses / field:value)
 *   the chips        each group is or inside (or and, for runes and magic, when set to All),
 *                    groups are and with each other; a second click on a chip leaves it out.
 * Scans: the bundled ones (data/scans) plus any the viewer imports, kept in this browser.
 */
(function () {
    'use strict';

    const DATA = window.DBB_GEAR;
    const SEED = window.DBB_SEED_SCANS || [];
    const Q = window.GearQuery;
    const M = window.GearModel;
    const STORE_KEY = 'dbb-gearlib-v1';
    const PAGE = 120;
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => Number(n).toLocaleString('en-US');

    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /* ---------- saved state ---------- */

    function loadStore() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_e) { return {}; }
    }
    const saved = loadStore();
    const state = {
        imports: Array.isArray(saved.imports) ? saved.imports : [],
        off: new Set(Array.isArray(saved.off) ? saved.off : []),
        q: typeof saved.q === 'string' ? saved.q : '',
        picks: {},
        modes: Object.assign({ rune: 'any', magic: 'any' }, saved.modes || {}),
        nums: Object.assign({}, saved.nums || {}),
        sort: saved.sort || 'default',
        dir: saved.dir === -1 ? -1 : 1,
        shown: PAGE,
        open: new Set(),
    };
    if (saved.picks && typeof saved.picks === 'object') {
        for (const [k, list] of Object.entries(saved.picks)) {
            if (Array.isArray(list)) state.picks[k] = new Map(list.filter((p) => Array.isArray(p) && (p[1] === 'in' || p[1] === 'out')));
        }
    }
    try {
        const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
        if (h.startsWith('q=')) state.q = h.slice(2);
    } catch (_e) { /* keep the saved search */ }

    let saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const picks = {};
            for (const [k, m] of Object.entries(state.picks)) if (m.size) picks[k] = Array.from(m.entries());
            try {
                localStorage.setItem(STORE_KEY, JSON.stringify({
                    imports: state.imports, off: Array.from(state.off), q: state.q, picks, modes: state.modes,
                    nums: state.nums, sort: state.sort, dir: state.dir,
                }));
            } catch (_e) { /* storage full or blocked: the page still works */ }
            try {
                const url = location.pathname + location.search + (state.q ? '#q=' + encodeURIComponent(state.q) : '');
                history.replaceState(null, '', url);
            } catch (_e) { /* framed pages may refuse */ }
        }, 250);
    }

    /* ---------- scans and items ---------- */

    function allScans() {
        // An imported scan replaces a bundled one of the same character.
        const byName = new Map();
        for (const s of SEED) byName.set(s.character.name.toLowerCase(), { scan: s, seed: true });
        for (const s of state.imports) byName.set(s.character.name.toLowerCase(), { scan: s, seed: false });
        return Array.from(byName.values()).sort((a, b) => a.scan.character.name.localeCompare(b.scan.character.name));
    }

    let model = null;
    let scanEntries = [];
    function rebuild() {
        scanEntries = allScans();
        const active = scanEntries.filter((e) => !state.off.has(e.scan.character.name)).map((e) => e.scan);
        model = M.buildItems(DATA, active);
        // Drop picks for characters that are gone.
        const names = new Set(model.characters.map((c) => c.name));
        const pc = state.picks.owner;
        if (pc) for (const k of Array.from(pc.keys())) if (!names.has(k)) pc.delete(k);
    }

    /* ---------- facets ---------- */

    const procKeys = Object.keys(DATA.runes).filter((k) => DATA.runes[k].kind === 'proc');
    const statKeys = Object.keys(DATA.runes).filter((k) => DATA.runes[k].kind !== 'proc');

    const skillClasses = (() => {
        const map = {};
        for (const row of DATA.gear) {
            const k = row[7];
            if (!k) continue;
            (map[k] = map[k] || new Set()).add(row[1]);
        }
        return map;
    })();

    function facetDefs() {
        const selClasses = state.picks.class ? Array.from(state.picks.class).filter(([, s]) => s === 'in').map(([v]) => v) : [];
        const skillGroups = [];
        for (const cls of M.CLASSES) {
            if (selClasses.length && !selClasses.includes(cls)) continue;
            const keys = Object.keys(skillClasses).filter((k) => skillClasses[k].size === 1 && skillClasses[k].has(cls));
            keys.sort((a, b) => skillName(a).localeCompare(skillName(b)));
            skillGroups.push({ label: cls, values: keys.map((k) => ({ v: k, label: skillName(k) })) });
        }
        const shared = Object.keys(skillClasses).filter((k) => skillClasses[k].size > 1);
        skillGroups.push({ label: 'Every class', values: shared.map((k) => ({ v: k, label: skillName(k) })).concat([{ v: '', label: 'No skill rune' }]) });

        return [
            {
                key: 'is', title: 'Owned',
                values: [
                    { v: 'owned', label: 'Owned' }, { v: 'equipped', label: 'Equipped' },
                    { v: 'missing', label: 'Not owned' }, { v: 'dupe', label: 'More than one' },
                ],
                test: (it, v) => (v === 'owned' ? it.owners.length > 0 : v === 'equipped' ? it.owners.some((o) => o.equipped)
                    : v === 'missing' ? it.owners.length === 0 : it.copies > 1),
            },
            {
                key: 'owner', title: 'Character',
                values: model.characters.map((c) => ({ v: c.name, label: c.name })),
                test: (it, v) => it.owners.some((o) => o.name === v),
                emptyText: 'No scans turned on.',
            },
            { key: 'class', title: 'Class', values: M.CLASSES.map((c) => ({ v: c, label: c })), test: (it, v) => it.cls === v },
            { key: 'slot', title: 'Slot', values: M.SLOTS.map((s) => ({ v: s, label: M.SLOT_NAME[s] })), test: (it, v) => it.slot === v },
            {
                key: 'rarity', title: 'Rarity',
                values: ['L', 'R', 'M'].map((r) => ({ v: r, label: M.RARITY_NAME[r], cls: 'r-' + r })), test: (it, v) => it.rarity === v,
            },
            {
                key: 'focus', title: 'Focus',
                values: ['Attack', 'Expertise', 'Armor', 'Balanced', 'Spread'].map((f) => ({ v: f, label: M.FOCUS_NAME[f] })),
                test: (it, v) => it.focus === v,
            },
            {
                key: 'rune', title: 'Runes', multi: true, scroll: true,
                groups: [
                    { label: 'On critical hit (weapons)', values: procKeys.map((k) => ({ v: k, label: DATA.runes[k].name, title: DATA.runes[k].desc })) },
                    { label: 'Stat', values: statKeys.map((k) => ({ v: k, label: DATA.runes[k].name, title: DATA.runes[k].desc })) },
                ],
                test: (it, v) => it.runes.includes(v),
            },
            {
                key: 'skill', title: 'Skill rune', scroll: true, groups: skillGroups,
                test: (it, v) => it.skill === v,
            },
            {
                key: 'magic', title: 'Magic', multi: true,
                values: Object.keys(M.MAGIC_PART).map((k) => ({ v: k, label: M.MAGIC_PART[k] })),
                test: (it, v) => it.magicParts.includes(v),
            },
        ];
    }

    function skillName(k) {
        return DATA.skillRunes[k] ? DATA.skillRunes[k].name : k;
    }

    function facetPredicate(def) {
        const picks = state.picks[def.key];
        if (!picks || !picks.size) return null;
        const ins = [];
        const outs = [];
        for (const [v, s] of picks) (s === 'in' ? ins : outs).push(v);
        const all = def.multi && state.modes[def.key] === 'all';
        return (it) => (!ins.length || (all ? ins.every((v) => def.test(it, v)) : ins.some((v) => def.test(it, v))))
            && !outs.some((v) => def.test(it, v));
    }

    function numberPredicate() {
        const n = state.nums;
        const lo = num(n.lvlMin), hi = num(n.lvlMax), a = num(n.atkMin), e = num(n.expMin), d = num(n.defMin);
        if ([lo, hi, a, e, d].every((x) => x === null)) return null;
        return (it) => (lo === null || it.level >= lo) && (hi === null || it.level <= hi)
            && (a === null || (it.stats && it.stats.attack >= a))
            && (e === null || (it.stats && it.stats.expertise >= e))
            && (d === null || (it.stats && it.stats.defense >= d));
    }
    function num(v) {
        if (v === '' || v === null || v === undefined) return null;
        const x = Number(v);
        return isFinite(x) ? x : null;
    }

    /* ---------- compute ---------- */

    let parsed = { ast: null, error: null };
    let queryFn = () => true;
    function setQuery(text) {
        state.q = text;
        parsed = Q.parse(text);
        if (!parsed.error) queryFn = Q.compile(parsed.ast);
    }

    function compute() {
        const defs = facetDefs();
        const items = model.items;
        const base = [];
        const qf = parsed.error ? () => true : queryFn;
        const nf = numberPredicate();
        for (const it of items) if (qf(it) && (!nf || nf(it))) base.push(it);
        const preds = defs.map(facetPredicate);
        // pass[i] = how many facets the item fails; counts for facet j use items failing none but j.
        const results = [];
        const counts = defs.map(() => new Map());
        for (const it of base) {
            let fails = 0;
            let failed = -1;
            for (let j = 0; j < defs.length; j++) {
                if (preds[j] && !preds[j](it)) { fails++; failed = j; if (fails > 1) break; }
            }
            if (fails > 1) continue;
            if (fails === 0) results.push(it);
            for (let j = 0; j < defs.length; j++) {
                if (fails === 1 && j !== failed) continue;
                const def = defs[j];
                const c = counts[j];
                for (const v of valuesOf(def)) if (def.test(it, v.v)) c.set(v.v, (c.get(v.v) || 0) + 1);
            }
        }
        return { defs, results, counts };
    }

    function valuesOf(def) {
        if (def._flat) return def._flat;
        def._flat = def.groups ? def.groups.reduce((a, g) => a.concat(g.values), []) : def.values;
        return def._flat;
    }

    function sortItems(list) {
        const k = state.sort;
        const dir = state.dir;
        const slotOrder = (s) => M.SLOTS.indexOf(s);
        const clsOrder = (c) => M.CLASSES.indexOf(c);
        const statOf = (it, f) => (it.stats ? (f === 'total' ? it.total : it.stats[f]) : null);
        const cmpDefault = (a, b) => clsOrder(a.cls) - clsOrder(b.cls) || slotOrder(a.slot) - slotOrder(b.slot)
            || b.tier - a.tier || a.level - b.level || a.name.localeCompare(b.name);
        let cmp;
        if (k === 'name') cmp = (a, b) => dir * a.name.localeCompare(b.name);
        else if (k === 'level') cmp = (a, b) => dir * (a.level - b.level) || cmpDefault(a, b);
        else if (k === 'id') cmp = (a, b) => dir * (a.id - b.id) || clsOrder(a.cls) - clsOrder(b.cls) || a.tier - b.tier;
        else if (['attack', 'expertise', 'defense', 'total'].includes(k)) {
            cmp = (a, b) => {
                const x = statOf(a, k), y = statOf(b, k);
                if (x === null && y === null) return cmpDefault(a, b);
                if (x === null) return 1;
                if (y === null) return -1;
                return dir * (y - x) || cmpDefault(a, b); // highest first by default
            };
        } else cmp = (a, b) => dir * cmpDefault(a, b);
        return list.slice().sort(cmp);
    }

    /* ---------- render ---------- */

    function renderFacets(defs, counts) {
        const html = defs.map((def, j) => {
            const picks = state.picks[def.key] || new Map();
            const c = counts[j];
            const chip = (v) => {
                const st = picks.get(v.v) || '';
                const n = c.get(v.v) || 0;
                const title = (v.title ? v.title + '. ' : '') + (st === 'in' ? 'Included. Click to leave out.' : st === 'out' ? 'Left out. Click to clear.' : 'Click to include.');
                return '<button type="button" class="chip' + (n ? '' : ' zero') + '" data-facet="' + def.key + '" data-v="' + esc(v.v) + '"'
                    + (st ? ' data-state="' + st + '"' : '') + ' aria-pressed="' + (st === 'in') + '" title="' + esc(title) + '">'
                    + '<span class="' + (v.cls || '') + '">' + esc(v.label) + '</span><span class="n">' + fmt(n) + '</span></button>';
            };
            let body;
            if (def.groups) {
                body = def.groups.filter((g) => g.values.length).map((g) => '<span class="sublabel">' + esc(g.label) + '</span>' + g.values.map(chip).join('')).join('');
            } else if (!def.values.length) {
                body = '<span class="note">' + esc(def.emptyText || 'Nothing here.') + '</span>';
            } else body = def.values.map(chip).join('');
            const mode = def.multi
                ? '<button type="button" class="mode" data-mode="' + def.key + '" title="Any: an item needs one of the included chips. All: it needs every one.">'
                  + '<span class="' + (state.modes[def.key] !== 'all' ? 'on' : '') + '">Any</span><span class="' + (state.modes[def.key] === 'all' ? 'on' : '') + '">All</span></button>'
                : '';
            const clear = picks.size ? '<button type="button" class="linkbtn" data-clear="' + def.key + '">Clear</button>' : '';
            return '<div class="facet"><div class="fhead"><h3>' + esc(def.title) + '</h3>' + clear + mode + '</div>'
                + '<div class="chips' + (def.scroll ? ' scroll' : '') + '">' + body + '</div></div>';
        }).join('');
        const list = $('facetList');
        // Keep the scroll position of scrolling chip groups across renders.
        const scrolls = Array.from(list.querySelectorAll('.chips.scroll')).map((el) => el.scrollTop);
        list.innerHTML = html;
        Array.from(list.querySelectorAll('.chips.scroll')).forEach((el, i) => { el.scrollTop = scrolls[i] || 0; });
    }

    function renderStats(it) {
        if (!it.stats) return '<span class="stats none" title="No scan has this kind of item yet, so its stats are unknown.">—</span>';
        const s = it.stats;
        const cell = (v, cls) => '<span class="' + cls + (v ? '' : ' z') + '">' + fmt(v) + '</span>';
        const title = it.statSource === 'kind'
            ? 'Stats seen on another ' + M.RARITY_NAME[it.rarity] + ' ' + M.FOCUS_NAME[it.focus] + ' ' + M.SLOT_NAME[it.slot].toLowerCase() + ' of this class'
            : 'Stats read from a scan of this item';
        return '<span class="stats' + (it.statSource === 'kind' ? ' kind' : '') + '" title="' + esc(title) + '">'
            + cell(s.attack, 'atk-t') + cell(s.expertise, 'exp-t') + cell(s.defense, 'def-t') + '</span>';
    }

    function renderRow(it, hot) {
        const runes = it.runes.map((r, i) => '<span class="rune' + (r.startsWith('Proc') ? ' proc' : '') + (hot.has(r) ? ' hit' : '') + '" title="'
            + esc(DATA.runes[r] ? DATA.runes[r].desc : r) + '">' + esc(it.runeNames[i]) + '</span>').join('');
        const extra = [];
        if (it.skill) extra.push('<em>' + esc(it.skillName) + '</em>');
        if (it.magic) extra.push(esc(it.magicName));
        const owners = it.owners.length
            ? it.owners.map((o) => '<span class="o">' + esc(o.name) + (o.count > 1 ? ' ×' + o.count : '') + (o.equipped ? ' <span class="eq">equipped</span>' : '') + '</span>').join('')
            : '<span class="none">—</span>';
        const meta = [it.cls, M.SLOT_NAME[it.slot], M.FOCUS_NAME[it.focus], 'Lv ' + it.level].join(' · ');
        const open = state.open.has(it.index);
        return '<div class="row' + (open ? ' open' : '') + '" role="listitem"><button type="button" class="l1" data-i="' + it.index + '" aria-expanded="' + open + '">'
            + '<span class="iname"><b class="r-' + it.rarity + '">' + esc(it.name) + '</b><span class="meta">' + esc(meta) + '</span></span>'
            + renderStats(it)
            + '<span class="runes"><span class="rl">' + runes + '</span>' + (extra.length ? '<span class="sk">' + extra.join(' · ') + '</span>' : '') + '</span>'
            + '<span class="owned">' + owners + '</span></button>'
            + (open ? renderDetail(it) : '') + '</div>';
    }

    function renderDetail(it) {
        const runeLines = it.runes.map((r, i) => '<p><b>' + esc(it.runeNames[i]) + '</b> <span class="desc">' + esc(DATA.runes[r] ? DATA.runes[r].desc : '') + '</span></p>').join('');
        const skill = it.skill
            ? '<p><b>' + esc(it.skillName) + '</b> <span class="desc">' + esc(DATA.skillRunes[it.skill] ? DATA.skillRunes[it.skill].desc : '') + '</span></p>'
            : '<p class="desc">No skill rune.</p>';
        const magic = it.magic ? '<p><b>' + esc(it.magicName) + '</b></p>' : '<p class="desc">No magic rune.</p>';
        const owners = it.owners.length
            ? '<dl>' + it.owners.map((o) => '<dt>' + esc(o.name) + '</dt><dd>' + o.count + (o.count > 1 ? ' copies' : ' copy') + (o.equipped ? ', equipped' : '') + '</dd>').join('') + '</dl>'
            : '<p class="desc">No scanned character has this item.</p>';
        const src = !it.stats ? 'No scan has a ' + M.RARITY_NAME[it.rarity] + ' ' + M.FOCUS_NAME[it.focus] + ' ' + M.SLOT_NAME[it.slot].toLowerCase() + ' of this class yet, so the stats are unknown.'
            : it.statSource === 'scan' ? 'Stats as the game showed them in a scan.'
                : 'Stats seen on other ' + M.RARITY_NAME[it.rarity] + ' ' + M.FOCUS_NAME[it.focus] + ' ' + M.SLOT_NAME[it.slot].toLowerCase() + 's of this class; items of the same kind share them.';
        return '<div class="detail">'
            + '<div><h4>Item</h4><dl>'
            + '<dt>Gear ID</dt><dd>' + it.id + '</dd>'
            + '<dt>Rarity</dt><dd class="r-' + it.rarity + '">' + M.RARITY_NAME[it.rarity] + '</dd>'
            + '<dt>Class</dt><dd>' + esc(it.cls) + '</dd><dt>Slot</dt><dd>' + M.SLOT_NAME[it.slot] + '</dd>'
            + '<dt>Focus</dt><dd>' + M.FOCUS_NAME[it.focus] + '</dd><dt>Level</dt><dd>' + it.level + '</dd>'
            + (it.stats ? '<dt>Total stats</dt><dd>' + fmt(it.total) + '</dd>' : '')
            + '</dl><p class="src">' + esc(src) + '</p></div>'
            + '<div><h4>Runes</h4>' + (runeLines || '<p class="desc">None.</p>') + '<h4>Skill rune</h4>' + skill + '<h4>Magic</h4>' + magic + '</div>'
            + '<div><h4>Owned by</h4>' + owners + '</div>'
            + '</div>';
    }

    function hotRunes() {
        const set = new Set();
        const p = state.picks.rune;
        if (p) for (const [v, s] of p) if (s === 'in') set.add(v);
        return set;
    }

    let lastResults = [];
    function render() {
        const { defs, results, counts } = compute();
        renderFacets(defs, counts);
        lastResults = sortItems(results);
        const total = model.items.length;
        $('count').textContent = results.length === total ? fmt(total) + ' items' : fmt(results.length) + ' of ' + fmt(total) + ' items';
        const hot = hotRunes();
        const list = $('list');
        if (!lastResults.length) {
            list.innerHTML = '<div class="empty">Nothing matches. Loosen a filter, or <button type="button" class="ex" data-reset="1">clear the search and filters</button>.</div>';
        } else {
            list.innerHTML = lastResults.slice(0, state.shown).map((it) => renderRow(it, hot)).join('');
        }
        const left = lastResults.length - state.shown;
        $('more').hidden = left <= 0;
        if (left > 0) $('more').textContent = 'Show ' + fmt(Math.min(PAGE, left)) + ' more (' + fmt(left) + ' left)';
        renderStatus();
        renderSummary();
        renderScans();
        $('sort').value = state.sort;
        $('sortDir').textContent = state.dir === 1 ? '↓' : '↑';
        save();
    }

    function renderStatus() {
        const el = $('qstatus');
        const qi = $('q');
        if (parsed.error) {
            qi.classList.add('bad');
            el.innerHTML = '<span class="err">' + esc(parsed.error) + ' The search is ignored until it reads.</span>';
            return;
        }
        qi.classList.remove('bad');
        if (!parsed.ast) { el.innerHTML = 'Search by name, or use fields like <code>rune:hemorrhage</code> with and, or and not. Press <code>/</code> to jump here.'; return; }
        const reads = Q.describe(parsed.ast);
        el.innerHTML = '<span class="reads">Reads as <code>' + esc(reads) + '</code></span>';
    }

    function renderSummary() {
        const owned = model.items.filter((i) => i.owners.length).length;
        const chars = model.characters.length;
        $('summary').textContent = fmt(model.items.length) + ' items in the game · ' + fmt(owned) + ' owned by ' + chars + (chars === 1 ? ' character' : ' characters');
        const known = model.items.filter((i) => i.stats).length;
        $('statNote').textContent = 'Stats come from scans, so ' + fmt(known) + ' of ' + fmt(model.items.length)
            + ' items have them. The game\'s stat tables don\'t match the rebuilt game, so they aren\'t used.';
        $('dataNote').textContent = fmt(DATA.gear.length) + ' items, ' + fmt(Object.keys(DATA.runes).length) + ' runes, ' + fmt(Object.keys(DATA.skillRunes).length) + ' skill runes.';
    }

    function renderScans() {
        const ul = $('scanList');
        if (!scanEntries.length) { ul.innerHTML = '<li class="note">No scans yet. Import one from DB Inventory Scanner.</li>'; return; }
        ul.innerHTML = scanEntries.map((e) => {
            const s = e.scan;
            const on = !state.off.has(s.character.name);
            const ch = model.characters.find((c) => c.name === s.character.name);
            const date = s.scannedAt ? s.scannedAt.slice(0, 10) : '';
            const miss = ch && ch.unmatched.length ? ' · ' + ch.unmatched.length + ' not found' : '';
            return '<li class="' + (on ? '' : 'off') + '">'
                + '<button type="button" class="iconbtn" data-scan-toggle="' + esc(s.character.name) + '" title="' + (on ? 'Turn this scan off' : 'Turn this scan on') + '" aria-pressed="' + on + '">' + (on ? '●' : '○') + '</button>'
                + '<span class="who" title="' + esc(s.character.name) + '">' + esc(s.character.name) + '</span>'
                + '<span class="meta">' + esc(s.character.class) + ' · ' + esc(date) + (ch ? ' · ' + fmt(ch.items) : '') + esc(miss) + '</span>'
                + (e.seed ? '' : '<button type="button" class="iconbtn" data-scan-remove="' + esc(s.character.name) + '" title="Remove this imported scan">×</button>')
                + '</li>';
        }).join('');
    }

    function toast(text, bad) {
        const t = $('toast');
        t.textContent = text;
        t.classList.toggle('bad', !!bad);
        t.hidden = false;
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3500);
    }

    /* ---------- events ---------- */

    function rerender(resetPage) {
        if (resetPage !== false) state.shown = PAGE;
        render();
    }

    let qTimer = null;
    $('q').addEventListener('input', (e) => {
        clearTimeout(qTimer);
        const v = e.target.value;
        qTimer = setTimeout(() => { setQuery(v); rerender(); }, 120);
    });
    $('q').addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && e.target.value) { e.target.value = ''; setQuery(''); rerender(); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
    });
    $('helpBtn').addEventListener('click', () => {
        const open = $('help').hidden;
        $('help').hidden = !open;
        $('helpBtn').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
        const ex = e.target.closest('.ex');
        if (ex && ex.dataset.reset) { resetAll(); return; }
        if (ex) { $('q').value = ex.textContent; setQuery(ex.textContent); rerender(); $('q').focus(); }
    });

    $('facetList').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip) {
            const key = chip.dataset.facet;
            const v = chip.dataset.v;
            const m = state.picks[key] || (state.picks[key] = new Map());
            const st = m.get(v);
            if (!st) m.set(v, 'in');
            else if (st === 'in') m.set(v, 'out');
            else m.delete(v);
            if (key === 'class') pruneSkills();
            rerender();
            return;
        }
        const mode = e.target.closest('[data-mode]');
        if (mode) {
            const k = mode.dataset.mode;
            state.modes[k] = state.modes[k] === 'all' ? 'any' : 'all';
            rerender();
            return;
        }
        const clear = e.target.closest('[data-clear]');
        if (clear) { delete state.picks[clear.dataset.clear]; rerender(); }
    });

    // Skill runes of classes no longer shown would filter invisibly; drop them.
    function pruneSkills() {
        const sk = state.picks.skill;
        const cls = state.picks.class;
        if (!sk || !cls) return;
        const ins = Array.from(cls).filter(([, s]) => s === 'in').map(([v]) => v);
        if (!ins.length) return;
        for (const k of Array.from(sk.keys())) {
            if (k && skillClasses[k] && !ins.some((c) => skillClasses[k].has(c))) sk.delete(k);
        }
    }

    $('clearAll').addEventListener('click', resetAll);
    function resetAll() {
        state.picks = {};
        state.nums = {};
        state.modes = { rune: 'any', magic: 'any' };
        $('q').value = '';
        setQuery('');
        ['lvlMin', 'lvlMax', 'atkMin', 'expMin', 'defMin'].forEach((id) => { $(id).value = ''; });
        rerender();
    }

    ['lvlMin', 'lvlMax', 'atkMin', 'expMin', 'defMin'].forEach((id) => {
        $(id).value = state.nums[id] !== undefined ? state.nums[id] : '';
        $(id).addEventListener('input', (e) => { state.nums[id] = e.target.value; rerender(); });
    });

    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; state.dir = 1; rerender(); });
    $('sortDir').addEventListener('click', () => { state.dir = -state.dir; rerender(); });
    $('more').addEventListener('click', () => { state.shown += PAGE; render(); });
    $('list').addEventListener('click', (e) => {
        const b = e.target.closest('button.l1');
        if (!b) return;
        const i = Number(b.dataset.i);
        if (state.open.has(i)) state.open.delete(i); else state.open.add(i);
        const it = model.items[i];
        const row = b.parentElement;
        row.outerHTML = renderRow(it, hotRunes());
        const again = $('list').querySelector('button.l1[data-i="' + i + '"]');
        if (again) again.focus();
    });
    $('filterToggle').addEventListener('click', () => {
        const f = $('filters');
        f.classList.toggle('closed');
        $('filterToggle').setAttribute('aria-expanded', String(!f.classList.contains('closed')));
    });

    $('scanList').addEventListener('click', (e) => {
        const t = e.target.closest('[data-scan-toggle]');
        if (t) {
            const n = t.dataset.scanToggle;
            if (state.off.has(n)) state.off.delete(n); else state.off.add(n);
            rebuild();
            rerender();
            return;
        }
        const r = e.target.closest('[data-scan-remove]');
        if (r) {
            const n = r.dataset.scanRemove;
            state.imports = state.imports.filter((s) => s.character.name !== n);
            state.off.delete(n);
            rebuild();
            rerender();
            toast('Removed the imported scan of ' + n + '.');
        }
    });

    /* ---------- import ---------- */

    function importTexts(files) {
        const done = [];
        const bad = [];
        let pending = files.length;
        if (!pending) return;
        for (const f of files) {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const scan = M.parseScan(String(reader.result));
                    const name = scan.character.name;
                    const old = state.imports.find((s) => s.character.name === name);
                    if (old && old.scannedAt && scan.scannedAt && old.scannedAt > scan.scannedAt) {
                        bad.push(f.name + ': an imported scan of ' + name + ' is newer, so it stays.');
                    } else {
                        state.imports = state.imports.filter((s) => s.character.name !== name).concat([scan]);
                        state.off.delete(name);
                        done.push(name + ' (' + fmt(scan.gear.length) + ' items)');
                    }
                } catch (err) {
                    bad.push(f.name + ': ' + err.message);
                }
                finish();
            };
            reader.onerror = () => { bad.push(f.name + ': the file could not be read.'); finish(); };
            reader.readAsText(f);
        }
        function finish() {
            if (--pending) return;
            if (done.length) { rebuild(); rerender(); }
            if (bad.length) toast((done.length ? 'Imported ' + done.join(', ') + '. ' : '') + bad.join(' '), true);
            else toast('Imported ' + done.join(', ') + '.');
        }
    }

    $('importFile').addEventListener('change', (e) => {
        importTexts(Array.from(e.target.files || []));
        e.target.value = '';
    });
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('drop').hidden = false; });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        $('drop').hidden = true;
        importTexts(Array.from(e.dataTransfer.files).filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json'));
    });

    /* ---------- start ---------- */

    if (!DATA || !Q || !M) {
        $('summary').textContent = 'The gear list did not load. Reload the page.';
        return;
    }
    if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) {
        $('filters').classList.add('closed');
        $('filterToggle').setAttribute('aria-expanded', 'false');
    }
    rebuild();
    $('q').value = state.q;
    setQuery(state.q);
    render();
})();
