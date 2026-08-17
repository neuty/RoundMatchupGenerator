/* Verifies the rating code that actually ships in template.html.
 *
 * Chain of trust, for each of the two models:
 *   1. an independent implementation here is checked against published vectors
 *   2. the block lifted out of the template is diffed against that implementation
 *
 * Run after touching anything rating-related:  node analysis-src/ratings-check.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
let failed = false;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
};

/* ---------- lift the shipped implementations out of the template ---------- */
const tpl = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
const from = tpl.indexOf('/* ---------- Glicko-2 ----------');
const to = tpl.indexOf('const pct = v =>');
if (from < 0 || to < 0 || to <= from) {
  console.error('could not locate the rating blocks in template.html');
  process.exit(1);
}
const shippedSrc = tpl.slice(from, to);
const load = new Function('SESSIONS', shippedSrc +
  '\nreturn { glickoRatings, skillRatings, glickoStep, gExp, tsMatch, TS, tsR, tsS, nCdf };');

const payload = JSON.parse(fs.readFileSync(path.join(DIR, 'payload.json'), 'utf8'));
const api = load(payload.sessions);

/* ================= Glicko-2 ================= */
console.log('\nGlicko-2');
const SCALE = 173.7178, TAU = 0.5, EPS = 1e-6, RD0 = 350, SIG0 = 0.06;
const gg = phi => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
const gE = (mu, muO, phiO) => 1 / (1 + Math.exp(-gg(phiO) * (mu - muO)));

