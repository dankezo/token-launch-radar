// Token launch radar, pipeline v1 (model radar-comps-1, see METHOD.md).
//
// Reads the sealed snapshot (--input, default /input/snapshot.json), builds the
// comparables table and the ranked board, self-checks the board against the gate's
// rules, and writes the typed outputs into the output directory (--out, default
// $MAKEFUN_OUTPUT_DIR or ./out):
//   board.json             the gate-shaped board ({rows: [...]}) with shown working
//   watchlist.csv          the same board as a flat table
//   protocols-typed.json   every protocol in the snapshot with its derived status
//   category-multiples.json  the comparables table the board was priced from
//   radar-data.json        the dashboard's dataset (board rows plus the live-token set)
//   dashboard-data.js      the same dataset as a script for the static dashboard
// When dashboard/ and screenshots/ hold files (phase 2), they are copied into the
// output and dossier.json is written with vendor/makefun-board.ts, as the contest
// contract requires. Two runs over the same snapshot write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, ageDays, type Snapshot } from './lib/snapshot.ts';
import { exclusionReasons, isCandidate, recordsToken, type TypedProtocol } from './lib/universe.ts';
import { buildComps } from './lib/comps.ts';
import { MODEL_VERSION } from './lib/model.ts';
import { buildBoard, boardIssue, type BoardRow } from './lib/board.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('out', process.env.MAKEFUN_OUTPUT_DIR ?? join(here, 'out'));

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const comps = buildComps(snapshot.protocols);
const board = buildBoard(snapshot, comps);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the pipeline wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

// board.json: the gate's object shape, with the model named and the working shown.
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: MODEL_VERSION, as_of: snapshot.as_of, rows: board })}\n`);

// watchlist.csv: the board as a flat table.
const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLines = [
  'rank,slug,name,category,chains,tvl_usd,change_7d,age_days,multiple,implied_value_usd,on_watchlist',
  ...board.map((r) =>
    [r.rank, r.slug, r.name, r.category, r.chains.join(';'), r.tvl_usd, r.change_7d, r.age_days, r.multiple, r.implied_value_usd, r.on_watchlist].map(csvCell).join(','),
  ),
];
writeFileSync(join(out, 'watchlist.csv'), `${csvLines.join('\n')}\n`);

// protocols-typed.json: the whole snapshot with its derived status, in slug order.
const watch = new Set(snapshot.watchlist);
const typed: TypedProtocol[] = snapshot.protocols.map((p) => {
  const reasons = exclusionReasons(p);
  return {
    ...p,
    token_status: recordsToken(p) ? 'tokenised' : 'pre-token',
    age_days: ageDays(snapshot.as_of, p.listed_at),
    candidate: reasons.length === 0,
    exclusion_reasons: reasons,
    on_watchlist: watch.has(p.slug),
  };
});
writeFileSync(join(out, 'protocols-typed.json'), `${JSON.stringify({ as_of: snapshot.as_of, protocols: typed })}\n`);

// category-multiples.json: the comparables table, minus the lookup map.
writeFileSync(
  join(out, 'category-multiples.json'),
  `${JSON.stringify({ global_peer_count: comps.global_peer_count, global_median_ratio: comps.global_median_ratio, categories: comps.categories })}\n`,
);

// radar-data.json: the dashboard's dataset. The live set is the tokenised protocols by
// market cap, kept apart from the ranked board: the board prices what is still to
// come, the live set shows what already trades at the market's own values.
const live = snapshot.protocols
  .filter((p) => recordsToken(p) && p.mcap_usd !== null)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
  .slice(0, 24)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
const radarData = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model: MODEL_VERSION, watchlist_size: snapshot.watchlist.length, board_size: board.length, rows: board, live };
writeFileSync(join(out, 'radar-data.json'), `${JSON.stringify(radarData)}\n`);
// dashboard-data.js: the same dataset as a script the static dashboard loads with a
// plain relative <script src="../dashboard-data.js">, so the page renders the exact
// figures board.json carries with no network and no build step.
writeFileSync(join(out, 'dashboard-data.js'), `window.RADAR_DATA = ${JSON.stringify(radarData)};\n`);

// Phase 2 hook: a dashboard and screenshots, when they exist, are copied and the
// dossier is written exactly as the contest contract requires.
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    mkdirSync(to, { recursive: true });
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}
const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
let dossierNote = 'dashboard and screenshots not present yet (phase 2), dossier skipped';
if (dashFiles.length > 0 && shots.length >= 3) {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  dossierNote = `dossier.json written from ${dashFiles.length} dashboard files and ${shots.length} screenshots`;
}

const candidates = typed.filter((t) => t.candidate).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${candidates} launch candidates, ${board.length} board rows\n` +
    `token radar: comps from ${comps.global_peer_count} tokenised peers, global median mcap/TVL ${comps.global_median_ratio.toFixed(4)}\n` +
    `token radar: wrote board.json, watchlist.csv, protocols-typed.json, category-multiples.json, radar-data.json, dashboard-data.js to ${out}\n` +
    `token radar: ${dossierNote}\n`,
);
