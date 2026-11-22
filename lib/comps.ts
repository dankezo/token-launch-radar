// Category comparables: what a dollar of TVL is worth in each category, from the
// snapshot's own tokenised protocols.
//
// A peer is a protocol that records a token and carries both a market cap and a TVL.
// Its ratio is mcap / TVL (the snapshot carries market cap, not a fully diluted
// figure, so the multiple is a market-cap multiple; METHOD.md states this plainly).
// Raw category medians are noisy here: 144 peers spread over some 50 categories, many
// with one or two members and ratios from 0.002 to over 400. Two guards keep the
// multiples defensible:
//   - clamp: every peer ratio is clamped into [RATIO_MIN, RATIO_MAX] before any
//     median is taken, so one mispriced or eccentric peer cannot set a category.
//   - shrinkage: a category's multiple is its clamped median blended with the global
//     clamped median, weighted by peer count against SHRINK_K phantom global peers.
//     A category with many peers mostly speaks for itself; a thin one mostly inherits
//     the market-wide figure. A category with no peers uses the global multiple.
//   - band: no category multiple may sit above BAND_HI times or below BAND_LO times
//     the global median, so a single eccentric peer in a one-member category cannot
//     price a whole sector at several times the market-wide rate.

import type { SnapshotProtocol } from './snapshot.ts';
import { recordsToken } from './universe.ts';

/** Peer ratios are clamped into this band before any median is taken. */
export const RATIO_MIN = 0.01;
export const RATIO_MAX = 2.0;

/** Phantom global peers in the shrinkage blend: a category median counts n/(n+K). */
export const SHRINK_K = 10;

/** A category multiple is banded into [BAND_LO, BAND_HI] times the global median. */
export const BAND_LO = 0.25;
export const BAND_HI = 2.0;

/** The comparables table for one category (category null is its own row). */
export interface CategoryMultiple {
  category: string | null;
  peer_count: number;
  median_ratio: number | null;
  multiple: number;
}

/** The comparables output: the global figure plus one row per category. */
export interface CompsTable {
  global_peer_count: number;
  global_median_ratio: number;
  categories: CategoryMultiple[];
  byCategory: Map<string | null, CategoryMultiple>;
}

const clampRatio = (r: number): number => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Build the comparables table from the snapshot's protocols. */
export function buildComps(protocols: SnapshotProtocol[]): CompsTable {
  const peers = protocols.filter((p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMedian = median(peers.map((p) => clampRatio(p.mcap_usd! / p.tvl_usd)));
  const ratiosByCategory = new Map<string | null, number[]>();
  for (const p of peers) {
    const list = ratiosByCategory.get(p.category) ?? [];
    list.push(clampRatio(p.mcap_usd! / p.tvl_usd));
    ratiosByCategory.set(p.category, list);
  }
  const categories: CategoryMultiple[] = [];
  const byCategory = new Map<string | null, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const blended = (ratios.length * med + SHRINK_K * globalMedian) / (ratios.length + SHRINK_K);
    const multiple = Math.min(BAND_HI * globalMedian, Math.max(BAND_LO * globalMedian, blended));
    const row: CategoryMultiple = { category, peer_count: ratios.length, median_ratio: med, multiple };
    categories.push(row);
    byCategory.set(category, row);
  }
  categories.sort((a, b) => String(a.category) < String(b.category) ? -1 : String(a.category) > String(b.category) ? 1 : 0);
  return { global_peer_count: peers.length, global_median_ratio: globalMedian, categories, byCategory };
}

/** The multiple a protocol is priced with: its category's, or the global one. */
export function multipleFor(comps: CompsTable, category: string | null): number {
  return comps.byCategory.get(category)?.multiple ?? comps.global_median_ratio;
}
