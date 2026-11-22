// Fitted models for radar-fit-2. Everything in this file is deterministic
// arithmetic on the sealed snapshot: fixed iteration counts, no randomness,
// no stored coefficients. Both models are fitted at run time inside main.ts
// and both are scored out of sample by leave-one-out cross-validation, with
// the scores published in model-fit.json, METHOD.md and the dashboard.
//
// Value model: ordinary least squares of log market cap on log TVL over the
// traded peers that carry a market cap, plus a per-category log offset (the
// mean residual of the category's peers, shrunk toward zero with 20 phantom
// peers). Growth and age terms were tested in this regression and rejected:
// they raise the leave-one-out error, so they are not carried here. They are
// carried by the odds model, where they win clearly.
//
// Odds model: logistic regression (IRLS) of "records a token" on standardised
// log TVL, age and seven-day growth over all snapshot protocols, plus a
// per-category logit offset (the category launch rate, shrunk toward the
// base rate with 10 phantom protocols). Scored by leave-one-out Brier score
// against the leave-one-out base rate.

import type { SnapshotProtocol } from './snapshot.ts';
import { recordsToken } from './universe.ts';

export const GROWTH_MIN_PCT = -60;
export const GROWTH_MAX_PCT = 120;
export const VALUE_CAT_SHRINK = 20;
export const ODDS_CAT_SHRINK = 10;
export const ODDS_AGE_CAP_DAYS = 1825;
export const VALUE_AGE_CAP_DAYS = 1095;

export const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
export const growthFrac = (p: SnapshotProtocol): number =>
  clampNum(p.change_7d ?? 0, GROWTH_MIN_PCT, GROWTH_MAX_PCT) / 100;
export const sigmoid = (eta: number): number => 1 / (1 + Math.exp(-clampNum(eta, -30, 30)));

const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v * b[i], 0);

// Gaussian elimination with partial pivoting; returns null on a singular system.
function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  return solve(XtX, Xty);
}

// IRLS logistic regression with a fixed iteration cap and a small ridge on the
// slopes for stability. Deterministic: same input, same coefficients.
function logitFit(X: number[][], y: number[], iters = 50): number[] | null {
  const k = X[0].length;
  let beta = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(dot(X[i], beta));
      const w = Math.max(p * (1 - p), 1e-9);
      for (let a = 0; a < k; a++) {
        g[a] += X[i][a] * (y[i] - p);
        for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    for (let a = 1; a < k; a++) H[a][a] += 1e-4;
    const step = solve(H, g);
    if (!step) return beta;
    beta = beta.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return beta;
}

const median = (vals: number[]): number => {
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface LogErrorStats { rmse: number; mae: number; mdae: number }
function logErrorStats(errs: number[]): LogErrorStats {
  const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return { rmse, mae, mdae: abs[abs.length >> 1] };
}

const catKey = (p: SnapshotProtocol): string => p.category ?? '';

export interface ValueFit {
  peers: number;
  intercept: number;
  size_coef: number;
  category_offset: Map<string, number>;
  category_peer_count: Map<string, number>;
  loo: LogErrorStats;
  loo_size_only: LogErrorStats;
  loo_full_terms: LogErrorStats;
  flat_loo: LogErrorStats;
  flat_multiple: number;
}

const valueRow = (p: SnapshotProtocol): number[] => [1, Math.log(p.tvl_usd)];
const valueFullRow = (p: SnapshotProtocol, age: number | null): number[] => [
  1,
  Math.log(p.tvl_usd),
  growthFrac(p),
  Math.min(age ?? 365, VALUE_AGE_CAP_DAYS) / 365,
];

function shrunkResidualOffsets(
  idxs: number[],
  peers: SnapshotProtocol[],
  peerAges: (number | null)[],
  y: number[],
  rowOf: (p: SnapshotProtocol, age: number | null) => number[],
  beta: number[],
  shrink: number,
): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>();
  for (const j of idxs) {
    const r = y[j] - dot(rowOf(peers[j], peerAges[j]), beta);
    const key = catKey(peers[j]);
    const e = acc.get(key) ?? { s: 0, n: 0 };
    e.s += r; e.n++;
    acc.set(key, e);
  }
  return new Map([...acc].map(([c, e]) => [c, e.s / (e.n + shrink)]));
}

export function fitValueModel(records: SnapshotProtocol[], ages: (number | null)[]): ValueFit {
  // Peers are the traded protocols that carry a market cap: the same set the
  // first model drew its multiples from (a market cap implies a token record).
  const peerIdx = records
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => recordsToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0)
    .map(({ i }) => i);
  const peers = peerIdx.map((i) => records[i]);
  const peerAges = peerIdx.map((i) => ages[i]);
  const y = peers.map((p) => Math.log(p.mcap_usd as number));

  const beta = ols(peers.map(valueRow), y);
  if (!beta) throw new Error('value fit failed: singular design');
  const category_offset = shrunkResidualOffsets(
    peers.map((_, j) => j), peers, peerAges, y, (p) => valueRow(p), beta, VALUE_CAT_SHRINK,
  );

  // Leave-one-out for the shipped form, the size-only form and the full-terms
  // form (growth and age included), each with its own refitted offsets.
  const looRun = (rowOf: (p: SnapshotProtocol, age: number | null) => number[], useCat: boolean): LogErrorStats => {
    const errs: number[] = [];
    for (let i = 0; i < peers.length; i++) {
      const idxs = peers.map((_, j) => j).filter((j) => j !== i);
      const b = ols(idxs.map((j) => rowOf(peers[j], peerAges[j])), idxs.map((j) => y[j]));
      if (!b) throw new Error('value LOO fit failed');
      let pred = dot(rowOf(peers[i], peerAges[i]), b);
      if (useCat) {
        const off = shrunkResidualOffsets(idxs, peers, peerAges, y, rowOf, b, VALUE_CAT_SHRINK);
        pred += off.get(catKey(peers[i])) ?? 0;
      }
      errs.push(y[i] - pred);
    }
    return logErrorStats(errs);
  };
  const loo = looRun((p) => valueRow(p), true);
  const loo_size_only = looRun((p) => valueRow(p), false);
  const loo_full_terms = looRun((p, a) => valueFullRow(p, a), true);

  // Flat baseline: one global median multiple, leave-one-out.
  const ratios = peers.map((p) => clampNum((p.mcap_usd as number) / p.tvl_usd, 0.01, 2));
  const flatErrs = peers.map((p, i) => {
    const rest = ratios.filter((_, j) => j !== i);
    return Math.log(p.mcap_usd as number) - Math.log(median(rest) * p.tvl_usd);
  });

  const category_peer_count = new Map<string, number>();
  for (const p of peers) category_peer_count.set(catKey(p), (category_peer_count.get(catKey(p)) ?? 0) + 1);
  return {
    peers: peers.length,
    intercept: beta[0],
    size_coef: beta[1],
    category_offset,
    category_peer_count,
    loo,
    loo_size_only,
    loo_full_terms,
    flat_loo: logErrorStats(flatErrs),
    flat_multiple: median(ratios),
  };
}

