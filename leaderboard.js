/**
 * Leaderboard — single tier view with pagination (50 per page)
 * Resolves player names (Riot ID) progressively via batch endpoint.
 */
(function () {
  'use strict';

  const DDRAGON_VERSION = '16.6.1';
  const DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  const PAGE_SIZE = 50;

  const TIER_CONFIG = {
    challenger:  { icon: '👑', color: '#f59e0b', headerClass: 'challenger-header', accentClass: 'challenger-accent' },
    grandmaster: { icon: '🔴', color: '#ef4444', headerClass: 'grandmaster-header', accentClass: 'grandmaster-accent' },
    master:      { icon: '🟣', color: '#a855f7', headerClass: 'master-header',      accentClass: 'master-accent' },
  };

  // DOM
  const regionSelect = document.getElementById('regionSelect');
  const tierSelect = document.getElementById('tierSelect');
  const loadBtn = document.getElementById('loadBtn');
  const playerSearch = document.getElementById('playerSearch');
  const summaryStats = document.getElementById('summaryStats');
  const statCard = document.getElementById('statCard');
  const statLabel = document.getElementById('statLabel');
  const statValue = document.getElementById('statValue');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const tableWrap = document.getElementById('tableWrap');
  const tierHeader = document.getElementById('tierHeader');
  const tierIcon = document.getElementById('tierIcon');
  const tierName = document.getElementById('tierName');
  const tierCount = document.getElementById('tierCount');
  const tableBody = document.getElementById('tableBody');
  const pagination = document.getElementById('pagination');

  // State
  let allEntries = [];
  let currentPage = 1;
  let sortState = { key: 'lp', dir: 'desc' };
  let nameResolveAbort = null;
  const nameCache = {};

  // ── Events ───────────────────────────
  loadBtn.addEventListener('click', loadLeaderboard);

  let searchTimeout;
  playerSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      renderPage();
    }, 250);
  });

  document.querySelectorAll('.tier-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = key === 'name' ? 'asc' : 'desc';
      }
      currentPage = 1;
      renderPage();
    });
  });

  // ── Load ─────────────────────────────
  async function loadLeaderboard() {
    const region = regionSelect.value;
    const tier = tierSelect.value;
    const cfg = TIER_CONFIG[tier];

    loadBtn.disabled = true;
    loadingState.style.display = 'flex';
    errorState.style.display = 'none';
    summaryStats.style.display = 'none';
    tableWrap.style.display = 'none';

    if (nameResolveAbort) nameResolveAbort.abort = true;

    try {
      const resp = await fetch(`/api/league/${tier}?region=${encodeURIComponent(region)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const entries = data.entries || [];
      entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
      entries.forEach((e, idx) => {
        e._rank = idx + 1;
        e._wr = e.wins + e.losses > 0 ? (e.wins / (e.wins + e.losses)) * 100 : 0;
        e._displayName = nameCache[e.puuid] || null;
      });

      allEntries = entries;
      currentPage = 1;
      sortState = { key: 'lp', dir: 'desc' };

      // Update header visuals
      tierHeader.className = `tier-header ${cfg.headerClass}`;
      tierIcon.textContent = cfg.icon;
      tierName.textContent = capitalize(tier);
      tierName.style.color = cfg.color;
      tierCount.textContent = entries.length;

      // Summary stat
      statCard.className = `stat-card ${cfg.accentClass}`;
      statLabel.textContent = capitalize(tier);
      statValue.textContent = `${entries.length} players`;

      // Show
      loadingState.style.display = 'none';
      summaryStats.style.display = 'flex';
      tableWrap.style.display = 'block';

      renderPage();
      resolveVisibleNames(region);
    } catch (err) {
      loadingState.style.display = 'none';
      errorState.style.display = 'block';
      errorMessage.textContent = `Failed to load: ${err.message}`;
    } finally {
      loadBtn.disabled = false;
    }
  }

  // ── Filtering + sorting + pagination ──
  function getFilteredSorted() {
    const searchTerm = playerSearch.value.trim().toLowerCase();
    let data = [...allEntries];

    // Filter by search
    if (searchTerm) {
      data = data.filter((e) => {
        const name = (e._displayName || '').toLowerCase();
        return name.includes(searchTerm);
      });
    }

    // Sort
    data.sort((a, b) => {
      let va, vb;
      switch (sortState.key) {
        case 'rank': va = a._rank; vb = b._rank; break;
        case 'name':
          va = (a._displayName || '\uffff').toLowerCase();
          vb = (b._displayName || '\uffff').toLowerCase();
          break;
        case 'lp': va = a.leaguePoints; vb = b.leaguePoints; break;
        case 'wins': va = a.wins; vb = b.wins; break;
        case 'losses': va = a.losses; vb = b.losses; break;
        case 'wr': va = a._wr; vb = b._wr; break;
        default: va = a._rank; vb = b._rank;
      }
      if (typeof va === 'string') {
        return sortState.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortState.dir === 'asc' ? va - vb : vb - va;
    });

    return data;
  }

  function renderPage() {
    const data = getFilteredSorted();
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    // Update sort indicators
    document.querySelectorAll('.tier-table th[data-sort]').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === sortState.key) {
        th.classList.add(sortState.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });

    // Build rows
    const fragment = document.createDocumentFragment();
    pageData.forEach((entry) => {
      const wr = entry._wr.toFixed(1);
      const wrClass = entry._wr >= 60 ? 'wr-high' : entry._wr >= 50 ? 'wr-mid' : 'wr-low';
      const name = entry._displayName || 'Loading...';
      const isResolved = !!entry._displayName;

      const tr = document.createElement('tr');

      // Rank
      const rankTd = document.createElement('td');
      rankTd.className = 'col-rank';
      if (entry._rank <= 3) {
        rankTd.innerHTML = `<span class="rank-badge rank-${entry._rank}">${entry._rank}</span>`;
      } else {
        rankTd.textContent = entry._rank;
      }
      tr.appendChild(rankTd);

      // Name
      const nameTd = document.createElement('td');
      nameTd.className = 'col-name';
      if (isResolved) {
        nameTd.textContent = name;
      } else {
        nameTd.innerHTML = '<span class="name-loading">Loading\u2026</span>';
      }
      tr.appendChild(nameTd);

      // LP
      const lpTd = document.createElement('td');
      lpTd.className = 'col-lp';
      lpTd.textContent = entry.leaguePoints.toLocaleString();
      tr.appendChild(lpTd);

      // Wins
      const winsTd = document.createElement('td');
      winsTd.className = 'col-wins';
      winsTd.textContent = entry.wins;
      tr.appendChild(winsTd);

      // Losses
      const lossesTd = document.createElement('td');
      lossesTd.className = 'col-losses';
      lossesTd.textContent = entry.losses;
      tr.appendChild(lossesTd);

      // WR
      const wrTd = document.createElement('td');
      wrTd.className = `col-wr ${wrClass}`;
      wrTd.textContent = `${wr}%`;
      tr.appendChild(wrTd);

      // Click to expand champion pool
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => togglePlayerExpand(tr, entry.puuid));

      fragment.appendChild(tr);
    });

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);

    // Render pagination
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }

    let html = '';

    // Prev button
    html += `<button class="page-btn ${currentPage === 1 ? 'disabled' : ''}" data-page="${currentPage - 1}"${currentPage === 1 ? ' disabled' : ''}>&laquo; Prev</button>`;

    // Page numbers (show max 7 with ellipsis)
    const pages = buildPageNumbers(currentPage, totalPages, 7);
    pages.forEach((p) => {
      if (p === '...') {
        html += '<span class="page-ellipsis">…</span>';
      } else {
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }
    });

    // Next button
    html += `<button class="page-btn ${currentPage === totalPages ? 'disabled' : ''}" data-page="${currentPage + 1}"${currentPage === totalPages ? ' disabled' : ''}>Next &raquo;</button>`;

    pagination.innerHTML = html;

    // Attach click handlers
    pagination.querySelectorAll('.page-btn:not(.disabled)').forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        if (page >= 1 && page <= totalPages && page !== currentPage) {
          currentPage = page;
          renderPage();
          // Scroll table into view
          tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function buildPageNumbers(current, total, maxVisible) {
    if (total <= maxVisible) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    const half = Math.floor(maxVisible / 2);
    let start = Math.max(2, current - half);
    let end = Math.min(total - 1, current + half);

    if (current <= half + 1) {
      end = maxVisible - 1;
    }
    if (current >= total - half) {
      start = total - maxVisible + 2;
    }

    pages.push(1);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push('...');
    pages.push(total);

    return pages;
  }

  // ── Name resolution (visible page first) ──
  async function resolveVisibleNames(region) {
    const controller = { abort: false };
    nameResolveAbort = controller;

    // Resolve all puuids, but prioritize first page
    const unresolved = allEntries
      .filter((e) => !nameCache[e.puuid])
      .map((e) => e.puuid);

    const BATCH_SIZE = 8;
    for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
      if (controller.abort) return;

      const batch = unresolved.slice(i, i + BATCH_SIZE);

      try {
        const resp = await fetch('/api/accounts/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ puuids: batch, region }),
        });

        if (resp.ok) {
          const results = await resp.json();
          let changed = false;

          for (const [puuid, info] of Object.entries(results)) {
            if (info.gameName) {
              const riotId = `${info.gameName}#${info.tagLine}`;
              nameCache[puuid] = riotId;
              allEntries.forEach((entry) => {
                if (entry.puuid === puuid) {
                  entry._displayName = riotId;
                  changed = true;
                }
              });
            }
          }

          if (changed) updateNameCells();
        }
      } catch {
        // Continue
      }

      if (i + BATCH_SIZE < unresolved.length) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }

  // ── Update name cells in-place (avoids destroying expand rows) ──
  function updateNameCells() {
    const rows = tableBody.querySelectorAll('tr:not(.player-expand-row)');
    const data = getFilteredSorted();
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    rows.forEach((row, i) => {
      if (!pageData[i]) return;
      const entry = pageData[i];
      const nameTd = row.querySelector('.col-name');
      if (!nameTd) return;
      if (entry._displayName && nameTd.querySelector('.name-loading')) {
        nameTd.textContent = entry._displayName;
      }
    });
  }

  // ── Player expand (champion pool) ───
  const playerExpandCache = {};

  async function togglePlayerExpand(tr, puuid) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('player-expand-row')) {
      existing.remove();
      return;
    }

    tr.closest('tbody').querySelectorAll('.player-expand-row').forEach((r) => r.remove());

    const region = regionSelect.value;
    const expandRow = document.createElement('tr');
    expandRow.className = 'player-expand-row';
    const expandTd = document.createElement('td');
    expandTd.colSpan = 6;
    expandTd.innerHTML = '<div class="expand-loading"><div class="expand-spinner"></div> Loading champion pool\u2026</div>';
    expandRow.appendChild(expandTd);
    tr.after(expandRow);

    const cacheKey = `${puuid}-${region}`;
    if (playerExpandCache[cacheKey]) {
      renderExpandContent(expandTd, playerExpandCache[cacheKey]);
      return;
    }

    try {
      const resp = await fetch(
        `/api/player-champions/${encodeURIComponent(puuid)}?region=${encodeURIComponent(region)}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      playerExpandCache[cacheKey] = data;
      renderExpandContent(expandTd, data);
    } catch (err) {
      expandTd.innerHTML = `<div class="expand-error">Failed to load: ${err.message}</div>`;
    }
  }

  function renderExpandContent(td, data) {
    if (!data.champions || data.champions.length === 0) {
      td.innerHTML = '<div class="expand-empty">No recent ranked games found</div>';
      return;
    }

    const champs = data.champions.slice(0, 8);
    let html = '<div class="expand-content">';
    html += `<div class="expand-header">Champion Pool \u00b7 ${data.totalGames} recent games</div>`;
    html += '<div class="expand-champs">';

    champs.forEach((c) => {
      const iconUrl = `${DDRAGON_BASE}/img/champion/${c.name}.png`;
      const wrClass = c.winRate >= 60 ? 'wr-high' : c.winRate >= 50 ? 'wr-mid' : 'wr-low';
      html += `<div class="expand-champ">
        <img class="expand-champ-icon" src="${iconUrl}" alt="${c.name}" onerror="this.style.display='none'">
        <div class="expand-champ-info">
          <span class="expand-champ-name">${c.name}</span>
          <span class="expand-champ-stats">${c.games}G \u00b7 <span class="${wrClass}">${c.winRate}%</span> \u00b7 ${c.avgKills}/${c.avgDeaths}/${c.avgAssists}</span>
        </div>
      </div>`;
    });

    html += '</div></div>';
    td.innerHTML = html;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Auto-load default leaderboard on page enter
  loadLeaderboard();
})();