function gStep(pl, res) {
  if (!res.length) return { mu: pl.mu, phi: Math.hypot(pl.phi, pl.sigma), sigma: pl.sigma };
  let vInv = 0, dSum = 0;
  for (const r of res) {
    const gj = gg(r.phiOpp);
    vInv += gj * gj * r.E * (1 - r.E);
    dSum += gj * (r.s - r.E);
  }
  const v = 1 / vInv, delta = v * dSum, phi = pl.phi, a = Math.log(pl.sigma ** 2);
  const f = x => {
    const ex = Math.exp(x);
    return (ex * (delta ** 2 - phi ** 2 - v - ex)) / (2 * (phi ** 2 + v + ex) ** 2) - (x - a) / TAU ** 2;
  };
  let A = a, B;
  if (delta ** 2 > phi ** 2 + v) B = Math.log(delta ** 2 - phi ** 2 - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigma = Math.exp(A / 2);
  const phiNew = 1 / Math.sqrt(1 / (phi ** 2 + sigma ** 2) + 1 / v);
  return { mu: pl.mu + phiNew ** 2 * dSum, phi: phiNew, sigma };
}

{ // Glickman, "Example of the Glicko-2 system" (2013)
  const me = { mu: 0, phi: 200 / SCALE, sigma: 0.06 };
  const res = [{ r: 1400, rd: 30, s: 1 }, { r: 1550, rd: 100, s: 0 }, { r: 1700, rd: 300, s: 0 }]
    .map(o => {
      const muOpp = (o.r - 1500) / SCALE, phiOpp = o.rd / SCALE;
      return { muOpp, phiOpp, s: o.s, E: gE(me.mu, muOpp, phiOpp) };
    });
  const mine = gStep(me, res);
  const theirs = api.glickoStep(me, res.map(r => ({ ...r, E: api.gExp(me.mu, r.muOpp, r.phiOpp) })));
  const r = SCALE * theirs.mu + 1500, rd = SCALE * theirs.phi;
  check('shipped matches the paper (r 1464.06, RD 151.52, vol 0.05999)',
    Math.abs(r - 1464.06) < 0.02 && Math.abs(rd - 151.52) < 0.02 && Math.abs(theirs.sigma - 0.05999) < 2e-5,
    `got r=${r.toFixed(2)} RD=${rd.toFixed(2)} vol=${theirs.sigma.toFixed(5)}`);
  check('independent matches the paper',
    Math.abs(SCALE * mine.mu + 1500 - 1464.06) < 0.02);
}

function glickoIndependent(sessions) {
  const rated = sessions.filter(s => s.rounds);
  const roster = [...new Set(rated.flatMap(s => s.rounds.flatMap(r => [...r.t1, ...r.t2])))];
  const st = {};
  roster.forEach(n => (st[n] = { mu: 0, phi: RD0 / SCALE, sigma: SIG0 }));
  rated.forEach(s => {
    const res = {};
    roster.forEach(n => (res[n] = []));
    s.rounds.forEach(r => [0, 1].forEach(side => {
      const mine = side ? r.t2 : r.t1, theirs = side ? r.t1 : r.t2;
      const my = side ? r.s2 : r.s1, their = side ? r.s1 : r.s2;
      const sc = my > their ? 1 : my < their ? 0 : 0.5;
      mine.forEach(me => {
        const mate = mine.find(x => x !== me);
        const muOpp = (st[theirs[0]].mu + st[theirs[1]].mu) / 2;
        const phiOpp = Math.hypot(st[theirs[0]].phi, st[theirs[1]].phi) / 2;
        res[me].push({ muOpp, phiOpp, s: sc, E: gE((st[me].mu + st[mate].mu) / 2, muOpp, phiOpp) });
      });
    }));
    const next = {};
    roster.forEach(n => (next[n] = gStep(st[n], res[n])));
    roster.forEach(n => (st[n] = next[n]));
  });
  return Object.fromEntries(roster.map(n => [n, { sigma: st[n].sigma, r: SCALE * st[n].mu + 1500 }]));
}
{
  const mine = glickoIndependent(payload.sessions);
  const theirs = api.glickoRatings();
  let worst = 0;
  theirs.table.forEach(p => {
    worst = Math.max(worst, Math.abs(p.r - mine[p.name].r), Math.abs(p.sigma - mine[p.name].sigma) * 1e4);
  });
  check('shipped matches an independent implementation over the payload', worst < 1e-6,
    `max delta ${worst.toExponential(2)}`);
}

/* ================= TrueSkill ================= */
console.log('\nTrueSkill');
const MU0 = 25, TSIG0 = 25 / 3, BETA = 25 / 6, TTAU = 25 / 300;
const npdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function nerfc(x) {
  const z = Math.abs(x), t = 2 / (2 + z), ty = 4 * t - 2;
  const cof = [-1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5,
    -2.0278578112534e-5, -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8,
    -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
    9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15];
  let d = 0, dd = 0;
  for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}
const ncdf = x => 0.5 * nerfc(-x / Math.SQRT2);
function invCdf(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
// Independent version, with draw support so it can be checked against the
// published vectors (which assume a 10% draw probability).
function tsUpdate(winners, losers, drawProb, mult) {
  const all = winners.concat(losers), n = all.length;
  const c2 = all.reduce((a, p) => a + p.sigma ** 2, 0) + n * BETA ** 2;
  const c = Math.sqrt(c2);
  const t = (winners.reduce((a, p) => a + p.mu, 0) - losers.reduce((a, p) => a + p.mu, 0)) / c;
  const eps = drawProb > 0 ? (invCdf((drawProb + 1) / 2) * Math.sqrt(n) * BETA) / c : 0;
  const d = t - eps, den = ncdf(d);
  const v = den < 1e-10 ? -d : npdf(d) / den;
  const w = den < 1e-10 ? (d < 0 ? 1 : 0) : Math.min(1, Math.max(0, v * (v + d)));
  const m = mult === undefined ? 1 : mult;
  const shift = (p, dir) => ({
    mu: p.mu + dir * m * (p.sigma ** 2 / c) * v,
    sigma: p.sigma * Math.sqrt(Math.max(1e-6, 1 - (p.sigma ** 2 / c2) * w))
  });
  return winners.map(p => shift(p, 1)).concat(losers.map(p => shift(p, -1)));
}
{ // published reference results, default parameters, 10% draw probability
  const d = () => ({ mu: MU0, sigma: TSIG0 });
  const one = tsUpdate([d()], [d()], 0.1);
  check('independent 1v1 matches published (29.39583 / 7.17148)',
    Math.abs(one[0].mu - 29.39583) < 5e-4 && Math.abs(one[0].sigma - 7.171475) < 5e-4,
    `got ${one[0].mu.toFixed(5)} / ${one[0].sigma.toFixed(5)}`);
  const two = tsUpdate([d(), d()], [d(), d()], 0.1);
  check('independent 2v2 matches published (28.10796 / 7.77419)',
    Math.abs(two[0].mu - 28.10796) < 1e-3 && Math.abs(two[0].sigma - 7.77419) < 1e-3,
    `got ${two[0].mu.toFixed(5)} / ${two[0].sigma.toFixed(5)}`);
  // and the shipped tsMatch agrees with it when there are no draws
  const mineNoDraw = tsUpdate([d(), d()], [d(), d()], 0);
  const theirs = api.tsMatch([d(), d()], [d(), d()]);
  check('shipped tsMatch matches independent (no draws)',
    Math.abs(mineNoDraw[0].mu - theirs[0].mu) < 1e-12 && Math.abs(mineNoDraw[0].sigma - theirs[0].sigma) < 1e-12);
}

function tsIndependent(sessions) {
  const rated = sessions.filter(s => s.rounds);
  const all = rated.flatMap(s => s.rounds).filter(r => r.s1 !== r.s2);
  const meanLog = all.reduce((a, r) => a + Math.log(Math.abs(r.s1 - r.s2) + 1), 0) / all.length;
  const K = 350 / TSIG0;
  const roster = [...new Set(rated.flatMap(s => s.rounds.flatMap(r => [...r.t1, ...r.t2])))];
  const st = {};
  roster.forEach(n => (st[n] = { mu: MU0, sigma: TSIG0 }));
  rated.forEach(s => {
    roster.forEach(n => (st[n] = { mu: st[n].mu, sigma: Math.sqrt(st[n].sigma ** 2 + TTAU ** 2) }));
    s.rounds.forEach(r => {
      if (r.s1 === r.s2) return;
      const t1won = r.s1 > r.s2;
      const wn = t1won ? r.t1 : r.t2, ln = t1won ? r.t2 : r.t1;
      const edge = ((wn.reduce((a, n) => a + st[n].mu, 0) - ln.reduce((a, n) => a + st[n].mu, 0)) / 2) * K;
      const mult = (Math.log(Math.abs(r.s1 - r.s2) + 1) / meanLog) * (2.2 / (2.2 + 0.001 * edge));
      const res = tsUpdate(wn.map(n => st[n]), ln.map(n => st[n]), 0, mult);
      wn.forEach((n, i) => (st[n] = res[i]));
      ln.forEach((n, i) => (st[n] = res[wn.length + i]));
    });
  });
  return Object.fromEntries(roster.map(n =>
    [n, { r: 1500 + (st[n].mu - MU0) * K, sd: st[n].sigma * K }]));
}
{
  const mine = tsIndependent(payload.sessions);
  const theirs = api.skillRatings();
  let worst = 0;
  theirs.table.forEach(p => {
    worst = Math.max(worst, Math.abs(p.r - mine[p.name].r), Math.abs(p.sd - mine[p.name].sd));
  });
  check('shipped matches an independent implementation over the payload', worst < 1e-9,
    `max delta ${worst.toExponential(2)}`);
}

/* ---------- the resulting table ---------- */
console.log('\nplayer     skill    sigma   95% range        games   volatility');
const vol = api.glickoRatings().table;
for (const p of api.skillRatings().table) {
  const v = vol.find(x => x.name === p.name);
  console.log(`${p.name.padEnd(9)} ${Math.round(p.r).toString().padStart(5)}    ${Math.round(p.sd).toString().padStart(4)}` +
    `   ${Math.round(p.r - 1.96 * p.sd)}–${Math.round(p.r + 1.96 * p.sd)}`.padEnd(16) +
    `   ${String(p.games).padStart(3)}     ${v ? v.sigma.toFixed(5) : '—'}`);
}

console.log(failed ? '\nFAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
