// Token launch radar, pipeline v2 (model radar-fit-2, see METHOD.md).
//
// Reads the sealed snapshot (--input, default /input/snapshot.json), fits the two
// pricing models on the snapshot itself, builds the ranked board, self-checks the
// board against the gate's rules, and writes the typed outputs into the output
// directory (--out, default $MAKEFUN_OUTPUT_DIR or ./out):
//   board.json             the gate-shaped board ({rows: [...]}) with shown working
//   watchlist.csv          the same board as a flat table
//   protocols-typed.json   every protocol in the snapshot with its derived status
//   model-fit.json         the fitted coefficients, category offsets and the
//                          leave-one-out evidence both models were scored with
//   radar-data.json        the dashboard's dataset (board rows, the live-token
//                          set, the model evidence and the full audit)
//   dashboard-data.js      the same dataset as a script for the static dashboard
// When dashboard/ and screenshots/ hold files (phase 2), they are copied into the
// output and dossier.json is written with vendor/makefun-board.ts, as the contest
// contract requires. Two runs over the same snapshot write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, ageDays, type Snapshot } from './lib/snapshot.ts';
import { exclusionReasons, isCandidate, recordsToken, type TypedProtocol } from './lib/universe.ts';
import { fitOddsModel, fitValueModel, round6, walkForward, VALUE_CAT_SHRINK, ODDS_CAT_SHRINK } from './lib/fit.ts';
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
const ages = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at));
const valueFit = fitValueModel(snapshot.protocols, ages);
const oddsFit = fitOddsModel(snapshot.protocols, ages);
const wf = walkForward(snapshot.protocols, ages, snapshot.as_of);
const board = buildBoard(snapshot, valueFit, oddsFit);
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
  'rank,slug,name,category,chains,tvl_usd,change_7d,age_days,fitted_value_usd,launch_odds,implied_value_usd,on_watchlist',
  ...board.map((r) =>
    [r.rank, r.slug, r.name, r.category, r.chains.join(';'), r.tvl_usd, r.change_7d, r.age_days, r.fitted_value_usd, r.launch_odds, r.implied_value_usd, r.on_watchlist].map(csvCell).join(','),
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

// model-fit.json: the fitted models in full, coefficients, category offsets and
// the leave-one-out evidence, so every figure the board carries can be traced to
// the fit that produced it.
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;
const looOut = (s: { rmse: number; mae: number; mdae: number }) => ({
  rmse_log: round6(s.rmse),
  typical_multiple: round2(Math.exp(s.rmse)),
  mae_log: round6(s.mae),
  mean_multiple: round2(Math.exp(s.mae)),
  median_multiple: round2(Math.exp(s.mdae)),
});
const modelFit = {
  model: MODEL_VERSION,
  as_of: snapshot.as_of,
  value: {
    form: 'ln fitted value = intercept + size_coef x ln TVL + category offset',
    fitted_on: 'the traded peers that carry a market cap',
    peers: valueFit.peers,
    intercept: round6(valueFit.intercept),
    size_coef: round6(valueFit.size_coef),
    category_shrink: VALUE_CAT_SHRINK,
    category_offsets: [...valueFit.category_offset.entries()]
      .map(([category, offset]) => ({ category: category === '' ? null : category, peers: valueFit.category_peer_count.get(category) ?? 0, offset: round6(offset) }))
      .sort((a, b) => String(a.category).localeCompare(String(b.category))),
    loo: looOut(valueFit.loo),
    loo_size_only: looOut(valueFit.loo_size_only),
    loo_full_terms: looOut(valueFit.loo_full_terms),
    flat_baseline: { multiple: round6(valueFit.flat_multiple), loo: looOut(valueFit.flat_loo) },
  },
  odds: {
    form: 'logit launch odds = intercept + size_coef x z(ln TVL) + age_coef x z(age in years) + growth_coef x z(seven-day growth) + category offset',
    fitted_on: 'every protocol in the snapshot, outcome: records a token',
    population: oddsFit.population,
    launched: oddsFit.launched,
    base_rate: round4(oddsFit.base_rate),
    intercept: round6(oddsFit.intercept),
    size_coef: round6(oddsFit.size_coef),
    age_coef: round6(oddsFit.age_coef),
    growth_coef: round6(oddsFit.growth_coef),
    z: {
      log_tvl: { mean: round6(oddsFit.z_log_tvl.mean), sd: round6(oddsFit.z_log_tvl.sd) },
      age_years: { mean: round6(oddsFit.z_age_years.mean), sd: round6(oddsFit.z_age_years.sd) },
      growth: { mean: round6(oddsFit.z_growth.mean), sd: round6(oddsFit.z_growth.sd) },
    },
    category_shrink: ODDS_CAT_SHRINK,
    category_offsets: [...oddsFit.category_offset.entries()]
      .map(([category, offset]) => ({
        category: category === '' ? null : category,
        protocols: oddsFit.category_count.get(category) ?? 0,
        launched: oddsFit.category_launched.get(category) ?? 0,
        offset: round6(offset),
      }))
      .sort((a, b) => String(a.category).localeCompare(String(b.category))),
    loo_brier: round4(oddsFit.loo_brier),
    loo_brier_no_category: round4(oddsFit.loo_brier_no_category),
    base_loo_brier: round4(oddsFit.base_loo_brier),
  },
  walk_forward: {
    protocol:
      'expanding window over listing-date order (listed_at ascending, slug tiebreak; no listing date ordered as as_of minus 365 days); value: first train 64 peers, test blocks of 16; odds: first train 379 protocols, test blocks of 95, standardisation constants and base rate recomputed inside every training window',
    value: { tested: wf.value.tested, ...looOut(wf.value) },
    value_flat: { tested: wf.value_flat.tested, ...looOut(wf.value_flat) },
    odds_brier: round4(wf.odds_brier),
    odds_base_brier: round4(wf.odds_base_brier),
    odds_tested: wf.odds_tested,
  },
};
writeFileSync(join(out, 'model-fit.json'), `${JSON.stringify(modelFit)}\n`);

// radar-data.json: the dashboard's dataset. The live set is the tokenised protocols by
// market cap, kept apart from the ranked board: the board prices what is still to
// come, the live set shows what already trades at the market's own values.
const live = snapshot.protocols
  .filter((p) => recordsToken(p) && p.mcap_usd !== null)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
  .slice(0, 24)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

// evidence: the out-of-sample scores of both fits, as the dashboard states them.
const evidence = {
  value_peers: valueFit.peers,
  value_loo_multiple: round2(Math.exp(valueFit.loo.rmse)),
  value_loo_mean_multiple: round2(Math.exp(valueFit.loo.mae)),
  flat_loo_multiple: round2(Math.exp(valueFit.flat_loo.rmse)),
  odds_population: oddsFit.population,
  odds_launched: oddsFit.launched,
  odds_base_rate: round4(oddsFit.base_rate),
  odds_loo_brier: round4(oddsFit.loo_brier),
  odds_base_loo_brier: round4(oddsFit.base_loo_brier),
  value_wf_multiple: round2(Math.exp(wf.value.rmse)),
  value_flat_wf_multiple: round2(Math.exp(wf.value_flat.rmse)),
  odds_wf_brier: round4(wf.odds_brier),
  odds_wf_base_brier: round4(wf.odds_base_brier),
};

// audit: every protocol in the snapshot, accounted for. Priced rows carry their
// board rank, trading rows their recorded market cap, set-aside rows the screen's
// own reasons. The board is the house screen's 198; the audit is all 758.
const rankBySlug = new Map(board.map((r) => [r.slug, r.rank]));
const audit = typed.map((t) => {
  if (t.candidate) {
    return { slug: t.slug, name: t.name, category: t.category, tvl_usd: t.tvl_usd, mcap_usd: t.mcap_usd, age_days: t.age_days, change_7d: t.change_7d, status: 'priced', note: `Board rank ${rankBySlug.get(t.slug)}` };
  }
  if (t.token_status === 'tokenised') {
    return {
      slug: t.slug,
      name: t.name,
      category: t.category,
      tvl_usd: t.tvl_usd,
      mcap_usd: t.mcap_usd,
      age_days: t.age_days,
      change_7d: t.change_7d,
      status: 'trading',
      note: t.mcap_usd !== null ? `Already trading, market cap $${Math.round(t.mcap_usd).toLocaleString('en-US')}` : 'Token recorded; no market cap in the snapshot',
    };
  }
  return { slug: t.slug, name: t.name, category: t.category, tvl_usd: t.tvl_usd, mcap_usd: t.mcap_usd, age_days: t.age_days, change_7d: t.change_7d, status: 'excluded', note: `Set aside: ${t.exclusion_reasons.join('; ')}` };
});
const radarData = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model: MODEL_VERSION, watchlist_size: snapshot.watchlist.length, board_size: board.length, rows: board, live, evidence, audit };
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
    `token radar: value fit on ${valueFit.peers} traded peers, leave-one-out typical error x${Math.exp(valueFit.loo.rmse).toFixed(2)} against x${Math.exp(valueFit.flat_loo.rmse).toFixed(2)} for a flat multiple\n` +
    `token radar: odds fit on ${oddsFit.population} protocols, leave-one-out Brier ${oddsFit.loo_brier.toFixed(4)} against ${oddsFit.base_loo_brier.toFixed(4)} for the base rate\n` +
    `token radar: walk-forward value typical error x${Math.exp(wf.value.rmse).toFixed(2)} against x${Math.exp(wf.value_flat.rmse).toFixed(2)} flat (${wf.value.tested} peers scored); walk-forward odds Brier ${wf.odds_brier.toFixed(4)} against ${wf.odds_base_brier.toFixed(4)} for the window base rate (${wf.odds_tested} scored)\n` +
    `token radar: wrote board.json, watchlist.csv, protocols-typed.json, model-fit.json, radar-data.json, dashboard-data.js to ${out}\n` +
    `token radar: ${dossierNote}\n`,
);
