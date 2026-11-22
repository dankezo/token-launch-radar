// Token Launch Radar dashboard. Renders window.RADAR_DATA (written next to this
// folder by the pipeline as dashboard-data.js, the same figures board.json
// carries) as a sortable, filterable board with a per-protocol detail view and
// a full audit of the snapshot. No imports, no fetching: the page works on the
// sealed snapshot alone.

(function () {
  'use strict';
  var data = window.RADAR_DATA;
  var boardView = document.getElementById('board-view');
  var detailView = document.getElementById('detail-view');
  if (!data) {
    boardView.innerHTML = '<p class="empty">The dashboard data file (dashboard-data.js, written by the pipeline next to this folder) was not found, so there is nothing to render.</p>';
    return;
  }
  var rows = data.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var ev = data.evidence || {};
  var audit = data.audit || [];
  // The board renders `display`: the shipped rows, or the refit rows while a
  // refit setting is moved. Detail views always replay the shipped rows.
  var display = rows;
  var pins = [];

  var state = { q: '', cat: '', chain: '', watchOnly: false, floorOnly: false, minTvl: 0, sortKey: 'rank', sortDir: 1 };
  var auditState = { q: '', status: 'all' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(n) { return '$' + commas(n); }
  function compact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return money(n);
  }
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1).replace(/\.0$/, '') + 'y (' + commas(days) + 'd)';
  }
  function pct(odds) { return (odds * 100).toFixed(1) + '%'; }
  function signed6(n) { return (n < 0 ? '' : '+') + n.toFixed(6); }
  function changeCell(r) {
    if (r.change_7d == null) return '<span class="flat">n/r</span>';
    var cls = r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
    var sign = r.change_7d > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + r.change_7d.toFixed(2) + '%</span>';
  }
  // Farm economics, computed on the page from the row's own figures: the
  // plan's gas against its expected value, and the triage tier that follows.
  function gasRate(r) { return r.farm_gas_usd / Math.max(1, r.implied_value_usd / 1000); }
  function rateText(n) {
    if (n >= 100) return '$' + Math.round(n);
    if (n >= 10) return '$' + n.toFixed(1);
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.1) return '$' + n.toFixed(3);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(5);
  }
  function tierOf(r) {
    if (r.launch_odds < 0.15) return 'skip';
    if (r.launch_odds < 0.30 || gasRate(r) > 0.05) return 'thin';
    return 'farm';
  }
  function multText(r) {
    var m = r.fitted_value_usd / r.tvl_usd;
    return (m >= 0.1 ? m.toFixed(2) : m.toFixed(3)) + 'x';
  }

  // Header stats, model line and the published out-of-sample evidence.
  document.getElementById('as-of').textContent = data.as_of;
  document.getElementById('model-id').textContent = data.model;
  if (ev.value_loo_multiple != null) {
    document.getElementById('ev-value').textContent = ev.value_loo_multiple.toFixed(2);
    document.getElementById('ev-flat').textContent = ev.flat_loo_multiple.toFixed(2);
    document.getElementById('ev-peers').textContent = ev.value_peers;
    document.getElementById('ev-brier').textContent = ev.odds_loo_brier.toFixed(4);
    document.getElementById('ev-base').textContent = ev.odds_base_loo_brier.toFixed(4);
    document.getElementById('ev-pop').textContent = ev.odds_population;
  }
  if (ev.value_wf_multiple != null) {
    document.getElementById('ev-wf').textContent = ev.value_wf_multiple.toFixed(2);
    document.getElementById('ev-wf-flat').textContent = ev.value_flat_wf_multiple.toFixed(2);
    document.getElementById('ev-wf-brier').textContent = ev.odds_wf_brier.toFixed(4);
    document.getElementById('ev-wf-base').textContent = ev.odds_wf_base_brier.toFixed(4);
  }
  var stats = [
    ['Pre-token, ranked', rows.length],
    ['House watchlist', data.watchlist_size],
    ['Watchlist floor', compact(data.floor_usd)],
    ['Snapshot protocols', audit.length || 758],
    ['Board total, expected', compact(rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0))],
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>';
  }).join('');

  // Filter options, from the data itself.
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (cats.indexOf(c) < 0) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  cats.sort(); chains.sort();
  document.getElementById('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  document.getElementById('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  function visible() {
    var q = state.q.trim().toLowerCase();
    var out = display.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.floorOnly && r.tvl_usd < data.floor_usd) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    var val = {
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      value: function (r) { return r.fitted_value_usd; },
      multiple: function (r) { return r.fitted_value_usd / r.tvl_usd; },
      odds: function (r) { return r.launch_odds; },
      implied: function (r) { return r.implied_value_usd; },
      gasrate: function (r) { return gasRate(r); },
      tier: function (r) { return { farm: 0, thin: 1, skip: 2 }[tierOf(r)]; },
    }[key];
    out.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return out;
  }

  function renderBoard() {
    var list = visible();
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + display.length + ' protocols';
    var tc = { farm: 0, thin: 0, skip: 0 };
    display.forEach(function (r) { tc[tierOf(r)]++; });
    document.getElementById('triage').textContent = 'Triage: ' + tc.farm + ' farm, ' + tc.thin + ' thin, ' + tc.skip + ' skip';
    document.getElementById('empty').hidden = list.length > 0;
    document.getElementById('rows').innerHTML = list.map(function (r) {
      var chainText = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      var pinned = pins.indexOf(r.slug) >= 0;
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WL</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span>' +
        '<button type="button" class="pin' + (pinned ? ' on' : '') + '" data-pin="' + esc(r.slug) + '">' + (pinned ? 'Pinned' : 'Pin') + '</button></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + esc(chainText) + '</td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + compact(r.fitted_value_usd) + '</td>' +
        '<td class="num">' + multText(r) + '</td>' +
        '<td class="num">' + pct(r.launch_odds) + '</td>' +
        '<td class="num implied">' + compact(r.implied_value_usd) + '</td>' +
        '<td class="num">' + rateText(gasRate(r)) + '</td>' +
        '<td class="tier tier-' + tierOf(r) + '">' + tierOf(r) + '</td></tr>';
    }).join('');
    document.querySelectorAll('#board thead th.sortable').forEach(function (th) {
      var base = th.getAttribute('data-label') || th.textContent.replace(/ [▲▼]$/, '');
      th.setAttribute('data-label', base);
      th.innerHTML = esc(base) + (th.getAttribute('data-sort') === state.sortKey
        ? ' <span class="arrow">' + (state.sortDir === 1 ? '▲' : '▼') + '</span>' : '');
    });
  }

  // The already-trading set, kept apart from the ranked board.
  document.getElementById('live').innerHTML = data.live.map(function (p) {
    return '<article class="live-card"><h3>' + esc(p.name) + '</h3><p class="lcat">' + esc(p.category || 'Uncategorised') + '</p>' +
      '<dl><div><dt>Market cap</dt><dd>' + compact(p.mcap_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + compact(p.tvl_usd) + '</dd></div></dl></article>';
  }).join('');

  // The audit: every protocol in the snapshot, with its disposition.
  var auditCounts = { priced: 0, trading: 0, excluded: 0 };
  audit.forEach(function (a) { if (auditCounts[a.status] != null) auditCounts[a.status]++; });
  document.getElementById('audit-total').textContent = audit.length;
  document.getElementById('audit-counts').textContent =
    auditCounts.priced + ' priced on the board, ' + auditCounts.trading + ' already trading, ' + auditCounts.excluded + ' set aside';
  var statusWord = { priced: 'Priced', trading: 'Already trading', excluded: 'Set aside' };
  function renderAudit() {
    var q = auditState.q.trim().toLowerCase();
    var list = audit.filter(function (a) {
      if (auditState.status !== 'all' && a.status !== auditState.status) return false;
      if (q && a.name.toLowerCase().indexOf(q) < 0 && a.slug.indexOf(q) < 0) return false;
      return true;
    });
    list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    document.getElementById('audit-count').textContent = 'Showing ' + list.length + ' of ' + audit.length + ' protocols';
    document.getElementById('audit-empty').hidden = list.length > 0;
    document.getElementById('audit-rows').innerHTML = list.map(function (a) {
      var linked = a.status === 'priced' && bySlug[a.slug];
      return '<tr' + (linked ? ' data-slug="' + esc(a.slug) + '" class="linked"' : '') + '>' +
        '<td class="aname">' + esc(a.name) + '<span class="slug">' + esc(a.slug) + '</span></td>' +
        '<td class="cat">' + esc(a.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + compact(a.tvl_usd) + '</td>' +
        '<td class="status status-' + esc(a.status) + '">' + esc(statusWord[a.status] || a.status) + '</td>' +
        '<td class="note">' + esc(a.note) + '</td></tr>';
    }).join('');
  }

  function detail(r) {
    var vp = r.value_log_parts;
    var lp = r.logit_parts;
    var coef = vp.size / Math.log(r.tvl_usd);
    var logSum = vp.intercept + vp.size + vp.category;
    var logitSum = lp.intercept + lp.size + lp.age + lp.growth + lp.category;
    var valueStages = [
      ['Intercept, fitted on the ' + (ev.value_peers || 128) + ' traded peers that carry a market cap', vp.intercept.toFixed(6)],
      ['+ size: ' + coef.toFixed(4) + ' x ln TVL (TVL ' + money(r.tvl_usd) + ') - the fitted size curve: value grows with TVL, at a discount', signed6(vp.size)],
      ['+ category offset (' + esc(r.category || 'Uncategorised') + ': how its traded peers sit against the curve, shrunk toward it)', signed6(vp.category)],
      ['ln fitted value, the sum of the three', logSum.toFixed(6)],
    ];
    var oddsStages = [
      ['Intercept, fitted on all ' + (ev.odds_population || 758) + ' protocols (base launch rate ' + (ev.odds_base_rate != null ? (ev.odds_base_rate * 100).toFixed(1) : '54.9') + '%)', lp.intercept.toFixed(6)],
      ['+ size term (standardised ln TVL)', signed6(lp.size)],
      ['+ age term (standardised age: the longer a protocol has run, the likelier a launch)', signed6(lp.age)],
      ['+ growth term (standardised seven-day TVL change ' + (r.change_7d == null ? 'not reported, counted as flat' : r.change_7d.toFixed(2) + '%') + ')', signed6(lp.growth)],
      ['+ category offset (' + esc(r.category || 'Uncategorised') + ': its launch rate against the base rate, shrunk toward it)', signed6(lp.category)],
      ['Logit, the sum of the five', logitSum.toFixed(6)],
    ];
    var facts = [
      ['Rank', '#' + r.rank + ' of ' + rows.length],
      ['House watchlist', r.on_watchlist ? 'Yes' : 'No - found below the watchlist'],
      ['Category', r.category || 'Uncategorised'],
      ['Chains', r.chains.join(', ') || 'none recorded'],
      ['TVL', money(r.tvl_usd)],
      ['7d TVL change', r.change_7d == null ? 'not reported' : r.change_7d.toFixed(2) + '%'],
      ['Tracked since', r.listed_at || 'not recorded'],
      ['Age at snapshot', r.age_days == null ? 'unknown' : commas(r.age_days) + ' days'],
    ];
    var hours = Math.round((r.farm_minutes / 60) * 10) / 10;
    return '<div class="detail-head"><h2>' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WL</span>' : '') + '</h2>' +
      '<p class="dsub">' + esc(r.slug) + ' - pre-token on the snapshot of ' + esc(data.as_of) + '. Fitted launch value ' +
      '<strong>' + money(r.fitted_value_usd) + '</strong> at fitted launch odds of <strong>' + pct(r.launch_odds) + '</strong>' +
      ' gives the expected value the board ranks by: <strong>' + money(r.implied_value_usd) + '</strong>.</p></div>' +
      '<div class="detail-grid"><section class="card"><h3>The record</h3><dl class="facts">' +
      facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
      '</dl></section>' +
      '<section class="card"><h3>The working</h3>' +
      '<p class="work-sub">Fitted launch value (log scale)</p><table class="working">' +
      valueStages.map(function (s) { return '<tr><td class="wlabel">' + s[0] + '</td><td class="wval">' + s[1] + '</td></tr>'; }).join('') +
      '<tr class="subtotal"><td class="wlabel">Fitted launch value, exp of the sum</td><td class="wval">' + money(r.fitted_value_usd) + '</td></tr>' +
      '</table>' +
      '<p class="work-sub">Fitted launch odds (logit scale)</p><table class="working">' +
      oddsStages.map(function (s) { return '<tr><td class="wlabel">' + s[0] + '</td><td class="wval">' + s[1] + '</td></tr>'; }).join('') +
      '<tr class="subtotal"><td class="wlabel">Launch odds, sigmoid of the sum</td><td class="wval">' + pct(r.launch_odds) + '</td></tr>' +
      '</table>' +
      '<table class="working"><tr class="total"><td class="wlabel">Expected value, as ranked on the board</td><td class="wval">' + money(r.implied_value_usd) + '</td></tr></table>' +
      '<p class="work-note">Out of sample, the value fit\'s leave-one-out typical error is &times;' + (ev.value_loo_multiple != null ? ev.value_loo_multiple.toFixed(2) : '8.25') +
      ' against &times;' + (ev.flat_loo_multiple != null ? ev.flat_loo_multiple.toFixed(2) : '10.07') + ' for a flat multiple, and the odds fit\'s leave-one-out Brier score is ' +
      (ev.odds_loo_brier != null ? ev.odds_loo_brier.toFixed(4) : '0.2088') + ' against ' + (ev.odds_base_loo_brier != null ? ev.odds_base_loo_brier.toFixed(4) : '0.2483') +
      ' for the base rate. Walk-forward on listing-date order, the same fits score &times;' + (ev.value_wf_multiple != null ? ev.value_wf_multiple.toFixed(2) : '10.25') +
      ' and ' + (ev.odds_wf_brier != null ? ev.odds_wf_brier.toFixed(4) : '0.2462') + '. The working above is the board\'s arithmetic, replayed.</p>' +
      '</section></div>' +
      '<section class="card"><h3>The farm plan</h3>' +
      '<p class="netting">Plan netting: about $' + (Math.round(r.farm_gas_usd * 100) / 100) + ' of gas and about ' + hours +
      ' hours of work (' + commas(r.farm_minutes) + ' minutes) across the hold, against ' + money(r.implied_value_usd) +
      ' of expected value at stake on the model. Gas per $1,000 of expected value: ' + rateText(gasRate(r)) +
      '. Farm triage: ' + tierOf(r) + '.</p><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></section>';
  }

  // The compare tray: up to three pinned protocols, side by side, each with
  // its figures and the shipped fit's working in compact form.
  function renderTray() {
    var tray = document.getElementById('tray');
    tray.hidden = pins.length === 0;
    document.getElementById('tray-grid').innerHTML = pins.map(function (slug) {
      var r = bySlug[slug];
      display.forEach(function (x) { if (x.slug === slug) r = x; });
      var s = bySlug[slug];
      var vp = s.value_log_parts;
      var lp = s.logit_parts;
      var logSum = (vp.intercept + vp.size + vp.category).toFixed(6);
      var logitSum = (lp.intercept + lp.size + lp.age + lp.growth + lp.category).toFixed(6);
      return '<article class="tray-card"><h3>' + esc(r.name) +
        '<button type="button" class="unpin" data-unpin="' + esc(slug) + '">Unpin</button></h3>' +
        '<p class="lcat">Rank ' + r.rank + ' - ' + esc(r.category || 'Uncategorised') + '</p>' +
        '<dl>' +
        '<div><dt>TVL</dt><dd>' + compact(r.tvl_usd) + '</dd></div>' +
        '<div><dt>Fitted value</dt><dd>' + compact(r.fitted_value_usd) + '</dd></div>' +
        '<div><dt>Launch odds</dt><dd>' + pct(r.launch_odds) + '</dd></div>' +
        '<div><dt>Expected value</dt><dd>' + compact(r.implied_value_usd) + '</dd></div>' +
        '<div><dt>Multiple</dt><dd>' + multText(r) + '</dd></div>' +
        '<div><dt>Gas / $1k EV</dt><dd>' + rateText(gasRate(r)) + '</dd></div>' +
        '<div><dt>Triage</dt><dd>' + tierOf(r) + '</dd></div>' +
        '<div><dt>Farm time</dt><dd>' + commas(r.farm_minutes) + ' min</dd></div>' +
        '</dl>' +
        '<p class="tray-work">Shipped working: ln value = ' + vp.intercept.toFixed(6) + ' ' + signed6(vp.size) + ' ' + signed6(vp.category) + ' = ' + logSum +
        '<br>logit odds = ' + lp.intercept.toFixed(6) + ' ' + signed6(lp.size) + ' ' + signed6(lp.age) + ' ' + signed6(lp.growth) + ' ' + signed6(lp.category) + ' = ' + logitSum + '</p></article>';
    }).join('');
  }
  function togglePin(slug) {
    var at = pins.indexOf(slug);
    if (at >= 0) pins.splice(at, 1);
    else { if (pins.length >= 3) pins.shift(); pins.push(slug); }
    renderBoard();
    renderTray();
  }

  /*REFIT-BEGIN*/
  // The two fits, ported from the pipeline's lib/fit.ts operation for
  // operation (same accumulation order, same rounding of the printed parts),
  // so the page can refit both models from the audit data and the check can
  // compare the result with the shipped board figure for figure.
  function rfClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function rfRound6(v) { return Math.round(v * 1e6) / 1e6; }
  function rfSigmoid(eta) { return 1 / (1 + Math.exp(-rfClamp(eta, -30, 30))); }
  function rfDot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function rfSolve(A, b) {
    var n = A.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      var d = M[c][c];
      if (Math.abs(d) < 1e-12) return null;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c] / d;
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / M[i][i]; });
  }
  function rfOls(X, y) {
    var k = X[0].length;
    var XtX = [];
    var Xty = [];
    for (var a0 = 0; a0 < k; a0++) { XtX.push(new Array(k).fill(0)); Xty.push(0); }
    for (var i = 0; i < X.length; i++) {
      for (var a = 0; a < k; a++) {
        Xty[a] += X[i][a] * y[i];
        for (var b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
      }
    }
    return rfSolve(XtX, Xty);
  }
  function rfLogit(X, y) {
    var k = X[0].length;
    var beta = new Array(k).fill(0);
    for (var it = 0; it < 50; it++) {
      var g = new Array(k).fill(0);
      var H = [];
      for (var a0 = 0; a0 < k; a0++) H.push(new Array(k).fill(0));
      for (var i = 0; i < X.length; i++) {
        var p = rfSigmoid(rfDot(X[i], beta));
        var w = Math.max(p * (1 - p), 1e-9);
        for (var a = 0; a < k; a++) {
          g[a] += X[i][a] * (y[i] - p);
          for (var b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
        }
      }
      for (var a2 = 1; a2 < k; a2++) H[a2][a2] += 1e-4;
      var step = rfSolve(H, g);
      if (!step) return beta;
      beta = beta.map(function (v, j) { return v + step[j]; });
      if (Math.max.apply(null, step.map(Math.abs)) < 1e-9) break;
    }
    return beta;
  }
  function rfMedian(vals) {
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function rfZ(vals) {
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) ** 2; }, 0) / vals.length) || 1;
    return { mean: mean, sd: sd };
  }
  // Refit both models from the audit entries and reprice the priced ones.
  // opts: {vShrink, oShrink, vCat, oCat, flat}. Returns slug -> priced parts.
  function rfRefit(opts) {
    var peers = audit.filter(function (a) { return a.status === 'trading' && (a.mcap_usd || 0) > 0 && a.tvl_usd > 0; });
    var yv = peers.map(function (p) { return Math.log(p.mcap_usd); });
    var vBeta = rfOls(peers.map(function (p) { return [1, Math.log(p.tvl_usd)]; }), yv);
    var vOff = {};
    if (opts.vCat) {
      var acc = {};
      peers.forEach(function (p, j) {
        var key = p.category == null ? '' : p.category;
        var r = yv[j] - rfDot([1, Math.log(p.tvl_usd)], vBeta);
        if (!acc[key]) acc[key] = { s: 0, n: 0 };
        acc[key].s += r; acc[key].n++;
      });
      Object.keys(acc).forEach(function (key) { vOff[key] = acc[key].s / (acc[key].n + opts.vShrink); });
    }
    var flatMult = rfMedian(peers.map(function (p) { return rfClamp(p.mcap_usd / p.tvl_usd, 0.01, 2); }));
    var n = audit.length;
    var yo = audit.map(function (a) { return a.status === 'trading' ? 1 : 0; });
    var launched = yo.reduce(function (a, b) { return a + b; }, 0);
    var baseRate = launched / n;
    var baseLogit = Math.log(baseRate / (1 - baseRate));
    var logTvl = audit.map(function (a) { return Math.log(a.tvl_usd); });
    var ageYears = audit.map(function (a) { return Math.min(a.age_days == null ? 365 : a.age_days, 1825) / 365; });
    var growth = audit.map(function (a) { return rfClamp(a.change_7d == null ? 0 : a.change_7d, -60, 120) / 100; });
    var zx = rfZ(logTvl);
    var za = rfZ(ageYears);
    var zg = rfZ(growth);
    function orow(i) {
      return [1, (logTvl[i] - zx.mean) / zx.sd, (ageYears[i] - za.mean) / za.sd, (growth[i] - zg.mean) / zg.sd];
    }
    var oBeta = rfLogit(audit.map(function (_, i) { return orow(i); }), yo);
    var oOff = {};
    if (opts.oCat) {
      var cnt = {};
      var hit = {};
      audit.forEach(function (a, i) {
        var key = a.category == null ? '' : a.category;
        cnt[key] = (cnt[key] || 0) + 1;
        hit[key] = (hit[key] || 0) + yo[i];
      });
      Object.keys(cnt).forEach(function (key) {
        var pr = ((hit[key] || 0) + opts.oShrink * baseRate) / (cnt[key] + opts.oShrink);
        oOff[key] = Math.log(pr / (1 - pr)) - baseLogit;
      });
    }
    var priced = {};
    audit.forEach(function (a, i) {
      if (a.status !== 'priced') return;
      var key = a.category == null ? '' : a.category;
      var fitted;
      if (opts.flat) {
        fitted = Math.round(flatMult * a.tvl_usd);
      } else {
        var vsum = rfRound6(vBeta[0]) + rfRound6(vBeta[1] * Math.log(a.tvl_usd)) + rfRound6(opts.vCat ? (vOff[key] || 0) : 0);
        fitted = Math.round(Math.exp(vsum));
      }
      var osum = rfRound6(oBeta[0]) +
        rfRound6(oBeta[1] * ((logTvl[i] - zx.mean) / zx.sd)) +
        rfRound6(oBeta[2] * ((ageYears[i] - za.mean) / za.sd)) +
        rfRound6(oBeta[3] * ((growth[i] - zg.mean) / zg.sd)) +
        rfRound6(opts.oCat ? (oOff[key] || 0) : 0);
      var odds = rfRound6(rfSigmoid(osum));
      priced[a.slug] = { fitted_value_usd: fitted, launch_odds: odds, implied_value_usd: Math.round(fitted * odds) };
    });
    return priced;
  }
  /*REFIT-END*/

  var rfState = { vShrink: 20, oShrink: 10, vCat: true, oCat: true, flat: false };
  function rfIsDefault() {
    return rfState.vShrink === 20 && rfState.oShrink === 10 && rfState.vCat && rfState.oCat && !rfState.flat;
  }
  function runRefit() {
    var priced = rfRefit(rfState);
    var match = 0;
    rows.forEach(function (r) {
      var p = priced[r.slug];
      if (p && p.fitted_value_usd === r.fitted_value_usd && p.launch_odds === r.launch_odds && p.implied_value_usd === r.implied_value_usd) match++;
    });
    var checkEl = document.getElementById('refit-check');
    if (rfIsDefault()) {
      checkEl.textContent = 'Refit check at the shipped settings: ' + match + ' of ' + rows.length +
        ' priced rows reproduce the shipped board exactly - fitted value, launch odds and expected value.' +
        (match === rows.length ? ' The board above is the shipped board.' : ' The board above is still the shipped board; the refit differs on ' + (rows.length - match) + ' rows in this browser.');
      display = rows;
    } else {
      checkEl.textContent = 'At these settings the refit reprices the board: ' + (rows.length - match) + ' of ' + rows.length +
        ' rows change expected value, ' + match + ' are unchanged. The board above shows the refit ranking;' +
        ' each row\'s detail view still replays the shipped fit.';
      var list = rows.map(function (r) {
        var p = priced[r.slug];
        var copy = {};
        for (var k in r) copy[k] = r[k];
        copy.fitted_value_usd = p.fitted_value_usd;
        copy.launch_odds = p.launch_odds;
        copy.implied_value_usd = p.implied_value_usd;
        return copy;
      });
      list.sort(function (a, b) {
        return b.implied_value_usd - a.implied_value_usd || b.fitted_value_usd - a.fitted_value_usd || (a.slug < b.slug ? -1 : 1);
      });
      list.forEach(function (r, i) { r.rank = i + 1; });
      display = list;
    }
    renderBoard();
    renderTray();
  }

  function route() {
    var m = /^#\/protocol\/(.+)$/.exec(location.hash);
    var r = m ? bySlug[decodeURIComponent(m[1])] : null;
    if (r) {
      document.getElementById('detail').innerHTML = detail(r);
      boardView.hidden = true;
      detailView.hidden = false;
      window.scrollTo(0, 0);
    } else {
      detailView.hidden = true;
      boardView.hidden = false;
    }
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  document.getElementById('floor-only').addEventListener('change', function (e) { state.floorOnly = e.target.checked; renderBoard(); });
  document.getElementById('min-tvl').addEventListener('input', function (e) {
    var v = parseFloat(e.target.value);
    state.minTvl = isNaN(v) || v < 0 ? 0 : v;
    renderBoard();
  });
  document.querySelectorAll('#board thead th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) { state.sortDir = -state.sortDir; }
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'tier' ? 1 : -1; if (key === 'rank') state.sortDir = 1; }
      renderBoard();
    });
  });
  document.getElementById('rows').addEventListener('click', function (e) {
    var pin = e.target.closest('[data-pin]');
    if (pin) { togglePin(pin.getAttribute('data-pin')); return; }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  document.getElementById('tray-grid').addEventListener('click', function (e) {
    var un = e.target.closest('[data-unpin]');
    if (un) togglePin(un.getAttribute('data-unpin'));
  });
  document.getElementById('rf-vshrink').addEventListener('input', function (e) {
    rfState.vShrink = parseInt(e.target.value, 10);
    document.getElementById('rf-vshrink-v').textContent = e.target.value;
    runRefit();
  });
  document.getElementById('rf-oshrink').addEventListener('input', function (e) {
    rfState.oShrink = parseInt(e.target.value, 10);
    document.getElementById('rf-oshrink-v').textContent = e.target.value;
    runRefit();
  });
  document.getElementById('rf-vcat').addEventListener('change', function (e) { rfState.vCat = e.target.checked; runRefit(); });
  document.getElementById('rf-ocat').addEventListener('change', function (e) { rfState.oCat = e.target.checked; runRefit(); });
  document.getElementById('rf-flat').addEventListener('change', function (e) { rfState.flat = e.target.checked; runRefit(); });
  document.getElementById('rf-reset').addEventListener('click', function () {
    rfState = { vShrink: 20, oShrink: 10, vCat: true, oCat: true, flat: false };
    document.getElementById('rf-vshrink').value = '20';
    document.getElementById('rf-vshrink-v').textContent = '20';
    document.getElementById('rf-oshrink').value = '10';
    document.getElementById('rf-oshrink-v').textContent = '10';
    document.getElementById('rf-vcat').checked = true;
    document.getElementById('rf-ocat').checked = true;
    document.getElementById('rf-flat').checked = false;
    runRefit();
  });
  document.getElementById('audit-seg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-status]');
    if (!b) return;
    auditState.status = b.getAttribute('data-status');
    document.querySelectorAll('#audit-seg button').forEach(function (x) {
      x.classList.toggle('on', x === b);
    });
    renderAudit();
  });
  document.getElementById('audit-q').addEventListener('input', function (e) { auditState.q = e.target.value; renderAudit(); });
  document.getElementById('audit-rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', route);

  runRefit();
  renderAudit();
  route();
})();

