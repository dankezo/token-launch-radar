// radar-fit-2 pricing. Two fitted models, both fitted at run time on the
// sealed snapshot (lib/fit.ts), price every candidate:
//
//   fitted launch value = exp(intercept + size_coef x ln TVL + category offset)
//   launch odds         = sigmoid(intercept + size x z(ln TVL) + age x z(age)
//                                 + growth x z(growth) + category offset)
//   expected value      = fitted launch value x launch odds
//
// board.json's implied_value_usd is the expected value: the ranking itself
// prices launch risk, so a large protocol that rarely launches ranks below a
// smaller one that usually does. METHOD.md is the full statement, with the
// leave-one-out evidence for both models.
//
// The printed working recomputes exactly. Every log and logit contribution is
// rounded to six decimals before it is stored on the row; the fitted value is
// the rounded exponential of the sum of the stored log parts, the odds are
// the rounded sigmoid of the sum of the stored logit parts, and the expected
// value is the rounded product of the two stored figures. The dashboard
// detail view replays exactly these sums.

import type { SnapshotProtocol } from './snapshot.ts';
import { growthFrac, round6, sigmoid, ODDS_AGE_CAP_DAYS, type OddsFit, type ValueFit } from './fit.ts';

/** The model's name, stated in the outputs and the dashboard. */
export const MODEL_VERSION = 'radar-fit-2';

/** The age an unlisted protocol is priced with. */
export const UNKNOWN_AGE_DAYS = 365;

/** One protocol's fitted launch value, as the sum of its log parts. */
export interface ValueLogParts {
  intercept: number;
  size: number;
  category: number;
}

/** One protocol's fitted launch odds, as the sum of its logit parts. */
export interface OddsLogitParts {
  intercept: number;
  size: number;
  age: number;
  growth: number;
  category: number;
}

/** One protocol's priced parts: both models' shown working and the results. */
export interface PricedParts {
  value_log_parts: ValueLogParts;
  fitted_value_usd: number;
  logit_parts: OddsLogitParts;
  launch_odds: number;
  expected_value_usd: number;
}

/** Price one protocol with the two fitted models. */
export function price(p: SnapshotProtocol, age: number | null, vf: ValueFit, of: OddsFit): PricedParts {
  const value_log_parts: ValueLogParts = {
    intercept: round6(vf.intercept),
    size: round6(vf.size_coef * Math.log(p.tvl_usd)),
    category: round6(vf.category_offset.get(p.category ?? '') ?? 0),
  };
  const logSum = value_log_parts.intercept + value_log_parts.size + value_log_parts.category;
  const fitted_value_usd = Math.round(Math.exp(logSum));

  const ageYears = Math.min(age ?? UNKNOWN_AGE_DAYS, ODDS_AGE_CAP_DAYS) / 365;
  const logit_parts: OddsLogitParts = {
    intercept: round6(of.intercept),
    size: round6(of.size_coef * ((Math.log(p.tvl_usd) - of.z_log_tvl.mean) / of.z_log_tvl.sd)),
    age: round6(of.age_coef * ((ageYears - of.z_age_years.mean) / of.z_age_years.sd)),
    growth: round6(of.growth_coef * ((growthFrac(p) - of.z_growth.mean) / of.z_growth.sd)),
    category: round6(of.category_offset.get(p.category ?? '') ?? 0),
  };
  const logitSum = logit_parts.intercept + logit_parts.size + logit_parts.age + logit_parts.growth + logit_parts.category;
  const launch_odds = round6(sigmoid(logitSum));
  const expected_value_usd = Math.round(fitted_value_usd * launch_odds);

  return { value_log_parts, fitted_value_usd, logit_parts, launch_odds, expected_value_usd };
}
