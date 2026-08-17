/* Verifies the Glicko-2 code that actually ships in template.html.
 *
 *   1. lifts the rating block straight out of the template and runs it
 *   2. checks it against the worked example in Glickman's 2013 paper
 *   3. re-implements the maths independently and diffs the two
 *
 * Run after touching anything rating-related:  node analysis-src/glicko-check.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SCALE = 173.7178, TAU = 0.5, EPS = 1e-6, RD0 = 350, SIG0 = 0.06;

/* ---- 1. lift the shipped implementation out of the template ---- */
const tpl = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
const start = tpl.indexOf('/* ---------- Glicko-2 ----------');
const end = tpl.indexOf('const pct = v =>');
if (start < 0 || end < 0 || end <= start) {
  console.error('could not locate the Glicko-2 block in template.html');
  process.exit(1);
}
const shippedSrc = tpl.slice(start, end);
const load = new Function('SESSIONS', shippedSrc + '\nreturn { ratings, winProb, GL, glickoStep, gExp };');

/* ---- 2. Glickman's worked example (one-on-one) ---- */
{
  const api = load([]);
  const me = { mu: 0, phi: 200 / SCALE, sigma: 0.06 };
  const res = [{ r: 1400, rd: 30, s: 1 }, { r: 1550, rd: 100, s: 0 }, { r: 1700, rd: 300, s: 0 }]
    .map(o => {
      const muOpp = (o.r - 1500) / SCALE, phiOpp = o.rd / SCALE;
      return { muOpp, phiOpp, s: o.s, E: api.gExp(me.mu, muOpp, phiOpp) };
    });
  const out = api.glickoStep(me, res);
  const r = SCALE * out.mu + 1500, rd = SCALE * out.phi;
  const ok = Math.abs(r - 1464.06) < 0.02 && Math.abs(rd - 151.52) < 0.02
          && Math.abs(out.sigma - 0.05999) < 0.00002;
  console.log(`Glickman worked example: r=${r.toFixed(2)} (want 1464.06)  ` +
              `RD=${rd.toFixed(2)} (want 151.52)  vol=${out.sigma.toFixed(5)} (want 0.05999)`);
  if (!ok) { console.error('FAIL: shipped implementation disagrees with the paper'); process.exit(1); }
  console.log('  -> PASS\n');
}

/* ---- 3. independent re-implementation ---- */
const g = phi => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
const E = (mu, muO, phiO) => 1 / (1 + Math.exp(-g(phiO) * (mu - muO)));

function step(pl, res) {
  if (!res.length) return { mu: pl.mu, phi: Math.hypot(pl.phi, pl.sigma), sigma: pl.sigma };
  let vInv = 0, dSum = 0;
  for (const r of res) {
    const gj = g(r.phiOpp);
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

function independent(sessions) {
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
        res[me].push({ muOpp, phiOpp, s: sc, E: E((st[me].mu + st[mate].mu) / 2, muOpp, phiOpp) });
      });
    }));
    const next = {};
    roster.forEach(n => (next[n] = step(st[n], res[n])));
    roster.forEach(n => (st[n] = next[n]));
  });
  return Object.fromEntries(roster.map(n =>
    [n, { r: SCALE * st[n].mu + 1500, rd: SCALE * st[n].phi, sigma: st[n].sigma }]));
}

/* ---- 4. diff the two over the real payload ---- */
const payload = JSON.parse(fs.readFileSync(path.join(DIR, 'payload.json'), 'utf8'));
const shipped = load(payload.sessions).ratings();
const mine = independent(payload.sessions);

console.log('player     rating   RD   volatility   games   95% range');
let worst = 0;
for (const p of shipped.table) {
  const m = mine[p.name];
  worst = Math.max(worst, Math.abs(p.r - m.r), Math.abs(p.rd - m.rd), Math.abs(p.sigma - m.sigma) * 1e4);
  console.log(`${p.name.padEnd(9)} ${Math.round(p.r).toString().padStart(5)}  ${Math.round(p.rd).toString().padStart(4)}` +
              `   ${p.sigma.toFixed(5)}     ${String(p.games).padStart(3)}    ` +
              `${Math.round(p.r - 1.96 * p.rd)}–${Math.round(p.r + 1.96 * p.rd)}`);
}
console.log(`\nlargest disagreement between shipped and independent: ${worst.toExponential(2)}`);
if (worst > 1e-6) { console.error('FAIL: implementations disagree'); process.exit(1); }
console.log('-> PASS: shipped template matches an independent implementation');
