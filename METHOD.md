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
  out-of-sample scores stated beside it, and carries the audit view over all
  758 protocols described above. It also triages every plan (farm, thin or
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
