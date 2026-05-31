/**
 * Tier List — LoLalytics-style champion tier list
 */
(function () {
  'use strict';

  // Data Dragon — version resolved dynamically inside loadPatches()
  let DDRAGON_VERSION = '16.6.1'; // fallback
  let DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  // DOM refs
  const patchTitle = document.getElementById('patchTitle');
  const regionSelect = document.getElementById('regionSelect');
  const patchSelect = document.getElementById('patchSelect');
  const champSearch = document.getElementById('champSearch');
  const summaryBar = document.getElementById('summaryBar');
  const avgWinRateEl = document.getElementById('avgWinRate');
  const totalChampionsEl = document.getElementById('totalChampions');
  const totalGamesEl = document.getElementById('totalGames');
  const sampleSizeEl = document.getElementById('sampleSize');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const tableWrap = document.getElementById('tableWrap');
  const tableBody = document.getElementById('tableBody');

  let currentData = null;
  let activeLane = 'ALL';
  let activeRank = 'emerald';
  let sortKey = 'tier';
  let sortAsc = false;
  let isLoading = false;

  const laneLabels = { TOP: 'TOP', JUNGLE: 'JNG', MID: 'MID', BOT: 'BOT', SUP: 'SUP', NONE: '—' };

  // ── Load patch versions ─────────────
  async function loadPatches() {
    try {
      const resp = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      if (!resp.ok) return;
      const versions = await resp.json();
      if (versions?.[0]) {
        DDRAGON_VERSION = versions[0];
        DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;
      }
      const seen = new Set();
      const patches = [];
      for (const v of versions) {
        const parts = v.split('.');
        if (parts.length < 2) continue;
        const mm = parts[0] + '.' + parts[1];
        if (!seen.has(mm)) { seen.add(mm); patches.push(mm); }
        if (patches.length >= 8) break;
      }
      patches.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = 'Patch ' + p;
        patchSelect.appendChild(opt);
      });
    } catch { /* silent */ }
  }
  loadPatches();

  // ── Lane tabs ───────────────────────
  document.querySelectorAll('.lane-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelector('.lane-tab.active').classList.remove('active');
      tab.classList.add('active');
      activeLane = tab.dataset.lane;
      renderTable();
    });
  });

  // ── Rank pills (auto-fetch on click) ─
  document.querySelectorAll('.rank-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelector('.rank-pill.active').classList.remove('active');
      pill.classList.add('active');
      activeRank = pill.dataset.rank;
      fetchData();
    });
  });

  // ── Region & Patch changes ──────────
  regionSelect.addEventListener('change', fetchData);
  patchSelect.addEventListener('change', fetchData);

  // ── Search ──────────────────────────
  let searchTimeout;
  champSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderTable, 200);
  });

  // ── Column header sorting ───────────
  document.querySelectorAll('.tl-table th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = thToSortKey(th);
      if (!key) return;
      if (sortKey === key) { sortAsc = !sortAsc; }
      else { sortKey = key; sortAsc = false; }
      document.querySelectorAll('.tl-table th').forEach((h) => h.classList.remove('sort-active'));
      th.classList.add('sort-active');
      renderTable();
    });
  });

  function thToSortKey(th) {
    if (th.classList.contains('th-rank')) return 'tier';
    if (th.classList.contains('th-champ')) return 'name';
    if (th.classList.contains('th-tier')) return 'tier';
    if (th.classList.contains('th-wr')) return 'winRate';
    if (th.classList.contains('th-pick')) return 'pickRate';
    if (th.classList.contains('th-ban')) return 'banRate';
    if (th.classList.contains('th-games')) return 'games';
    return null;
  }

  // ── Fetch data ──────────────────────
  async function fetchData() {
    if (isLoading) return;
    isLoading = true;

    const region = regionSelect.value;
    const patch = patchSelect.value;

    loadingState.style.display = 'flex';
    errorState.style.display = 'none';
    summaryBar.style.display = 'none';
    tableWrap.style.display = 'none';

    try {
      const params = new URLSearchParams({ region, minRank: activeRank });
      if (patch) params.set('patch', patch);

      const resp = await fetch(`/api/champion-meta?${params}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      currentData = await resp.json();

      // Update header
      const patchLabel = currentData.patch && currentData.patch !== 'all'
        ? `LEAGUE OF LEGENDS PATCH ${currentData.patch}`
        : 'LEAGUE OF LEGENDS';
      patchTitle.textContent = patchLabel;

      // Summary
      avgWinRateEl.textContent = currentData.avgWinRate + '%';
      totalChampionsEl.textContent = currentData.champions.length;
      totalGamesEl.textContent = formatNum(currentData.totalGames);
      sampleSizeEl.textContent = currentData.sampleSize;

      loadingState.style.display = 'none';
      summaryBar.style.display = 'flex';
      tableWrap.style.display = 'block';

      renderTable();
    } catch (err) {
      loadingState.style.display = 'none';
      errorState.style.display = 'block';
      errorMessage.textContent = err.message;
    } finally {
      isLoading = false;
    }
  }

  // ── Tier calculation ────────────────
  function computeTier(champ, avgWr) {
    // Score based on win rate deviation and pick rate
    const wrDelta = champ.winRate - avgWr;
    const pickWeight = Math.min(champ.pickRate / 5, 1); // normalize pick rate impact
    const score = wrDelta * 1.5 + champ.pickRate * 0.5 + pickWeight * wrDelta;

    if (score >= 8) return { label: 'S+', css: 'tier-s-plus', order: 1 };
    if (score >= 5) return { label: 'S', css: 'tier-s', order: 2 };
    if (score >= 3) return { label: 'S-', css: 'tier-s-minus', order: 3 };
    if (score >= 1.5) return { label: 'A+', css: 'tier-a-plus', order: 4 };
    if (score >= 0) return { label: 'A', css: 'tier-a', order: 5 };
    if (score >= -1.5) return { label: 'A-', css: 'tier-a-minus', order: 6 };
    if (score >= -3) return { label: 'B', css: 'tier-b', order: 7 };
    if (score >= -5) return { label: 'C', css: 'tier-c', order: 8 };
    return { label: 'D', css: 'tier-d', order: 9 };
  }

  // ── Render table ────────────────────
  function renderTable() {
    if (!currentData) return;

    const searchTerm = champSearch.value.trim().toLowerCase();
    const avgWr = currentData.avgWinRate || 50;

    // Filter by lane
    let champs = currentData.champions.map((c) => ({
      ...c,
      tier: computeTier(c, avgWr),
    }));

    if (activeLane !== 'ALL') {
      champs = champs.filter((c) => c.role === activeLane);
    }

    // Filter by search
    if (searchTerm) {
      champs = champs.filter((c) => c.name.toLowerCase().includes(searchTerm));
    }

    // Sort
    champs.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'tier': cmp = a.tier.order - b.tier.order || b.winRate - a.winRate; break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'winRate': cmp = b.winRate - a.winRate; break;
        case 'pickRate': cmp = b.pickRate - a.pickRate; break;
        case 'banRate': cmp = b.banRate - a.banRate; break;
        case 'games': cmp = b.games - a.games; break;
        default: cmp = a.tier.order - b.tier.order;
      }
      return sortAsc ? -cmp : cmp;
    });

    const fragment = document.createDocumentFragment();

    champs.forEach((champ, i) => {
      const wrClass = champ.winRate >= 53 ? 'wr-high' : champ.winRate >= 49 ? 'wr-mid' : 'wr-low';
      const iconUrl = `${DDRAGON_BASE}/img/champion/${champ.name}.png`;

      const tr = document.createElement('tr');

      // #
      const rankTd = document.createElement('td');
      rankTd.className = 'td-rank';
      rankTd.textContent = i + 1;
      tr.appendChild(rankTd);

      // Champion
      const champTd = document.createElement('td');
      champTd.innerHTML = `<div class="champ-cell">
        <img class="champ-icon" src="${iconUrl}" alt="${champ.name}" onerror="this.style.display='none'">
        <span class="champ-name">${champ.name}</span>
      </div>`;
      tr.appendChild(champTd);

      // Tier
      const tierTd = document.createElement('td');
      tierTd.className = 'td-tier';
      tierTd.innerHTML = `<span class="tier-badge ${champ.tier.css}">${champ.tier.label}</span>`;
      tr.appendChild(tierTd);

      // Lane
      const laneTd = document.createElement('td');
      laneTd.className = 'td-lane';
      laneTd.innerHTML = `<span class="lane-icon">${laneLabels[champ.role] || '—'}</span>`;
      tr.appendChild(laneTd);

      // Win %
      const wrTd = document.createElement('td');
      wrTd.className = `td-wr ${wrClass}`;
      wrTd.textContent = champ.winRate + '%';
      tr.appendChild(wrTd);

      // Pick %
      const pickTd = document.createElement('td');
      pickTd.className = 'td-pick';
      pickTd.textContent = champ.pickRate + '%';
      tr.appendChild(pickTd);

      // Ban %
      const banTd = document.createElement('td');
      banTd.className = 'td-ban' + (champ.banRate >= 10 ? ' ban-high' : '');
      banTd.textContent = champ.banRate + '%';
      tr.appendChild(banTd);

      // Games
      const gamesTd = document.createElement('td');
      gamesTd.className = 'td-games';
      gamesTd.textContent = formatNum(champ.games);
      tr.appendChild(gamesTd);

      fragment.appendChild(tr);
    });

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);
  }

  function formatNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  // Auto-fetch on page load
  fetchData();
})();
