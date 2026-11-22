// Token Launch Radar dashboard. Renders window.RADAR_DATA (written next to this
// folder by the pipeline as dashboard-data.js, the same figures board.json
// carries) as a sortable, filterable board with a per-protocol detail view.
// No imports, no fetching: the page works on the sealed snapshot alone.

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

  var state = { q: '', cat: '', chain: '', watchOnly: false, floorOnly: false, sortKey: 'rank', sortDir: 1 };

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
  function changeCell(r) {
    if (r.change_7d == null) return '<span class="flat">n/r</span>';
    var cls = r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
    var sign = r.change_7d > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + r.change_7d.toFixed(2) + '%</span>';
  }

  // Header stats and model line.
  document.getElementById('as-of').textContent = data.as_of;
  document.getElementById('model-id').textContent = data.model;
  var stats = [
    ['Pre-token, ranked', rows.length],
    ['House watchlist', data.watchlist_size],
    ['Watchlist floor', compact(data.floor_usd)],
    ['Snapshot protocols', '758'],
    ['Board total, implied', compact(rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0))],
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
      multiple: function (r) { return r.multiple; },
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
        '<td class="num">' + r.multiple.toFixed(3) + '</td>' +
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

  function detail(r) {
    var s1 = r.multiple * r.tvl_usd;
    var s2 = s1 * r.scale_factor;
    var s3 = s2 * r.growth_factor;
    var stages = [
      ['Category multiple (' + esc(r.category || 'Uncategorised') + ', market cap per $1 of TVL among tokenised peers)', r.multiple.toFixed(6)],
      ['x TVL', money(s1)],
      ['x scale ' + r.scale_factor.toFixed(6) + ' (TVL^0.85: size counts, at a discount)', money(s2)],
      ['x growth ' + r.growth_factor.toFixed(6) + ' (7d TVL change ' + (r.change_7d == null ? 'not reported, counted as flat' : r.change_7d.toFixed(2) + '%') + ', at half weight)', money(s3)],
      ['x maturity ' + r.maturity_factor.toFixed(6) + ' (' + (r.age_days == null ? 'age unknown, priced at 365 days' : commas(r.age_days) + ' days tracked with no token') + ')', money(Math.round(s3 * r.maturity_factor))],
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
    return '<div class="detail-head"><h2>' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WL</span>' : '') + '</h2>' +
      '<p class="dsub">' + esc(r.slug) + ' - pre-token on the snapshot of ' + esc(data.as_of) + '. Implied value ' +
      '<strong>' + money(r.implied_value_usd) + '</strong> under the stated model.</p></div>' +
      '<div class="detail-grid"><section class="card"><h3>The record</h3><dl class="facts">' +
      facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
      '</dl></section>' +
      '<section class="card"><h3>The working</h3><table class="working">' +
      stages.map(function (s) { return '<tr><td class="wlabel">' + s[0] + '</td><td class="wval">' + s[1] + '</td></tr>'; }).join('') +
      '<tr class="total"><td class="wlabel">Implied value, as ranked on the board</td><td class="wval">' + money(r.implied_value_usd) + '</td></tr>' +
      '</table></section></div>' +
      '<section class="card"><h3>The farm plan</h3><ol class="farm">' +
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
  window.addEventListener('hashchange', route);

  renderBoard();
  route();
})();
