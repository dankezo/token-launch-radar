// The sealed snapshot's shape and its parser.
//
// The snapshot is the frozen DefiLlama pull the house ships in the kit (input/README.md
// documents it): every protocol at or above $5,000,000 of TVL, ten fields each, plus the
// house watchlist of 40 slugs. The parser validates the shape the model relies on and
// refuses anything else, so a bad input fails loudly instead of scoring garbage.

/** One protocol record: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why a snapshot is not one this pipeline can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A finite number or null, from an unknown value. */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string or null, from an unknown value. */
function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The snapshot out of a file's text, validated field by field. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !DATE_SHAPE.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug === '' || typeof p.name !== 'string' || p.name === '') {
      throw new SnapshotError(`protocol ${i} lacks a slug or a name`);
    }
    if (seen.has(p.slug)) throw new SnapshotError(`protocol slug ${p.slug} appears twice`);
    seen.add(p.slug);
    const tvl = numOrNull(p.tvl_usd);
    if (tvl === null) throw new SnapshotError(`protocol ${p.slug} lacks a TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: strOrNull(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: tvl,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: typeof p.listed_at === 'string' && DATE_SHAPE.test(p.listed_at) ? p.listed_at : null,
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
  });
  for (const slug of o.watchlist as string[]) {
    if (!seen.has(slug)) throw new SnapshotError(`watchlist slug ${slug} is not among the protocols`);
  }
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

const DAY_MS = 86_400_000;

/** Whole days from listed_at to as_of, clamped at zero; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
