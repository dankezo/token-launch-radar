# METHOD - how the radar prices a launch that has not happened

Model name: **Category Comps with Sublinear TVL** (model id `radar-comps-1`).
Implemented in lib/comps.ts and lib/model.ts; every board row carries its own
arithmetic, and the parts printed on a row recompute to that row's implied value
exactly (verified for all 198 rows).

## The universe

A protocol is priced when the snapshot records no token for it (mcap_usd, gecko_id
and symbol all null) and it is not a wrapped, staked or bridged product of one that
trades, under the contest's own screen: category not Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC or CEX; no whole word wrapped,
staked or staking in the name; the name does not begin with an exchange name and
does not end in a version marker. On this snapshot that is 198 protocols: all 40
watchlist slugs, 60 at or above the $50,000,000 floor, 138 below it.

## The formula

    implied = multiple x tvl_usd x scale x growth x maturity

- **multiple** - the category's comparables multiple: market cap per dollar of
  TVL among the snapshot's tokenised peers in the same category, built as below.
- **scale** - (tvl_usd / 100,000,000) ^ -0.15. Sublinear in TVL (exponent 0.85 on
  TVL itself): the tenth dollar of TVL is not priced like the first, so a giant
  stale protocol cannot run away from the board on size alone. The factor is 1 at
  $100M of TVL, about 0.61 at $2.75B, about 1.30 at $17M.
- **growth** - 1 + clamp(change_7d, -60, +120) / 100 x 0.5, the result clamped to
  [0.70, 1.60]. An unreported change counts as no growth (factor 1).
- **maturity** - 0.85 + 0.30 x min(age_days, 1095) / 1095, where age_days runs
  from listed_at to the snapshot's as_of. A protocol that has operated for years
  with no token has the scarcer, more proven claim; an unknown age counts as 365
  days (factor 0.95).

## Building the multiples

- Peers: protocols that record a token and carry both a market cap above zero and
  a TVL. This snapshot yields 128 peers. The snapshot carries market cap, not a
  fully diluted figure, so every multiple here is a market-cap multiple; that is
  stated rather than hidden, and it is the same yardstick for every row.
- Each peer ratio mcap / TVL is clamped into [0.01, 2.00] before any median is
  taken (raw ratios in this snapshot run from under 0.01 to over 400).
- The global multiple is the median of all 128 clamped ratios: **0.213803**.
- A category's multiple is its clamped median blended with the global figure,
  weighted by peer count against 10 phantom global peers:
  multiple = (n x category median + 10 x 0.213803) / (n + 10), then banded into
  [0.25 x global, 2.00 x global] = [0.053451, 0.427606]. A category with no peers,
  and a protocol with no category, is priced at the global multiple.

## Assumptions, stated

1. Market cap stands in for launch value because the snapshot carries no FDV, no
   fee and no revenue figure; a revenue multiple is impossible from this data and
   none is pretended.
2. change_7d is TVL momentum, not earnings; it moves the price by at most -30%
   or +60% and is never the ranking on its own.
3. Age is DefiLlama's tracking age (listed_at), the only age the snapshot knows.
4. The snapshot does not carry DefiLlama's parentProtocol field, so the screen
   applies every part of the house rule its ten fields support. A small number of
   rows may be products of a tokenised parent the house list excluded on data
   this file does not hold; Polymarket International (rank 7) is the visible
   case, priced below on the record as it stands.
5. "Records no token" is the snapshot's statement, never a claim that no token
   exists anywhere.

## Worked examples (figures from out/board.json, arithmetic shown in stages)

### 1. Steakhouse Financial - rank 1 (Risk Curators, on the watchlist)
Risk Curators has a single tokenised peer, whose clamped ratio is 2.00, so the
multiple is mostly the global figure: (1 x 2.00 + 10 x 0.213803) / 11 = 0.376185.
- multiple x TVL: 0.376185 x $2,753,981,495 = $1,036,006,529
- x scale 0.608143 (TVL far above the $100M reference): $630,040,118
- x growth 0.989033 (change_7d -2.1935%): $623,130,468
- x maturity 0.998767 (543 days): **$622,362,149**

### 2. Loopscale Lending - rank 67 (Lending, below the floor)
Lending has 15 peers, median 0.132395: (15 x 0.132395 + 10 x 0.213803) / 25 =
0.164958.
- multiple x TVL: 0.164958 x $70,960,213 = $11,705,455
- x scale 1.052805: $12,323,561
- x growth 0.929471 (change_7d -14.1058%): $11,454,393
- x maturity 0.981507 (480 days): **$11,242,567**

