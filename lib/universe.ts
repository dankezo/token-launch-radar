// The radar universe: which protocols are launch candidates at all.
//
// A protocol is a launch candidate when the snapshot records no token for it and it is
// not a wrapped, staked or bridged product of a protocol whose token already trades.
// That is the house watchlist's own screen (input/README.md), applied here to the whole
// snapshot instead of only above the $50,000,000 floor: the watchlist is the floor,
// never the ceiling, and the radar exists to find the candidates below it too.
//
// On this snapshot the screen yields 198 protocols: all 40 watchlist slugs, 60 at or
// above the floor in total, and 138 below it. Every exclusion is recorded with its
// reason, so the typed output can show exactly why any protocol is off the board.

import type { SnapshotProtocol } from './snapshot.ts';

/** Whether the snapshot records a token for the protocol (any of the three fields set). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name, any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are wrapped, staked or bridged products by construction. */
const PRODUCT_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a product name must not begin with (the house watchlist's list). */
const EXCHANGE_PREFIXES: readonly string[] = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a protocol is off the board, or an empty array when it is a launch candidate. */
export function exclusionReasons(p: SnapshotProtocol): string[] {
  if (recordsToken(p)) return ['records a token'];
  const reasons: string[] = [];
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) reasons.push(`category ${p.category} is a wrapped, staked or bridged product`);
  if (WRAPPED_WORD.test(p.name)) reasons.push('name carries a whole word wrapped, staked or staking');
  if (EXCHANGE_PREFIXES.some((e) => p.name === e || p.name.startsWith(`${e} `) || p.name.startsWith(`${e}-`))) {
    reasons.push("name begins with an exchange's name");
  }
  if (VERSIONED.test(p.name)) reasons.push('name ends in a version marker');
  return reasons;
}

/** Whether the protocol belongs on the radar. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return exclusionReasons(p).length === 0;
}

/** One protocol with its derived status, for the typed output. */
export interface TypedProtocol extends SnapshotProtocol {
  token_status: 'tokenised' | 'pre-token';
  age_days: number | null;
  candidate: boolean;
  exclusion_reasons: string[];
  on_watchlist: boolean;
}
