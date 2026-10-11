/* DB Gear Library: every gear item in the game in one CSV-style table, filtered by dropdowns.
 *
 * Dropdowns (app/filters.js): class, gear type, rarity, stat focus, rune, skill rune, owned by.
 * Each option shows how many items it would give with the other dropdowns as they are.
 * Scans: the bundled ones (data/scans) plus any the viewer imports, kept in this browser.
 */
(function () {
    'use strict';

    const DATA = window.DBB_GEAR;
    const SEED = window.DBB_SEED_SCANS || [];
    const M = window.GearModel;
    const F = window.GearFilters;
    const STORE_KEY = 'dbb-gearlib-v2';
    const PAGE = 200;
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
        picked: saved.picked && typeof saved.picked === 'object' ? saved.picked : {},
        sort: saved.sort || 'default', // a column key, or 'default'
        dir: saved.dir === -1 ? -1 : 1,
        shown: PAGE,
        open: new Set(),
        alt: new Set(), // rows drawn with the darker stripe, so a re-drawn row keeps its stripe
    };
    if (!saved.imports) {
        // Carry imported scans over from the first version of the page.
        try {
            const old = JSON.parse(localStorage.getItem('dbb-gearlib-v1') || '{}');
            if (Array.isArray(old.imports)) state.imports = old.imports;
        } catch (_e) { /* nothing to carry over */ }
    }

    let saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(STORE_KEY, JSON.stringify({ imports: state.imports, picked: state.picked, sort: state.sort, dir: state.dir }));
            } catch (_e) { /* storage full or blocked: the page still works */ }
        }, 250);
    }

    /* ---------- items ---------- */

    let model = null;
    function rebuild() {
        // An imported scan replaces a bundled one of the same character.
        const byName = new Map();
        for (const s of SEED) byName.set(s.character.name.toLowerCase(), s);
        for (const s of state.imports) byName.set(s.character.name.toLowerCase(), s);
        const scans = Array.from(byName.values()).sort((a, b) => a.character.name.localeCompare(b.character.name));
        model = M.buildItems(DATA, scans);
        const o = state.picked.owner;
        if (o && o.startsWith('@') && !model.characters.some((c) => '@' + c.name === o)) delete state.picked.owner;
    }

    /* ---------- columns (table and CSV) ---------- */

    const ownerText = (it) => it.owners.map((o) => o.name + (o.count > 1 ? ' x' + o.count : '') + (o.equipped ? ' (equipped)' : '')).join('; ');
    const stat = (it, f) => (it.stats ? (f === 'total' ? it.total : it.stats[f]) : null);
    const COLS = [
        { key: 'name', label: 'Name', text: (it) => it.name },
        { key: 'class', label: 'Class', text: (it) => it.cls, order: (it) => M.CLASSES.indexOf(it.cls) },
        { key: 'slot', label: 'Type', text: (it) => M.SLOT_NAME[it.slot], order: (it) => M.SLOTS.indexOf(it.slot) },
        { key: 'rarity', label: 'Rarity', text: (it) => M.RARITY_NAME[it.rarity], order: (it) => -it.tier },
        { key: 'focus', label: 'Focus', text: (it) => M.FOCUS_NAME[it.focus] },
        { key: 'level', label: 'Lv', csv: 'Level', num: true, value: (it) => it.level },
        { key: 'attack', label: 'Atk', csv: 'Attack', num: true, high: true, cls: 'atk-t', value: (it) => stat(it, 'attack') },
        { key: 'expertise', label: 'Exp', csv: 'Expertise', num: true, high: true, cls: 'exp-t', value: (it) => stat(it, 'expertise') },
        { key: 'defense', label: 'Def', csv: 'Defense', num: true, high: true, cls: 'def-t', value: (it) => stat(it, 'defense') },
        { key: 'total', label: 'Total', num: true, high: true, value: (it) => stat(it, 'total') },
        { key: 'rune1', label: 'Rune 1', text: (it) => it.runeNames[0] || '' },
        { key: 'rune2', label: 'Rune 2', text: (it) => it.runeNames[1] || '' },
        { key: 'skill', label: 'Skill rune', text: (it) => it.skillName },
        { key: 'magic', label: 'Magic', text: (it) => it.magicName },
        { key: 'owner', label: 'Owned by', text: ownerText, order: (it) => (it.owners.length ? 0 : 1) },
        { key: 'id', label: 'ID', csv: 'Gear ID', num: true, value: (it) => it.id },
    ];
    const COL = Object.fromEntries(COLS.map((c) => [c.key, c]));

    function sortItems(list) {
        const cmpDefault = (a, b) => M.CLASSES.indexOf(a.cls) - M.CLASSES.indexOf(b.cls) || M.SLOTS.indexOf(a.slot) - M.SLOTS.indexOf(b.slot)
            || b.tier - a.tier || a.level - b.level || a.name.localeCompare(b.name);
        const col = COL[state.sort];
        if (!col) return list.slice().sort(cmpDefault);
        const dir = state.dir;
        let cmp;
        if (col.num) {
            cmp = (a, b) => {
                const x = col.value(a), y = col.value(b);
                if (x === null && y === null) return cmpDefault(a, b);
                if (x === null) return 1; // unknown stats always last
                if (y === null) return -1;
                return dir * (x - y) || cmpDefault(a, b);
            };
        } else if (col.order) {
            cmp = (a, b) => dir * (col.order(a) - col.order(b)) || dir * col.text(a).localeCompare(col.text(b)) || cmpDefault(a, b);
        } else {
            cmp = (a, b) => {
                const x = col.text(a), y = col.text(b);
                if (!x && y) return 1; // blanks last
                if (x && !y) return -1;
                return dir * x.localeCompare(y) || cmpDefault(a, b);
            };
        }
        return list.slice().sort(cmp);
    }

    function csvCell(v) {
        const t = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }
    function toCsv(list) {
        const lines = [COLS.map((c) => csvCell(c.csv || c.label)).join(',')];
        for (const it of list) lines.push(COLS.map((c) => csvCell(c.num ? c.value(it) : c.text(it))).join(','));
        return lines.join('\r\n') + '\r\n';
    }

    /* ---------- render ---------- */

    function renderFilters(defs, counts) {
        const bar = $('filterbar');
        const focused = document.activeElement && document.activeElement.id;
        bar.innerHTML = defs.map((d) => {
            const c = counts[d.key];
            const v = state.picked[d.key] || '';
            const option = (o) => '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.label) + ' (' + fmt(c[o.v] || 0) + ')</option>';
            const body = d.groups
                ? d.groups.map((g) => '<optgroup label="' + esc(g.label) + '">' + g.options.map(option).join('') + '</optgroup>').join('')
                : d.options.map(option).join('');
            return '<label class="fsel' + (v ? ' on' : '') + '"><span>' + esc(d.label) + '</span>'
                + '<select id="f-' + d.key + '" data-key="' + d.key + '"><option value="">' + esc(d.any) + '</option>' + body + '</select></label>';
        }).join('');
        if (focused && focused.startsWith('f-') && $(focused)) $(focused).focus();
        $('clearAll').hidden = !Object.keys(state.picked).some((k) => state.picked[k]);
    }

    function renderHead() {
        $('gridHead').innerHTML = COLS.map((c) => {
            const on = state.sort === c.key;
            const arrow = on ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
            const aria = on ? (state.dir === 1 ? 'ascending' : 'descending') : 'none';
            return '<th scope="col" class="c-' + c.key + (c.num ? ' n' : '') + '" aria-sort="' + aria + '">'
                + '<button type="button" data-sort="' + c.key + '" class="' + (c.cls || '') + (on ? ' on' : '') + '">' + c.label + arrow + '</button></th>';
        }).join('');
        $('sortReset').hidden = !COL[state.sort];
    }

    function renderRow(it, hot, pos) {
        const open = state.open.has(it.index);
        const cells = COLS.map((c) => {
            if (c.num) {
                const v = c.value(it);
                const kind = c.high && it.statSource === 'kind' ? ' kind' : '';
                return '<td class="n c-' + c.key + kind + (v === 0 ? ' zero' : '') + '">' + (v === null ? '<span class="z">—</span>' : fmt(v)) + '</td>';
            }
            if (c.key === 'name') {
                return '<td class="c-name"><button type="button" class="l1 r-' + it.rarity + '" data-i="' + it.index + '" aria-expanded="' + open + '">' + esc(it.name) + '</button></td>';
            }
            if (c.key === 'rune1' || c.key === 'rune2') {
                const r = it.runes[c.key === 'rune1' ? 0 : 1];
                if (!r) return '<td class="c-' + c.key + '"></td>';
                return '<td class="c-' + c.key + '"><span class="rune' + (r.startsWith('Proc') ? ' proc' : '') + (hot === r ? ' hit' : '') + '" title="'
                    + esc(DATA.runes[r] ? DATA.runes[r].desc : r) + '">' + esc(c.text(it)) + '</span></td>';
            }
            if (c.key === 'rarity') return '<td class="c-rarity r-' + it.rarity + '">' + esc(c.text(it)) + '</td>';
            if (c.key === 'owner') {
                return '<td class="c-owner">' + it.owners.map((o) => esc(o.name) + (o.count > 1 ? ' ×' + o.count : '') + (o.equipped ? ' <span class="eq">E</span>' : '')).join(', ') + '</td>';
            }
            return '<td class="c-' + c.key + '">' + esc(c.text(it)) + '</td>';
        }).join('');
        const alt = pos === undefined ? state.alt.has(it.index) : pos % 2 === 1;
        if (alt) state.alt.add(it.index); else state.alt.delete(it.index);
        return '<tr class="row' + (open ? ' open' : '') + (alt ? ' alt' : '') + '" data-i="' + it.index + '">' + cells + '</tr>'
            + (open ? '<tr class="detailrow"><td colspan="' + COLS.length + '">' + renderDetail(it) + '</td></tr>' : '');
    }

    function renderDetail(it) {
        const kind = M.RARITY_NAME[it.rarity] + ' ' + M.FOCUS_NAME[it.focus] + ' ' + M.SLOT_NAME[it.slot].toLowerCase();
        const runeLines = it.runes.map((r, i) => '<p><b>' + esc(it.runeNames[i]) + '</b> <span class="desc">' + esc(DATA.runes[r] ? DATA.runes[r].desc : '') + '</span></p>').join('');
        const skill = it.skill
            ? '<p><b>' + esc(it.skillName) + '</b> <span class="desc">' + esc(DATA.skillRunes[it.skill] ? DATA.skillRunes[it.skill].desc : '') + '</span></p>'
            : '<p class="desc">No skill rune.</p>';
        const magic = it.magic ? '<p><b>' + esc(it.magicName) + '</b></p>' : '<p class="desc">No magic rune.</p>';
        const owners = it.owners.length
            ? '<dl>' + it.owners.map((o) => '<dt>' + esc(o.name) + '</dt><dd>' + o.count + (o.count > 1 ? ' copies' : ' copy') + (o.equipped ? ', equipped' : '') + '</dd>').join('') + '</dl>'
            : '<p class="desc">No scanned character has this item.</p>';
        const src = !it.stats ? 'No scan has a ' + kind + ' of this class yet, so the stats are unknown.'
            : it.statSource === 'scan' ? 'Stats as the game showed them in a scan.'
                : 'Stats seen on another ' + kind + ' of this class; items of the same kind share them.';
        return '<div class="detail">'
            + '<div><h4>Item</h4><p class="src">Gear ID ' + it.id + ' · ' + esc(it.cls) + ' · level ' + it.level + '</p><p class="src">' + esc(src) + '</p></div>'
            + '<div><h4>Runes</h4>' + (runeLines || '<p class="desc">None.</p>') + '<h4>Skill rune</h4>' + skill + '<h4>Magic</h4>' + magic + '</div>'
            + '<div><h4>Owned by</h4>' + owners + '</div>'
            + '</div>';
    }

    let lastResults = [];
    function render() {
        const defs = F.defs(DATA, model.characters, state.picked);
        // A skill rune of a class no longer picked would hide everything; drop it.
        if (state.picked.skill && !F.optionsOf(defs[5]).some((o) => o.v === state.picked.skill)) delete state.picked.skill;
        const { results, counts } = F.apply(model.items, defs, state.picked);
        renderFilters(defs, counts);
        lastResults = sortItems(results);
        const total = model.items.length;
        $('count').textContent = results.length === total ? fmt(total) + ' items' : fmt(results.length) + ' of ' + fmt(total) + ' items';
        const list = $('list');
        if (!lastResults.length) {
            list.innerHTML = '<tr><td colspan="' + COLS.length + '" class="empty">Nothing matches these filters. <button type="button" class="linkbtn" data-reset="1">Clear filters</button></td></tr>';
        } else {
            const hot = state.picked.rune || '';
            list.innerHTML = lastResults.slice(0, state.shown).map((it, n) => renderRow(it, hot, n)).join('');
        }
        const left = lastResults.length - state.shown;
        $('more').hidden = left <= 0;
        if (left > 0) $('more').textContent = 'Show ' + fmt(Math.min(PAGE, left)) + ' more (' + fmt(left) + ' left)';
        const owned = model.items.filter((i) => i.owners.length).length;
        const chars = model.characters.length;
        $('summary').textContent = fmt(total) + ' items in the game · ' + fmt(owned) + ' owned by ' + chars + (chars === 1 ? ' scanned character' : ' scanned characters');
        $('dataNote').textContent = model.characters.map((c) => c.name + ' (' + c.cls + (c.scannedAt ? ', ' + c.scannedAt.slice(0, 10) : '') + ')').join(' · ');
        renderHead();
        save();
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

    function rerender() {
        state.shown = PAGE;
        render();
    }

    $('filterbar').addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-key]');
        if (!sel) return;
        if (sel.value) state.picked[sel.dataset.key] = sel.value; else delete state.picked[sel.dataset.key];
        rerender();
    });
    function clearFilters() { state.picked = {}; rerender(); }
    $('clearAll').addEventListener('click', clearFilters);
    $('gridHead').addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        const k = b.dataset.sort;
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = COL[k].high ? -1 : 1; }
        rerender();
    });
    $('sortReset').addEventListener('click', () => { state.sort = 'default'; state.dir = 1; rerender(); });
    $('more').addEventListener('click', () => { state.shown += PAGE; render(); });
    $('list').addEventListener('click', (e) => {
        if (e.target.closest('[data-reset]')) { clearFilters(); return; }
        const b = e.target.closest('button.l1');
        if (!b) return;
        const i = Number(b.dataset.i);
        if (state.open.has(i)) state.open.delete(i); else state.open.add(i);
        const tr = b.closest('tr');
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('detailrow')) next.remove();
        tr.outerHTML = renderRow(model.items[i], state.picked.rune || '');
        const again = $('list').querySelector('button.l1[data-i="' + i + '"]');
        if (again) again.focus();
    });

    $('copyCsv').addEventListener('click', () => {
        const csv = toCsv(lastResults);
        const n = fmt(lastResults.length) + (lastResults.length === 1 ? ' row' : ' rows');
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = csv;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
            ta.remove();
            toast(ok ? 'Copied ' + n + ' as CSV.' : 'The browser refused to copy. Use Download CSV instead.', !ok);
        };
        try {
            navigator.clipboard.writeText(csv).then(() => toast('Copied ' + n + ' as CSV.'), fallback);
        } catch (_e) { fallback(); }
    });
    // A page framed by another site (a preview) can't save files, so the button only shows standalone.
    let framed = true;
    try { framed = window.self !== window.top; } catch (_e) { framed = true; }
    $('saveCsv').hidden = framed;
    $('saveCsv').addEventListener('click', () => {
        const parts = Object.keys(state.picked).filter((k) => state.picked[k]).map((k) => state.picked[k].replace(/[^A-Za-z0-9]+/g, ''));
        const blob = new Blob(['﻿' + toCsv(lastResults)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'db-gear' + (parts.length ? '-' + parts.join('-') : '') + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });

    /* ---------- import ---------- */

    function importFiles(files) {
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
                    state.imports = state.imports.filter((s) => s.character.name !== name).concat([scan]);
                    done.push(name + ' (' + fmt(scan.gear.length) + ' items)');
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
        importFiles(Array.from(e.target.files || []));
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
        importFiles(Array.from(e.dataTransfer.files).filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json'));
    });

    /* ---------- start ---------- */

    if (!DATA || !M || !F) {
        $('summary').textContent = 'The gear list did not load. Reload the page.';
        return;
    }
    rebuild();
    render();
})();
