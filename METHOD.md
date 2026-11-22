# METHOD - how the radar prices a launch that has not happened

Model name: **Fitted Value x Launch Odds** (model id `radar-fit-2`).
Implemented in lib/fit.ts and lib/model.ts; fitted at run time inside main.ts on
the sealed snapshot itself, in deterministic arithmetic with fixed iteration
counts and no stored constants, so two runs write the same bytes. Every board
row carries both models' arithmetic, and the parts printed on a row recompute
to that row's figures exactly (verified for all 198 rows by the pipeline's own
self-check, and again by the gate). The recompute rule, stated once: every
part is rounded to six decimals as printed; the fitted value is the rounded
exponential of the sum of the printed log parts; the odds are the sigmoid of
the sum of the printed logit parts, themselves rounded to six decimals; the
expected value is the rounded product of those two rounded figures. Recompute
with the factors as printed, at the precision printed, and every row lands on
its figures to the dollar.

This model replaces the first submission's hand-set category multiples and
constants. Nothing in it is set by hand: every coefficient is fitted, and every
term was kept only after it was tested out of sample, by leave-one-out
cross-validation, against the simpler model without it. The tests are published
below, including the ones the shipped model lost.

## The universe

A protocol is priced when the snapshot records no token for it (mcap_usd,
gecko_id and symbol all null) and it is not a wrapped, staked or bridged
product of one that trades, under the contest's own screen: category not
Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or
CEX; no whole word wrapped, staked or staking in the name; the name does not
begin with an exchange name and does not end in a version marker. On this
snapshot that is 198 protocols: all 40 watchlist slugs, 60 at or above the
$50,000,000 floor, 138 below it. The board stays at those 198; the dashboard's
audit view accounts for all 758 protocols in the snapshot (198 priced, 416
already trading, 144 set aside, each with the screen's reason stated).

## The two fitted models

    fitted launch value = exp(6.964567 + 0.522266 x ln TVL + category offset)
    launch odds         = sigmoid(0.215477 + 0.083144 x z(ln TVL)
                                  + 0.538457 x z(age) - 0.241949 x z(growth)
                                  + category offset)
    expected value      = fitted launch value x launch odds

board.json's implied_value_usd is the **expected value**: the fitted worth of
the launch, weighted by the fitted probability that a launch happens at all.
The ranking itself prices launch risk, so a large protocol in a category that
rarely launches ranks below a smaller one in a category that usually does.
Every row also carries the fitted value and the odds separately, so the two
readings are never hidden inside the product.

### The value model

Ordinary least squares of log market cap on log TVL, fitted on the 128 traded
peers that carry a market cap above zero (the same peer set the first model
drew its multiples from; the snapshot carries market cap, not a fully diluted
figure, and that is stated rather than hidden). The fitted size exponent is
0.522266: among the snapshot's own traded peers, market cap grows with roughly
the square root of TVL, not in proportion to it. Each category then takes a
log offset: the mean residual of its traded peers against the curve, shrunk
toward zero with 20 phantom peers (offset = sum of residuals / (peers + 20)),
so a category with one wild peer moves a little, not a lot. Offsets run from
-0.305 (Liquid Staking, 9 peers) to +0.311 (Prediction Market, 1 peer). A
category with no traded peers, and a protocol with no category, takes offset
zero.

The compression is a property of the record, and it is stated plainly: the
fitted curve prices the largest candidates well below a proportional multiple
(the board's fitted values total $2.28B, against $35.9B under the first
model's proportional reading), because that is what the snapshot's traded
peers support out of sample. Leave-one-out prefers the fitted curve over any
flat multiple by a wide margin (typical error x8.25 against x10.07, below);
a proportional model is the one the data rejects, not the one it supports.

### The odds model

Logistic regression (IRLS, 50 iterations at most, a small ridge on the slopes)
of "records a token" on standardised log TVL, age in years (capped at five)
and seven-day growth (clamped to [-60%, +120%], then divided by 100), fitted
on all 758 protocols: 416 record a token, a base rate of 54.88%. Each category
then takes a logit offset: its launch rate shrunk toward the base rate with 10
phantom protocols, expressed against the base logit. The offsets are the
strongest single part of the odds model: Lending sits at +0.950 (59 of its 75
protocols record a token), Risk Curators at -1.497 (5 of 39). Of the fitted
slopes, age carries the signal (+0.538 per standard deviation: the longer a
protocol has run, the likelier it already has, or is to have, a token), size
is weak (+0.083), and growth is negative (-0.242: a protocol whose TVL just
jumped is, in this record, less likely to be a launcher than a steady one).
Candidate odds on the board run from 2.6% to 90.4%.

## Out-of-sample evidence

Every figure below is leave-one-out: each protocol's prediction comes from a
model fitted without it, coefficients and category offsets refitted on every
fold. For the value model the error is measured in log space and stated as a
multiple: a typical error of x8.25 means the held-out market cap typically
lands within a factor of 8.25 of the fit, on the root-mean-square measure.

Value model, 128 traded peers:

| candidate | LOO typical (RMSE) | LOO mean (MAE) | LOO median |
|---|---|---|---|
| flat median multiple (the first model's core) | x10.07 | x6.09 | x5.09 |
| fitted size curve only | x8.23 | x4.93 | x3.40 |
| size curve + category offsets (shipped) | x8.25 | x4.84 | x3.64 |
| size curve + growth + age + category offsets | x8.40 | x5.05 | x3.97 |

Odds model, all 758 protocols (Brier score, lower is better):

| candidate | LOO Brier |
|---|---|
| base rate (predict 54.88% for everyone) | 0.2483 |
| logistic on size, age, growth | 0.2298 |
| logistic + category offsets (shipped) | 0.2088 |

How the terms were chosen, from those tables:

- The size curve does nearly all of the value model's work. The category
  offsets cost nothing out of sample (x8.25 against x8.23 on RMSE, inside the
  noise at 128 peers) and post the best mean error of the four (x4.84), so
  they ship: they carry the comparables reading of the first model into the
  fit, at no measured cost.
- Growth and age **raise every error measure** in the value regression, so
  they do not ship there. In the full-terms fit the growth slope even comes
  out strongly negative, which would price a protocol whose TVL just fell
  60% in a week far above its peers: an artefact of market caps falling more
  slowly than TVL among traded peers, not a launch signal. The shipped board
  has no such rows.
- In the odds model every stage wins: the logistic terms take the Brier score
  from 0.2483 to 0.2298, and the category offsets take it to 0.2088. Growth
  and age live here, where they earn their place, and the expected value the
  board ranks by therefore still follows from TVL, growth and age together,
  through the odds.

### Walk-forward: the same fits against a time split

Leave-one-out mixes the record's past and future in every fold. The second
check respects the arrow of time: protocols are ordered by listing date
(protocols with no listing date ordered as if listed 365 days before the
snapshot), each model is refitted on an expanding window of the earliest
listings, and it is scored only on the next block of later ones. The value
model trains first on 64 peers and is scored on the remaining 64 in blocks of
16; the odds model trains first on 379 protocols and is scored on the
remaining 379 in blocks of 95, with its standardisation constants and base
rate recomputed inside every training window, so nothing from a scored block
leaks into its own fit.

| model | walk-forward score | its baseline, same protocol |
|---|---|---|
| value, shipped form (64 later peers) | typical x10.25, mean x6.04, median x4.67 | flat multiple: typical x12.58, mean x7.39, median x5.50 |
| odds, shipped form (379 later protocols) | Brier 0.2462 | window base rate: 0.2746 |

Both shipped forms beat their baselines under the time split as well as under
leave-one-out, by smaller margins, which is the expected direction: the past
of this record is a harder training set than its whole. On a cross-sectional
snapshot this is a robustness angle, not a forecast test - the odds model
still reads a pattern across one record (assumption 2), and the walk-forward
says that pattern is not an artefact of fitting the future into the past. The
full protocol and figures are in model-fit.json under walk_forward.

## Uncertainty and calibration, measured

The tables above score the fits as points. This section states the same
fits as ranges and distributions, measured on the sealed snapshot under
definitions frozen before the numbers were run. None of it changes a
price: every board row's fitted value, odds and expected value are the
shipped figures, and each row now also carries its interval and rank
band so the uncertainty travels with the number it belongs to.

### Split-conformal intervals for the value model

Method: the 128 traded peers are shuffled with a fixed seed
(mulberry32, 20261122); the first 64 refit the value model, the last 64
form the calibration half. The conformal quantile of the calibration
half's absolute log residuals (finite-sample rule k = ceil((n + 1) x
(1 - alpha))) gives a half-width in log space: the 80% quantile is
2.752, the 90% quantile is 4.154. A leave-one-out variant, where each
peer's interval comes from the other 127 peers' absolute leave-one-out
residuals, corroborates. Empirical coverage, measured on the peers:

| variant | 80% level | 90% level |
|---|---|---|
| split-conformal (64 calibration peers) | 81.25% (52 of 64) | 92.19% (59 of 64) |
| leave-one-out conformal (128 peers) | 80.47% (103 of 128) | 90.63% (116 of 128) |

All four sit within four points of nominal, the band set before the
run. The cost is stated as plainly as the coverage: the intervals are
wide, a half-width multiple of about x15.7 at the 80% level and x63.7
at 90%. Rank 1's fitted $39,976,167 carries an 80% interval of
$2,550,494 to $626,582,181 and a 90% interval of $627,998 to
$2,544,745,650. That width is not a defect of the method; it is the
x8.25 typical error of the value model stated as a range instead of
being hidden inside a point estimate. Every board row carries its 80%
and 90% intervals (ci80_lo, ci80_hi, ci90_lo, ci90_hi), and the detail
view shows them beside the working.

### Rank stability under bootstrap resampling

Method: the 128 traded peers are resampled with replacement 200 times
(mulberry32, seed 20261123); the value model is refitted on each
resample and the 198 board rows re-ranked by bootstrap fitted value
times the shipped launch odds (the odds are not refitted; ties break
by slug). Each row carries its bootstrap median rank and rank IQR
(rank_median, rank_iqr).

- 95 of 198 rows (48.0%) are stable: rank IQR at most 10.
- 98 rows sit in between (IQR 11 to 29).
- 5 rows are coin-flips, IQR at least 30: templar-lending (shipped
  rank 71, IQR 30.0), fira (99, 30.0), predict-fun (104, 35.3), vesu
  (110, 31.3) and bend (124, 30.5).

The head of the board is firm: rank 1, polymarket-international, has
bootstrap median rank 1 and IQR 1.0; rank 4's IQR is 2.0; the last row's
IQR is 0.0. The middle is substantially sampling noise: flux-finance,
the worked example at rank 32 below, has bootstrap median rank 36 and
IQR 20.0 - the middle half of resamples place it between ranks 27 and
47, so its shipped position sits at the flattering edge of its own
distribution. Any reading of the board that treats rank 60 as
meaningfully ahead of rank 85 is stronger than this evidence allows,
and the board now says so on its face.

### Odds calibration, by decile

Leave-one-out probabilities for all 758 protocols (never in-sample),
sorted into deciles by (probability, slug). The expected calibration
error - the count-weighted mean absolute gap between mean predicted
probability and observed launch rate - is 0.0507. The overall mean
prediction is 0.5476 against a base rate of 0.5488.

| bin | n | mean predicted | observed rate | gap |
|---|---|---|---|---|
| 1 | 75 | 0.1856 | 0.1467 | 0.0390 |
| 2 | 76 | 0.3528 | 0.2763 | 0.0765 |
| 3 | 76 | 0.4287 | 0.5526 | 0.1240 |
| 4 | 76 | 0.4795 | 0.5263 | 0.0468 |
| 5 | 76 | 0.5248 | 0.5132 | 0.0117 |
| 6 | 75 | 0.5712 | 0.4667 | 0.1045 |
| 7 | 76 | 0.6306 | 0.6579 | 0.0273 |
| 8 | 76 | 0.6889 | 0.6842 | 0.0047 |
| 9 | 76 | 0.7552 | 0.8158 | 0.0606 |
| 10 | 76 | 0.8546 | 0.8421 | 0.0125 |

The model is well calibrated at the extremes and in aggregate. The
middle wobbles: bin 3 under-predicts by 12.4 points (predicted 0.4287,
observed 0.5526) and bin 6 over-predicts by 10.5 points (predicted
0.5712, observed 0.4667), with bin 2 over by 7.7 points. The fitted
curve is flatter than the record through the 0.40 to 0.60 band. The
table is published beside the odds rather than used to refit them:
monotone recalibration of these same probabilities (Platt, isotonic)
was tested out of sample and buys nothing, so the wobble is disclosed,
not smoothed over.

### Model error on known outcomes

The audit view carries, for each of the 128 traded peers the value
model was fitted on, the ratio of its actual market cap to the value
the shipped fit assigns it - the model's error where the answer is
already known. The frozen check for this display, set before it was
computed: if more than 70% of the ratios fell outside the factor-of-two
band [0.5, 2.0], the band display would be dropped. Measured: 87 of
128 (68.0%) fall outside, inside the line, so the column ships with
out-of-band ratios marked. The full distribution: median ratio 1.07;
41 of 128 (32.0%) land within a factor of two of the fit, 69 of 128
(53.9%) within a factor of four, 97 of 128 (75.8%) within a factor of
eight and 109 of 128 (85.2%) within a factor of sixteen. This is the
in-sample companion to the leave-one-out table above, and it is not
flattering: it is the same x8.25 story told peer by peer.

## Assumptions, stated

1. Market cap stands in for launch value because the snapshot carries no FDV,
   no fee and no revenue figure; a revenue multiple is impossible from this
   data and none is pretended.
2. The odds model is a cross-sectional fit on one snapshot: it learns which
   kinds of protocols record a token by the snapshot date, and reads a
   candidate's odds off that pattern. It is not a time-to-launch forecast and
   is never stated as one.
3. The odds features are standardised with the snapshot's own population
   means and standard deviations (ln TVL 17.734673 +/- 1.807814; age in years
   1.893248 +/- 1.292685; growth -0.062928 +/- 0.128148). Those constants are
   held fixed across the leave-one-out folds; coefficients and offsets are
   refitted on every fold.
4. Age is DefiLlama's tracking age (listed_at), the only age the snapshot
   knows; an unknown age counts as 365 days in both models.
5. The snapshot does not carry DefiLlama's parentProtocol field, so no part
   of a rule that turns on that field can be applied from this data, by us or
   by anyone working from the same file. The screen applies every part of the
   house rule its ten fields do support, uniformly, to all 758 protocols: no
   protocol is added, removed or repriced by name, and the board is exactly
   the set that uniform screen produces.
6. "Records no token" is the snapshot's statement, never a claim that no
   token exists anywhere.

## Worked examples (figures from board.json, arithmetic shown in stages)

### 1. Polymarket International - rank 1 (Prediction Market)
TVL $320,193,439, tracked 1,845 days, change_7d -1.0817%. Its category's
single traded peer sits above the curve, for a +0.310951 offset; its age is
the board's oldest, which the odds model rewards.
- ln fitted value: 6.964567 + 0.522266 x ln TVL (+10.228276) + 0.310951 = 17.503794, so fitted value **$39,976,167**
- logit: 0.215477 + 0.085073 (size) + 1.294091 (age) - 0.098387 (growth) - 0.199528 (category) = 1.296726, so odds **0.785283 (78.5%)**
- expected value: $39,976,167 x 0.785283 = **$31,392,604**

### 2. Steakhouse Financial - rank 4 (Risk Curators, on the watchlist)
The board's largest candidate by TVL at $2,753,981,495, and the clearest case
of the ranking pricing launch risk: Risk Curators has launched 5 of its 39
protocols, a -1.496597 logit offset that no size can argue with.
- ln fitted value: 6.964567 + 11.352128 + 0.090660 = 18.407355, so fitted value **$98,676,265**
- logit: 0.215477 + 0.184041 (size) - 0.168940 (age) - 0.077396 (growth) - 1.496597 (category) = -1.343415, so odds **0.206949 (20.7%)**
- expected value: $98,676,265 x 0.206949 = **$20,420,954**

### 3. Flux Finance - rank 32 (Lending, below the floor)
TVL $43,614,505, tracked 1,368 days. Lending's traded peers sit below the
size curve (-0.245268), but 59 of its 75 protocols record a token (+0.949603
on the logit): a modest fitted value at the board's near-highest odds.
- ln fitted value: 6.964567 + 9.187121 - 0.245268 = 15.906420, so fitted value **$8,092,271**
- logit: 0.215477 - 0.006612 (size) + 0.772558 (age) - 0.117738 (growth) + 0.949603 (category) = 1.813288, so odds **0.859759 (86.0%)**
- expected value: $8,092,271 x 0.859759 = **$6,957,403**

## The rest of the entry

- Farm plans stay six concrete steps per protocol, computed from its own
  record by continuous formulas, not tier tables: capital is a smooth
  function of TVL, gas is a per-chain price times a per-category action
  weight (an add-liquidity action is three transactions, a supply is one)
  times the plan's own transaction count, the hold is a smooth function of
  tracking age, and the minutes are the plan's own action times summed over
  its schedule. Two protocols with different records get different plans. The
  closing step nets the plan in its own figures: capital, gas and hours of
  work over the hold, set against the protocol's expected value at stake and
  its fitted odds, with the gas cost per $1,000 of expected value stated at a
  precision that survives large rows. Each row also carries the plan's gas
  total and minutes as figures (farm_gas_usd, farm_minutes).
- The dashboard shows all three numbers per row (fitted value, launch odds,
  expected value) plus the implied multiple and the gas per $1,000 of
  expected value, replays both models' working in the detail view with the
  out-of-sample scores stated beside it, together with the row's conformal
  interval and bootstrap rank band, and carries the audit view over all
  758 protocols described above, including each traded peer's
  actual-over-fitted ratio. It also triages every plan (farm, thin or
  skip, from the row's odds and gas per $1,000 of expected value, the rule
  stated on the page), pins up to three protocols side by side in a compare
  tray with their working, filters by a minimum TVL, and refits both models
  in the browser from the audit data: at the shipped settings the refit must
  reproduce the board figure for figure, and the page states whether it
  does.

## What the model deliberately does not do

- No protocol name is special-cased anywhere; the same two fits price every
  row, and no coefficient was adjusted after the fits were run.
- No tokenised protocol is ranked: the board prices only what is still to
  come, and the tokenised set appears separately in the dashboard data at the
  market's own values.
- No term ships on a story. Growth and age were cut from the value model on
  the published leave-one-out table, not kept because the brief names them;
  they are in the odds model because that is where they win.
- No farm portfolio layer ships. An exact 0/1 knapsack over the board's
  rows (maximising total expected value under frozen budgets of $250 gas
  and 1,200 minutes, and of $750 and 3,600 minutes) was solved and
  compared with the simple greedy rule of taking rows by expected value
  per minute: the exact optimum beat the greedy portfolio by 2.64% and
  0.70% respectively, under the 5% bar set before the comparison was
  run. Greedy triage is already within about 3% of optimal on this
  board, so no optimisation claim is made for it.
