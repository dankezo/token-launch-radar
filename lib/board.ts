// Board assembly and the gate self-check.
//
// The board ranks every launch candidate in the radar universe (lib/universe.ts) by
// expected value: the fitted launch value times the fitted launch odds (lib/model.ts),
// strongest first, ties broken by TVL then slug so two runs write the same bytes.
// boardIssue replays the gate's board rules (SPEC.md) over the result: coverage of
// the snapshot's watchlist, ranks exactly 1 to N, implied value never rising as rank
// ascends, farm steps within their count and length, and the shown working on every
// row recomputing to that row's figures.

import type { Snapshot, SnapshotProtocol } from './snapshot.ts';
import { ageDays } from './snapshot.ts';
import { isCandidate } from './universe.ts';
import type { OddsFit, ValueFit } from './fit.ts';
import { round6, sigmoid } from './fit.ts';
import { price, type OddsLogitParts, type PricedParts, type ValueLogParts } from './model.ts';
import { farmPlan } from './farm.ts';

/** One row of board.json: the gate's fields plus both models' shown working. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  value_log_parts: ValueLogParts;
  fitted_value_usd: number;
  logit_parts: OddsLogitParts;
  launch_odds: number;
  implied_value_usd: number;
  farm_gas_usd: number;
  farm_minutes: number;
  farm_steps: string[];
}

/** Rank every candidate in the universe by expected value. */
export function buildBoard(snapshot: Snapshot, vf: ValueFit, of: OddsFit): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const priced: { p: SnapshotProtocol; age: number | null; parts: PricedParts }[] = [];
  for (const p of snapshot.protocols) {
    if (!isCandidate(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    priced.push({ p, age, parts: price(p, age, vf, of) });
  }
  priced.sort(
    (a, b) =>
      b.parts.expected_value_usd - a.parts.expected_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return priced.map(({ p, age, parts }, i) => {
    const plan = farmPlan(p, age, parts.expected_value_usd, parts.launch_odds);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      on_watchlist: watch.has(p.slug),
      value_log_parts: parts.value_log_parts,
      fitted_value_usd: parts.fitted_value_usd,
      logit_parts: parts.logit_parts,
      launch_odds: parts.launch_odds,
      implied_value_usd: parts.expected_value_usd,
      farm_gas_usd: plan.gas_usd,
      farm_minutes: plan.minutes,
      farm_steps: plan.steps,
    };
  });
}

/** Why a board is not one the gate will take, or null when it passes the board rules. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board more than once';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    // The shown working must recompute to the row's figures.
    const logSum = r.value_log_parts.intercept + r.value_log_parts.size + r.value_log_parts.category;
    if (Math.round(Math.exp(logSum)) !== r.fitted_value_usd) return `${r.slug} value working does not recompute`;
    const logitSum = r.logit_parts.intercept + r.logit_parts.size + r.logit_parts.age + r.logit_parts.growth + r.logit_parts.category;
    if (round6(sigmoid(logitSum)) !== r.launch_odds) return `${r.slug} odds working does not recompute`;
    if (Math.round(r.fitted_value_usd * r.launch_odds) !== r.implied_value_usd) return `${r.slug} expected value does not recompute`;
    if (!(r.launch_odds > 0 && r.launch_odds < 1)) return `${r.slug} has launch odds ${r.launch_odds}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}