export interface ZScore { mean: number; sd: number }
const zscore = (vals: number[]): ZScore => {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  return { mean, sd };
};

export interface OddsFit {
  population: number;
  launched: number;
  base_rate: number;
  intercept: number;
  size_coef: number;
  age_coef: number;
  growth_coef: number;
  z_log_tvl: ZScore;
  z_age_years: ZScore;
  z_growth: ZScore;
  category_offset: Map<string, number>;
  category_count: Map<string, number>;
  category_launched: Map<string, number>;
  loo_brier: number;
  loo_brier_no_category: number;
  base_loo_brier: number;
}

export function fitOddsModel(records: SnapshotProtocol[], ages: (number | null)[]): OddsFit {
  const launched = records.map(recordsToken);
  const n = records.length;
  const y = launched.map((v) => (v ? 1 : 0));
  const launchedCount = y.reduce((a, b) => a + b, 0);
  const base_rate = launchedCount / n;
  const baseLogit = Math.log(base_rate / (1 - base_rate));

  const logTvl = records.map((p) => Math.log(p.tvl_usd));
  const ageYears = ages.map((a) => Math.min(a ?? 365, ODDS_AGE_CAP_DAYS) / 365);
  const growth = records.map(growthFrac);
  const z_log_tvl = zscore(logTvl);
  const z_age_years = zscore(ageYears);
  const z_growth = zscore(growth);
  const rowOf = (i: number): number[] => [
    1,
    (logTvl[i] - z_log_tvl.mean) / z_log_tvl.sd,
    (ageYears[i] - z_age_years.mean) / z_age_years.sd,
    (growth[i] - z_growth.mean) / z_growth.sd,
  ];

  const catOffsetsOn = (idxs: number[]): Map<string, number> => {
    const cnt = new Map<string, number>();
    const hit = new Map<string, number>();
    for (const i of idxs) {
      const key = catKey(records[i]);
      cnt.set(key, (cnt.get(key) ?? 0) + 1);
      hit.set(key, (hit.get(key) ?? 0) + y[i]);
    }
    return new Map([...cnt].map(([c, count]) => {
      const p = ((hit.get(c) ?? 0) + ODDS_CAT_SHRINK * base_rate) / (count + ODDS_CAT_SHRINK);
      return [c, Math.log(p / (1 - p)) - baseLogit] as [string, number];
    }));
  };

  const beta = logitFit(records.map((_, i) => rowOf(i)), y);
  if (!beta) throw new Error('odds fit failed');
  const category_offset = catOffsetsOn(records.map((_, i) => i));
  const category_count = new Map<string, number>();
  const category_launched = new Map<string, number>();
  records.forEach((p, i) => {
    const key = catKey(p);
    category_count.set(key, (category_count.get(key) ?? 0) + 1);
    category_launched.set(key, (category_launched.get(key) ?? 0) + y[i]);
  });

  // Leave-one-out Brier scores. The standardisation constants are population
  // statistics of the sealed snapshot and are held fixed across folds; the
  // coefficients and the category offsets are refitted on every fold.
  let brier = 0;
  let brierNoCat = 0;
  let baseBrier = 0;
  for (let i = 0; i < n; i++) {
    const idxs = records.map((_, j) => j).filter((j) => j !== i);
    const b = logitFit(idxs.map((j) => rowOf(j)), idxs.map((j) => y[j]));
    if (!b) throw new Error('odds LOO fit failed');
    const eta = dot(rowOf(i), b);
    const off = catOffsetsOn(idxs).get(catKey(records[i])) ?? 0;
    brier += (sigmoid(eta + off) - y[i]) ** 2;
    brierNoCat += (sigmoid(eta) - y[i]) ** 2;
    const restRate = idxs.reduce((s, j) => s + y[j], 0) / idxs.length;
    baseBrier += (restRate - y[i]) ** 2;
  }

  return {
    population: n,
    launched: launchedCount,
    base_rate,
    intercept: beta[0],
    size_coef: beta[1],
    age_coef: beta[2],
    growth_coef: beta[3],
    z_log_tvl,
    z_age_years,
    z_growth,
    category_offset,
    category_count,
    category_launched,
    loo_brier: brier / n,
    loo_brier_no_category: brierNoCat / n,
    base_loo_brier: baseBrier / n,
  };
}