### 3. Polymarket International - rank 7 (Prediction Market, full maturity)
One peer, clamped at 2.00, so the multiple is again 0.376185. Tracked since
2021-10-26: at 1,845 days the maturity factor is at its cap of 1.15.
- multiple x TVL: 0.376185 x $320,193,439 = $120,451,969
- x scale 0.839824: $101,158,454
- x growth 0.994592 (change_7d -1.0817%): $100,611,389
- x maturity 1.15: **$115,703,098**

### 4. Nonce Capital - rank 6 (Risk Curators, young, on the watchlist)
Same category multiple as example 1 (0.376185); what moves it is youth and a
falling week: maturity at 45 days is 0.862329, near the 0.85 floor.
- multiple x TVL: 0.376185 x $513,783,671 = $193,277,710
- x scale 0.782317: $151,204,438
- x growth 0.951312 (change_7d -9.7377%): $143,842,597
- x maturity 0.862329: **$124,039,643**

### 5. CommunityV3 - rank 110 (Dexs, small, fast-growing)
Dexs has 11 peers, median 0.342435: (11 x 0.342435 + 10 x 0.213803) / 21 =
0.281182. At $17.4M of TVL the sublinear scale lifts rather than cuts (1.299841),
and a strong week passes through at half weight.
- multiple x TVL: 0.281182 x $17,407,286 = $4,894,615
- x scale 1.299841: $6,362,222
- x growth 1.091115 (change_7d +18.2229%): $6,941,916
- x maturity 0.857123 (26 days): **$5,950,076**

## What the model deliberately does not do

- No protocol name is special-cased anywhere; one function prices every row.
- No tokenised protocol is ranked: the board prices only what is still to come,
  and the tokenised set appears separately in the dashboard data at the market's
  own values.
- No launch probability is estimated: the board prices what a launch would be
  worth on the record as it stands, which is the question the brief asks.

## Sensitivity pass (phase 2, 2026-11-22) and the locked parameters

The test set in advance: re-run the board at ALPHA 0.80 and 0.90 and at SHRINK_K 6
and 14, and keep the shipped constants only if every variant keeps at least 16 of
the baseline top 20, a Spearman rank correlation of at least 0.95 over all 198
rows, and every baseline top-5 row inside the variant's top 10. A constant that
reorders half the board when nudged is doing the ranking and would have to be
defended or changed. Results (baseline ALPHA 0.85, SHRINK_K 10):

| variant | rank 1 value | top-20 overlap | top-20 max move | Spearman (198 rows) |
|---|---|---|---|---|
| ALPHA 0.80 | $527,284,913 | 20 of 20 | 2 places | 0.9996 |
| ALPHA 0.90 | $734,584,091 | 20 of 20 | 1 place | 0.9996 |
| SHRINK_K 6 | $707,434,936 | 19 of 20 | 5 places | 0.9967 |
| SHRINK_K 14 | $550,723,126 | 20 of 20 | 3 places | 0.9973 |

Rank 1 is Steakhouse Financial in every variant, and the baseline top 5 stays
exactly the top 5 in all four. What the constants move is the level of the prices
(rank 1 ranges from $527M to $735M across the ALPHA band), not the order of the
board: the ranking is carried by TVL, the category multiples and the growth and
maturity factors, which is what the model claims. SHRINK_K 6 is the loosest
variant, as expected (thinner categories lean harder on one or two peers), and
even it changes a single top-20 seat.

**Locked: ALPHA 0.85, SHRINK_K 10.** ALPHA 0.85 sits mid-band, so the sublinear
discount is neither the weakest nor the strongest defensible reading of "the
tenth dollar of TVL is not priced like the first". SHRINK_K 10 sits between the
two tested values and is the more conservative of the pair against thin-category
noise, which phase 1 showed is the board's real fragility (one-peer categories
at a clamped ratio of 2.00). No re-run at the locked values changes a single
byte of the phase-1 board.

The second open question was whether the maturity premium should also require
the protocol to still be growing. Measured on the locked board: exactly 1 of
the top 20 is both at the maturity cap (tracked 1,095 days or more) and
shrinking on the week (Polymarket International, change_7d -1.0817%, whose
growth factor of 0.994592 already prices the down week), and 9 of 198 rows
board-wide. Gating maturity on growth would add a second, interacting mechanism
to move one borderline row by a factor already within half a percent of 1.
**Decision: maturity stays unconditional.** Age and momentum stay separate,
single-purpose factors, and the down week is priced once, by the growth factor,
not twice.
