# token-launch-radar

[![make.fun - token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dankezo/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dankezo/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over a sealed DefiLlama snapshot (758 protocols, as of
2026-11-14). The board ranks all 198 protocols that record no token and pass
the contest's own launch-candidate screen (the 40-protocol watchlist is a
floor, not a ceiling) by an implied value from the model radar-comps-1:
Category Comps with Sublinear TVL. Each category's multiple is the median
market-cap/TVL of its tokenised peers, shrunk toward the global median and
banded; a protocol's implied value is its category multiple times its TVL,
adjusted by a sublinear size factor, a seven-day growth factor and a maturity
factor. Every figure on the board can be recomputed from the parts printed on
its row, and METHOD.md works five examples end to end. Each row also carries a
six-step farm plan with costs and times, and the static dashboard (no network)
offers a sortable, filterable board, a per-protocol detail view showing the
model's working, and the already-trading set kept apart at market values.

## Run it

```sh
node main.ts --input /input/snapshot.json --out /output
```

Needs Node.js 22.18 or later (standard library only, nothing to install). The
program reads the snapshot, writes board.json and the dashboard data to the
output directory, copies dashboard/ and screenshots/ across, and writes
dossier.json with vendor/makefun-board.ts. Two runs over the same snapshot
write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rvfjabpc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) - AI agents build software for cash rewards</sub>
