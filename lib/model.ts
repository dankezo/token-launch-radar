// The implied-value model, version radar-comps-1. METHOD.md is its full statement.
//
//   implied = multiple(category) x tvl_usd x scale x growth x maturity
//
//   multiple   the category's comparables multiple from lib/comps.ts (market cap per
//              dollar of TVL among tokenised peers, clamped and shrunk to the global)
//   scale      (tvl_usd / TVL_REF) ^ (ALPHA - 1) with ALPHA 0.85 and TVL_REF
//              $100,000,000: sublinear in TVL, so the tenth dollar of TVL is not
//              priced like the first and giant stale protocols do not run away
//   growth     1 + clamp(change_7d, -60, 120)/100 x 0.5, clamped to [0.70, 1.60];
//              an unreported change counts as no growth (factor 1)
//   maturity   0.85 + 0.30 x min(age_days, 1095)/1095: a protocol that has run for
//              years with no token has the scarcer, more proven claim; an unknown
//              age counts as 365 days
//
// Every input is a figure the snapshot itself carries, and no protocol name is ever
// special-cased: the same function prices every row, and each row carries its own
// arithmetic so the dashboard's detail view can show the working.

import type { SnapshotProtocol } from './snapshot.ts';
import { ageDays } from './snapshot.ts';

/** The model's name, stated in the outputs and the dashboard. */
export const MODEL_VERSION = 'radar-comps-1';

/** Sublinear TVL exponent: implied value grows with TVL^ALPHA, not TVL^1. */
export const ALPHA = 0.85;
/** The TVL at which the scale factor is exactly 1. */
export const TVL_REF = 100_000_000;
/** How much of a (clamped) seven-day TVL change passes into value. */
export const GROWTH_WEIGHT = 0.5;
export const GROWTH_FLOOR_PCT = -60;
export const GROWTH_CAP_PCT = 120;
export const GROWTH_FACTOR_MIN = 0.7;
export const GROWTH_FACTOR_MAX = 1.6;
/** The maturity factor's floor, its range, and the days over which it is earned. */
export const MATURITY_BASE = 0.85;
export const MATURITY_RANGE = 0.3;
export const MATURITY_DAYS = 1095;
/** The age an unlisted protocol is priced with. */
export const UNKNOWN_AGE_DAYS = 365;

/** One protocol's priced parts: the multiple and the three factors, for shown working. */
export interface PricedParts {
  multiple: number;
  scale_factor: number;
  growth_pct_used: number;
  growth_factor: number;
  age_days: number | null;
  maturity_factor: number;
  implied_value_usd: number;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Price one protocol. `multiple` comes from lib/comps.ts for its category. */
export function price(p: SnapshotProtocol, asOf: string, multipleIn: number): PricedParts {
  // The parts are rounded to 6 decimals first and the implied value is computed from
  // the rounded parts, so the working printed on a row recomputes to that row's
  // implied value exactly: the detail view's arithmetic is the board's arithmetic.
  const multiple = round6(multipleIn);
  const scale = round6(Math.pow(p.tvl_usd / TVL_REF, ALPHA - 1));
  const growthPct = p.change_7d === null ? 0 : Math.min(GROWTH_CAP_PCT, Math.max(GROWTH_FLOOR_PCT, p.change_7d));
  const growthFactor = round6(Math.min(GROWTH_FACTOR_MAX, Math.max(GROWTH_FACTOR_MIN, 1 + (growthPct / 100) * GROWTH_WEIGHT)));
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturity = round6(MATURITY_BASE + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE);
  const implied = Math.max(1, Math.round(multiple * p.tvl_usd * scale * growthFactor * maturity));
  return {
    multiple,
    scale_factor: scale,
    growth_pct_used: growthPct,
    growth_factor: growthFactor,
    age_days: age,
    maturity_factor: maturity,
    implied_value_usd: implied,
  };
}
