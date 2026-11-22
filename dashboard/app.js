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

  var state = { q: '', cat: '', chain: '', watchOnly: false, floorOnly: false, sortKey: 'rank', sortDir: 1 };
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
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.floorOnly && r.tvl_usd < data.floor_usd) return false;
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
      odds: function (r) { return r.launch_odds; },
      implied: function (r) { return r.implied_value_usd; },
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
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
    document.getElementById('empty').hidden = list.length > 0;
    document.getElementById('rows').innerHTML = list.map(function (r) {
      var chainText = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WL</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + esc(chainText) + '</td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + compact(r.fitted_value_usd) + '</td>' +
        '<td class="num">' + pct(r.launch_odds) + '</td>' +
        '<td class="num implied">' + compact(r.implied_value_usd) + '</td></tr>';
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
      ' for the base rate. The working above is the board\'s arithmetic, replayed.</p>' +
      '</section></div>' +
      '<section class="card"><h3>The farm plan</h3>' +
      '<p class="netting">Plan netting: about $' + (Math.round(r.farm_gas_usd * 100) / 100) + ' of gas and about ' + hours +
      ' hours of work (' + commas(r.farm_minutes) + ' minutes) across the hold, against ' + money(r.implied_value_usd) +
      ' of expected value at stake on the model.</p><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></section>';
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
  document.querySelectorAll('#board thead th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) { state.sortDir = -state.sortDir; }
      else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; if (key === 'rank') state.sortDir = 1; }
      renderBoard();
    });
  });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'));
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

  renderBoard();
  renderAudit();
  route();
})();

