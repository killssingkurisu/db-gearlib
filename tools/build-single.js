#!/usr/bin/env node
'use strict';
/**
 * Packs each page with its CSS, fonts, scripts and data into one self-contained file:
 *   dist/gear-library.html   index.html, the Gears section (opens from disk or any static host)
 *   dist/mounts.html         mounts.html, the Mounts section (its pictures stay in mounts/, next to it)
 *   dist/artifact.html       the Gears page without the html/head/body wrapper, for a claude.ai preview
 * Run: node tools/build-single.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('app/gearlib.css').replace(/url\("fonts\/([^"]+)"\)/g, (_m, f) =>
    'url("data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'app/fonts', f)).toString('base64') + '")');

function pack(file) {
    const html = read(file);
    const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
    const inlineScripts = scripts.map((src) => '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n');
    const full = html
        .replace(/<link rel="stylesheet" href="app\/gearlib.css">/, () => '<style>\n' + css + '\n</style>')
        .replace(/(<script src="[^"]+"><\/script>\s*)+/, () => inlineScripts + '\n');
    const title = /<title>[^<]*<\/title>/.exec(html)[0];
    const body = /<body>([\s\S]*?)<script/.exec(html)[1].trim();
    return { full, fragment: title + '\n<style>\n' + css + '\n</style>\n' + body + '\n' + inlineScripts + '\n' };
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const gear = pack('index.html');
const mounts = pack('mounts.html');
fs.writeFileSync(path.join(root, 'dist/gear-library.html'), gear.full);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), gear.fragment);
fs.writeFileSync(path.join(root, 'dist/mounts.html'), mounts.full);
console.log('dist/gear-library.html %d kB, dist/mounts.html %d kB, dist/artifact.html %d kB',
    Math.round(gear.full.length / 1024), Math.round(mounts.full.length / 1024), Math.round(gear.fragment.length / 1024));
