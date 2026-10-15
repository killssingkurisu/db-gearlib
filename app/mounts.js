/* DB Gear Library, Mounts section: every mount in the game in one compact table.
 *
 * Data: app/data/mount-data.js (made by tools/build-data.js from data/mounts.json).
 * Pictures: mounts/thumb/<MountName>.webp in the table, mounts/large/<MountName>.webp when a
 * row is opened. Both are drawn from the game's art (tools/mounts) and centred in a 3:2 frame.
 */
(function () {
    'use strict';

    const DATA = window.DBB_MOUNTS;
    const STORE_KEY = 'dbb-gearlib-mounts-v1';
    const NOT_SOLD = 999999999;
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const RARITY = { M: 'Magic', R: 'Rare', L: 'Legendary' };
    const RARITY_ORDER = { M: 0, R: 1, L: 2 };

    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const sold = (m) => m.idols > 0 && m.idols < NOT_SOLD;

    /* ---------- saved state ---------- */

    function loadStore() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_e) { return {}; }
    }
    const saved = loadStore();
    const state = {
        picked: saved.picked && typeof saved.picked === 'object' ? saved.picked : {},
        q: typeof saved.q === 'string' ? saved.q : '',
        sort: saved.sort || 'default',
        dir: saved.dir === -1 ? -1 : 1,
        open: new Set(),
    };
    let saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORE_KEY, JSON.stringify({ picked: state.picked, q: state.q, sort: state.sort, dir: state.dir })); } catch (_e) { /* blocked: fine */ }
        }, 250);
    }

    /* ---------- filters ---------- */

    const FILTERS = [
        { key: 'rig', label: 'Rig', any: 'Any rig', options: [{ v: 'Horse', label: 'Horse' }, { v: 'Dire', label: 'Dire' }], test: (m, v) => m.rig === v },
        { key: 'rarity', label: 'Rarity', any: 'Any rarity', options: [{ v: 'M', label: 'Magic' }, { v: 'R', label: 'Rare' }, { v: 'L', label: 'Legendary' }], test: (m, v) => m.rarity === v },
        { key: 'level', label: 'Level', any: 'Any level', options: [{ v: '20', label: 'Level 20' }, { v: '40', label: 'Level 40' }], test: (m, v) => String(m.level) === v },
        { key: 'idols', label: 'Idols', any: 'Any', options: [{ v: 'sold', label: 'Sold for idols' }, { v: 'not', label: 'Not sold for idols' }], test: (m, v) => (v === 'sold') === sold(m) },
    ];

    // Every typed word must appear in the name or code name, in any order, ignoring case,
    // spaces and punctuation (as the gear search does).
    const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    function matcher(q) {
        const words = String(q || '').toLowerCase().split(/\s+/).map(squash).filter(Boolean);
        if (!words.length) return null;
        return (m) => { const hay = m._hay || (m._hay = squash(m.name) + '|' + squash(m.key)); return words.every((w) => hay.includes(w)); };
    }

    function apply(list) {
        const byQ = matcher(state.q);
        const base = byQ ? list.filter(byQ) : list;
        const passes = (m, skip) => FILTERS.every((f) => f.key === skip || !state.picked[f.key] || f.test(m, state.picked[f.key]));
        const counts = {};
        for (const f of FILTERS) {
            const c = (counts[f.key] = {});
            for (const m of base) {
                if (!passes(m, f.key)) continue;
                for (const o of f.options) if (f.test(m, o.v)) c[o.v] = (c[o.v] || 0) + 1;
            }
        }
        return { results: base.filter((m) => passes(m)), counts };
    }

    /* ---------- columns ---------- */

    const COLS = [
        { key: 'id', label: 'ID', num: true, value: (m) => m.id },
        { key: 'pic', label: '', nosort: true },
        { key: 'name', label: 'Name', text: (m) => m.name },
        { key: 'key', label: 'Code name', text: (m) => m.key },
        { key: 'rig', label: 'Rig', text: (m) => m.rig },
        { key: 'rarity', label: 'Rarity', text: (m) => RARITY[m.rarity] || m.rarity, order: (m) => -RARITY_ORDER[m.rarity] },
        { key: 'level', label: 'Lv', csv: 'Level', num: true, value: (m) => m.level },
        { key: 'idols', label: 'Idols', num: true, value: (m) => (sold(m) ? m.idols : null) },
        { key: 'desc', label: 'Description', text: (m) => m.description },
    ];
    const COL = Object.fromEntries(COLS.map((c) => [c.key, c]));

    function sortList(list) {
        const byId = (a, b) => a.id - b.id;
        const col = COL[state.sort];
        if (!col) return list.slice().sort(byId);
        const dir = state.dir;
        let cmp;
        if (col.num) {
            cmp = (a, b) => {
                const x = col.value(a), y = col.value(b);
                if (x === null && y === null) return byId(a, b);
                if (x === null) return 1; // not sold: always last
                if (y === null) return -1;
                return dir * (x - y) || byId(a, b);
            };
        } else if (col.order) {
            cmp = (a, b) => dir * (col.order(a) - col.order(b)) || byId(a, b);
        } else {
            cmp = (a, b) => {
                const x = col.text(a), y = col.text(b);
                if (!x && y) return 1; // blanks last
                if (x && !y) return -1;
                return dir * x.localeCompare(y) || byId(a, b);
            };
        }
        return list.slice().sort(cmp);
    }

    function csvCell(v) {
        const t = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }
    function toCsv(list) {
        const head = ['Mount ID', 'Name', 'Code name', 'Rig', 'Rarity', 'Level', 'Idols', 'Description'];
        const lines = [head.join(',')];
        for (const m of list) {
            lines.push([m.id, m.name, m.key, m.rig, RARITY[m.rarity] || m.rarity, m.level, sold(m) ? m.idols : '', m.description].map(csvCell).join(','));
        }
        return lines.join('\r\n') + '\r\n';
    }

    /* ---------- render ---------- */

    function renderFilters(counts) {
        const focused = document.activeElement && document.activeElement.id;
        $('filterbar').innerHTML = FILTERS.map((f) => {
            const c = counts[f.key];
            const v = state.picked[f.key] || '';
            const opts = f.options.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.label) + ' (' + fmt(c[o.v] || 0) + ')</option>').join('');
            return '<label class="fsel' + (v ? ' on' : '') + '"><span>' + esc(f.label) + '</span>'
                + '<select id="f-' + f.key + '" data-key="' + f.key + '"><option value="">' + esc(f.any) + '</option>' + opts + '</select></label>';
        }).join('');
        if (focused && focused.startsWith('f-') && $(focused)) $(focused).focus();
        $('clearAll').hidden = !state.q.trim() && !Object.keys(state.picked).some((k) => state.picked[k]);
        $('q').classList.toggle('on', !!state.q.trim());
    }

    function renderHead() {
        $('gridHead').innerHTML = COLS.map((c) => {
            if (c.nosort) return '<th scope="col" class="c-' + c.key + '"><span class="visually-hidden">Picture</span></th>';
            const on = state.sort === c.key;
            const arrow = on ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
            const aria = on ? (state.dir === 1 ? 'ascending' : 'descending') : 'none';
            return '<th scope="col" class="c-' + c.key + (c.num ? ' n' : '') + '" aria-sort="' + aria + '">'
                + '<button type="button" data-sort="' + c.key + '" class="' + (on ? 'on' : '') + '">' + c.label + arrow + '</button></th>';
        }).join('');
        $('sortReset').hidden = !COL[state.sort];
    }

    const thumb = (m) => 'mounts/thumb/' + encodeURIComponent(m.key) + '.webp';
    const large = (m) => 'mounts/large/' + encodeURIComponent(m.key) + '.webp';

    function renderRow(m, pos) {
        const open = state.open.has(m.id);
        const cells = COLS.map((c) => {
            if (c.key === 'pic') {
                return '<td class="c-pic"><button type="button" class="picbtn" data-id="' + m.id + '" tabindex="-1" aria-hidden="true">'
                    + '<img class="pic" src="' + thumb(m) + '" width="72" height="48" loading="lazy" decoding="async" alt=""></button></td>';
            }
            if (c.key === 'name') {
                return '<td class="c-name"><button type="button" class="l1 r-' + esc(m.rarity) + '" data-id="' + m.id + '" aria-expanded="' + open + '">' + esc(m.name) + '</button></td>';
            }
            if (c.num) {
                const v = c.value(m);
                return '<td class="n c-' + c.key + '">' + (v === null ? '<span class="z" title="Not sold for idols">—</span>' : fmt(v)) + '</td>';
            }
            if (c.key === 'rarity') return '<td class="c-rarity r-' + esc(m.rarity) + '">' + esc(c.text(m)) + '</td>';
            if (c.key === 'desc') return '<td class="c-desc" title="' + esc(m.description) + '">' + esc(m.description) + '</td>';
            return '<td class="c-' + c.key + '">' + esc(c.text(m)) + '</td>';
        }).join('');
        return '<tr class="row' + (open ? ' open' : '') + (pos % 2 ? ' alt' : '') + '" data-id="' + m.id + '">' + cells + '</tr>'
            + (open ? '<tr class="detailrow"><td colspan="' + COLS.length + '">' + renderDetail(m) + '</td></tr>' : '');
    }

    function renderDetail(m) {
        const desc = m.description
            ? '<p class="desc">' + esc(m.description) + '</p>'
            : '<p class="desc none">The game gives this mount no description.</p>';
        return '<div class="mdetail">'
            + '<img src="' + large(m) + '" width="240" height="160" decoding="async" alt="' + esc(m.name) + '">'
            + '<div class="txt">' + desc
            + '<dl>'
            + '<dt>Mount ID</dt><dd>' + m.id + ' · ' + esc(m.key) + '</dd>'
            + '<dt>Rig</dt><dd>' + esc(m.rig) + (m.entity ? ' · drawn as “' + esc(m.entity) + '”' : '') + '</dd>'
            + '<dt>Rarity</dt><dd>' + esc(RARITY[m.rarity] || m.rarity) + ' · level ' + m.level + '</dd>'
            + '<dt>Idols</dt><dd>' + (sold(m) ? fmt(m.idols) : 'Not sold for idols') + '</dd>'
            + '</dl></div></div>';
    }

    let lastResults = [];
    function render() {
        const { results, counts } = apply(DATA.mounts);
        renderFilters(counts);
        lastResults = sortList(results);
        const total = DATA.mounts.length;
        $('count').textContent = results.length === total ? fmt(total) + ' mounts' : fmt(results.length) + ' of ' + fmt(total) + ' mounts';
        const list = $('list');
        if (!lastResults.length) {
            list.innerHTML = '<tr><td colspan="' + COLS.length + '" class="empty">' + (state.q.trim() ? 'No mount matches “' + esc(state.q.trim()) + '” with these filters.' : 'Nothing matches these filters.') + ' <button type="button" class="linkbtn" data-reset="1">Clear filters</button></td></tr>';
        } else {
            list.innerHTML = lastResults.map((m, n) => renderRow(m, n)).join('');
        }
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

    $('filterbar').addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-key]');
        if (!sel) return;
        if (sel.value) state.picked[sel.dataset.key] = sel.value; else delete state.picked[sel.dataset.key];
        render();
    });
    function clearFilters() { state.picked = {}; state.q = ''; $('q').value = ''; render(); }
    let qTimer = null;
    $('q').addEventListener('input', (e) => {
        clearTimeout(qTimer);
        const v = e.target.value;
        qTimer = setTimeout(() => { state.q = v; render(); }, 120);
    });
    $('q').addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && e.target.value) { e.target.value = ''; clearTimeout(qTimer); state.q = ''; render(); }
    });
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) { e.preventDefault(); $('q').focus(); }
    });
    $('clearAll').addEventListener('click', clearFilters);
    $('gridHead').addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        const k = b.dataset.sort;
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = 1; }
        render();
    });
    $('sortReset').addEventListener('click', () => { state.sort = 'default'; state.dir = 1; render(); });
    $('list').addEventListener('click', (e) => {
        if (e.target.closest('[data-reset]')) { clearFilters(); return; }
        const b = e.target.closest('button.l1, button.picbtn');
        if (!b) return;
        const id = Number(b.dataset.id);
        const m = DATA.mounts.find((x) => x.id === id);
        if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
        const tr = b.closest('tr');
        const pos = lastResults.indexOf(m);
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('detailrow')) next.remove();
        tr.outerHTML = renderRow(m, pos);
        const again = $('list').querySelector('button.l1[data-id="' + id + '"]');
        if (again) again.focus();
    });

    $('copyCsv').addEventListener('click', () => {
        const csv = toCsv(lastResults);
        const n = fmt(lastResults.length) + (lastResults.length === 1 ? ' mount' : ' mounts');
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
        try { navigator.clipboard.writeText(csv).then(() => toast('Copied ' + n + ' as CSV.'), fallback); } catch (_e) { fallback(); }
    });
    let framed = true;
    try { framed = window.self !== window.top; } catch (_e) { framed = true; }
    $('saveCsv').hidden = framed;
    $('saveCsv').addEventListener('click', () => {
        const blob = new Blob(['﻿' + toCsv(lastResults)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'db-mounts.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });

    /* ---------- start ---------- */

    if (!DATA || !Array.isArray(DATA.mounts)) {
        $('summary').textContent = 'The mount list did not load. Reload the page.';
        return;
    }
    const horse = DATA.mounts.filter((m) => m.rig === 'Horse').length;
    $('summary').textContent = fmt(DATA.mounts.length) + ' mounts in the game · ' + horse + ' on the horse rig, ' + (DATA.mounts.length - horse) + ' on the dire rig';
    $('dataNote').textContent = fmt(DATA.mounts.filter(sold).length) + ' of ' + fmt(DATA.mounts.length) + ' are sold for idols.';
    $('q').value = state.q;
    render();
})();
