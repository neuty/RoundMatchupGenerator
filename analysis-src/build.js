const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PASS = 'secretanalysis';

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const payload = JSON.parse(fs.readFileSync(path.join(DIR, 'payload.json'), 'utf8'));
const plain = 'RMG1' + JSON.stringify(payload);
const bytes = new TextEncoder().encode(plain);
const rnd = mulberry32(fnv1a(PASS));
let hex = '';
for (const b of bytes) hex += ((b ^ Math.floor(rnd() * 256)) & 0xff).toString(16).padStart(2, '0');

// round-trip check
const rnd2 = mulberry32(fnv1a(PASS));
const out = new Uint8Array(hex.length / 2);
for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) ^ Math.floor(rnd2() * 256);
const back = new TextDecoder().decode(out);
if (back !== plain) { console.error('ROUND TRIP FAILED'); process.exit(1); }
JSON.parse(back.slice(4));

// wrong password must not yield the magic prefix
const rnd3 = mulberry32(fnv1a('wrongpassword'));
const bad = new Uint8Array(8);
for (let i = 0; i < 8; i++) bad[i] = parseInt(hex.substr(i * 2, 2), 16) ^ Math.floor(rnd3() * 256);
console.log('wrong-pass prefix rejected:', new TextDecoder().decode(bad).slice(0, 4) !== 'RMG1');

const tpl = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
if (!tpl.includes('__CIPHER__')) { console.error('no placeholder'); process.exit(1); }
const page = tpl.replace('__CIPHER__', hex);
fs.writeFileSync(path.join(DIR, 'session-analysis.html'), page);

// Standalone build: the artifact host injects doctype/head/reset, a plain file has none.
// This one is the published page, so it lands at the repo root where Pages serves it.
const body = page.replace(/^<title>.*?<\/title>\n/, '');
fs.writeFileSync(path.join(DIR, '..', 'analysis.html'),
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Session Analysis — Doubles Scorecards</title>
<style>
  body { margin: 0; }
  h1, h2, h3, p { margin: 0; }
</style>
</head>
<body>
${body}</body>
</html>
`);

// Guard: any player name reaching an output file would defeat the whole exercise.
const names = payload.sessions.flatMap(s => s.players.map(p => p.name));
const leaked = [...new Set(names)].filter(n =>
  [path.join(DIR, 'session-analysis.html'), path.join(DIR, '..', 'analysis.html')]
    .some(f => fs.readFileSync(f, 'utf8').includes(n)));
if (leaked.length) { console.error('PLAINTEXT NAME IN OUTPUT:', leaked); process.exit(1); }

console.log('plaintext bytes:', bytes.length, '| hex chars:', hex.length);
console.log('names leaked into output: none');
console.log('written: analysis.html (repo root), session-analysis.html (artifact source)');
