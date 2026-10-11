#!/usr/bin/env node
'use strict';
/**
 * Packs index.html, its CSS, fonts, scripts and data into one self-contained page:
 *   dist/gear-library.html   (full document, opens from disk or any static host)
 *   dist/artifact.html       (same without the html/head/body wrapper, for a claude.ai preview)
 * Run: node tools/build-single.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let css = read('app/gearlib.css').replace(/url\("fonts\/([^"]+)"\)/g, (_m, f) =>
    'url("data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'app/fonts', f)).toString('base64') + '")');

const html = read('index.html');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
const inlineScripts = scripts.map((src) => '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n');

const title = /<title>[^<]*<\/title>/.exec(html)[0];
const body = /<body>([\s\S]*?)<script/.exec(html)[1].trim();

const page = title + '\n<style>\n' + css + '\n</style>\n' + body + '\n' + inlineScripts + '\n';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), page);
const full = html
    .replace(/<link rel="stylesheet" href="app\/gearlib.css">/, '<style>\n' + css + '\n</style>')
    .replace(/(<script src="[^"]+"><\/script>\s*)+/, inlineScripts + '\n');
fs.writeFileSync(path.join(root, 'dist/gear-library.html'), full);
console.log('dist/gear-library.html %d kB, dist/artifact.html %d kB', Math.round(full.length / 1024), Math.round(page.length / 1024));
