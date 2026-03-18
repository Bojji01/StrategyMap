/**
 * Search Player — look up by Riot ID, display rank, match history, champion pool
 */
(function () {
  'use strict';

  const DDRAGON_VERSION = '16.6.1';
  const DDRAGON = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  const QUEUE_NAMES = {
    420: 'Ranked Solo',
    440: 'Ranked Flex',
    400: 'Normal Draft',
    430: 'Normal Blind',
    450: 'ARAM',
    490: 'Quickplay',
    1700: 'Arena',
  };

  const TIER_ORDER = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'];
  const RANK_IMAGES = {
    CHALLENGER:  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/challenger.svg',
    GRANDMASTER: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/grandmaster.svg',
    MASTER:      'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/master.svg',
    DIAMOND:     'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/diamond.svg',
    EMERALD:     'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/emerald.svg',
    PLATINUM:    'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/platinum.svg',
    GOLD:        'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/gold.svg',
    SILVER:      'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/silver.svg',
    BRONZE:      'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/bronze.svg',
    IRON:        'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/iron.svg',
    UNRANKED:    'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/images/ranked-mini-crests/unranked.svg',
  };

  // DOM refs
  const searchInput = document.getElementById('searchInput');
  const regionSelect = document.getElementById('regionSelect');
  const searchBtn = document.getElementById('searchBtn');
  const loadingState = document.getElementById('loadingState');
  const loadingText = document.getElementById('loadingText');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const profileSection = document.getElementById('profileSection');
  const champPoolSection = document.getElementById('champPoolSection');
  const matchHistorySection = document.getElementById('matchHistorySection');

  // Profile DOM
  const profileIcon = document.getElementById('profileIcon');
  const playerName = document.getElementById('playerName');
  const playerTag = document.getElementById('playerTag');
  const playerLevel = document.getElementById('playerLevel');
  const rankIcon = document.getElementById('rankIcon');
  const rankTier = document.getElementById('rankTier');
  const rankLP = document.getElementById('rankLP');
  const rankWL = document.getElementById('rankWL');
  const rankWR = document.getElementById('rankWR');
  const rankPosition = document.getElementById('rankPosition');
  const positionValue = document.getElementById('positionValue');

  // Champ pool
  const champPoolGames = document.getElementById('champPoolGames');
  const champPoolGrid = document.getElementById('champPoolGrid');

  // Match history
  const matchCount = document.getElementById('matchCount');
  const matchList = document.getElementById('matchList');

  // State for timeline fetches
  let currentPuuid = null;
  let currentRegion = null;

  // Events
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // ── Main search flow ─────────────────
  async function doSearch() {
    const raw = searchInput.value.trim();
    if (!raw) return;

    // Parse "Name#Tag" format
    const hashIdx = raw.lastIndexOf('#');
    let gameName, tagLine;
    if (hashIdx > 0 && hashIdx < raw.length - 1) {
      gameName = raw.substring(0, hashIdx).trim();
      tagLine = raw.substring(hashIdx + 1).trim();
    } else {
      gameName = raw;
      tagLine = regionSelect.value === 'br1' ? 'BR1' : regionSelect.value.toUpperCase();
    }

    const region = regionSelect.value;

    showLoading('Looking up player...');
    hideError();
    hideResults();

    try {
      // 1. Resolve Account (puuid)
      const account = await apiFetch(`/api/account/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?region=${region}`);
      if (!account || !account.puuid) throw new Error('Player not found');

      currentPuuid = account.puuid;
      currentRegion = region;

      showLoading('Fetching summoner profile...');

      // 2. Summoner profile (icon, level)
      const summoner = await apiFetch(`/api/summoner/${encodeURIComponent(account.puuid)}?region=${region}`);

      showLoading('Loading ranked data...');

      // 3. Ranked entries (by puuid)
      const rankedEntries = await apiFetch(`/api/ranked/${encodeURIComponent(account.puuid)}?region=${region}`);

      // Find Solo Queue entry
      const soloQ = Array.isArray(rankedEntries)
        ? rankedEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5')
        : null;

      // 4. Render profile
      renderProfile(account, summoner, soloQ);

      // 5. Rank position (for Chal/GM/Master)
      if (soloQ && ['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(soloQ.tier)) {
        fetchRankPosition(account.puuid, region, soloQ.tier.toLowerCase());
      }

      showLoading('Loading match history...');

      // 6. Match history
      const matches = await apiFetch(`/api/match-history/${encodeURIComponent(account.puuid)}?region=${region}&count=15`);

      hideLoading();
      renderMatchHistory(matches);
      renderChampionPool(matches);

    } catch (err) {
      hideLoading();
      showError(err.message || 'Search failed');
    }
  }

  // ── API helper ───────────────────────
  async function apiFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  // ── Render Profile ───────────────────
  function renderProfile(account, summoner, soloQ) {
    profileSection.style.display = 'block';

    profileIcon.src = `${DDRAGON}/img/profileicon/${summoner.profileIconId}.png`;
    playerName.textContent = account.gameName;
    playerTag.textContent = `#${account.tagLine}`;
    playerLevel.textContent = summoner.summonerLevel;

    if (soloQ) {
      const tier = soloQ.tier;
      const division = soloQ.rank;
      const lp = soloQ.leaguePoints;
      const wins = soloQ.wins;
      const losses = soloQ.losses;
      const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;

      rankIcon.src = RANK_IMAGES[tier] || RANK_IMAGES.UNRANKED;
      rankIcon.style.display = 'block';
      rankTier.textContent = `${capitalize(tier)} ${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : division}`.trim();
      rankLP.textContent = `${lp} LP`;
      rankWL.textContent = `${wins}W ${losses}L`;
      rankWR.textContent = `${wr}% WR`;
      rankWR.className = `rank-wr ${wr >= 60 ? 'high' : wr >= 50 ? 'mid' : 'low'}`;
    } else {
      rankIcon.src = RANK_IMAGES.UNRANKED;
      rankIcon.style.display = 'block';
      rankTier.textContent = 'Unranked';
      rankLP.textContent = '';
      rankWL.textContent = '';
      rankWR.textContent = '';
      rankWR.className = 'rank-wr';
    }
  }

  // ── Rank Position ────────────────────
  async function fetchRankPosition(puuid, region, tier) {
    try {
      const data = await apiFetch(`/api/rank-position/${encodeURIComponent(puuid)}?region=${region}&tier=${tier}`);
      if (data.position) {
        positionValue.textContent = `#${data.position} / ${data.total}`;
        rankPosition.style.display = 'flex';
      }
    } catch {
      // non-critical, ignore
    }
  }

  // ── Champion Pool (from match history) ─
  function renderChampionPool(matches) {
    if (!matches || matches.length === 0) return;

    const champMap = {};
    matches.forEach((m) => {
      const name = m.champion;
      if (!champMap[name]) {
        champMap[name] = { name, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
      }
      champMap[name].games++;
      if (m.win) champMap[name].wins++;
      champMap[name].kills += m.kills;
      champMap[name].deaths += m.deaths;
      champMap[name].assists += m.assists;
    });

    const champions = Object.values(champMap).sort((a, b) => b.games - a.games);

    champPoolGames.textContent = `(${matches.length} games)`;
    champPoolGrid.innerHTML = '';

    champions.forEach((c) => {
      const wr = c.games > 0 ? ((c.wins / c.games) * 100).toFixed(0) : 0;
      const wrClass = wr >= 60 ? 'wr-high' : wr >= 50 ? 'wr-mid' : 'wr-low';
      const kda = c.deaths > 0 ? ((c.kills + c.assists) / c.deaths).toFixed(2) : 'Perfect';

      const el = document.createElement('div');
      el.className = 'champ-pool-item';
      el.innerHTML = `
        <img class="champ-pool-icon" src="${DDRAGON}/img/champion/${c.name}.png"
             onerror="this.src='${DDRAGON}/img/champion/Aatrox.png'" alt="${c.name}" />
        <div class="champ-pool-info">
          <div class="champ-pool-name">${c.name}</div>
          <div class="champ-pool-stats">
            ${c.games}G ${c.wins}W ${c.games - c.wins}L —
            <span class="${wrClass}">${wr}%</span> —
            ${kda} KDA
          </div>
          <div class="champ-pool-bar">
            <div class="champ-pool-bar-fill" style="width:${wr}%;background:${wr >= 60 ? '#22c55e' : wr >= 50 ? '#eab308' : '#ef4444'}"></div>
          </div>
        </div>
      `;
      champPoolGrid.appendChild(el);
    });

    champPoolSection.style.display = 'block';
  }

  // ── Match History ────────────────────
  function renderMatchHistory(matches) {
    if (!matches || matches.length === 0) return;

    matchCount.textContent = `(${matches.length} games)`;
    matchList.innerHTML = '';

    matches.forEach((m) => {
      const isWin = m.win;
      const kda = m.deaths > 0 ? ((m.kills + m.assists) / m.deaths).toFixed(2) : 'Perfect';
      const mins = Math.floor(m.gameDuration / 60);
      const secs = m.gameDuration % 60;
      const queueName = QUEUE_NAMES[m.queueId] || `Queue ${m.queueId}`;
      const timeAgo = formatTimeAgo(m.gameCreation);

      // Wrapper
      const wrapper = document.createElement('div');
      wrapper.className = `match-entry ${isWin ? 'win' : 'loss'}`;

      // ── Compact row (always visible) ──
      const row = document.createElement('div');
      row.className = 'match-row';
      row.innerHTML = `
        <img class="match-champ-icon" src="${DDRAGON}/img/champion/${m.champion}.png"
             onerror="this.src='${DDRAGON}/img/champion/Aatrox.png'" />
        <div class="match-main">
          <div class="match-champ-name">${m.champion}</div>
          <div class="match-queue">${queueName} — ${mins}:${secs.toString().padStart(2, '0')}</div>
        </div>
        <div class="match-kda">
          ${m.kills}<span class="separator">/</span>${m.deaths}<span class="separator">/</span>${m.assists}
          <span class="match-kda-ratio">${kda}</span>
        </div>
        <div class="match-result ${isWin ? 'win' : 'loss'}">${isWin ? 'WIN' : 'LOSS'}</div>
        <div class="match-time">${timeAgo}</div>
        <svg class="match-expand-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      `;

      // ── Expandable detail panel ──
      const detail = document.createElement('div');
      detail.className = 'match-detail';

      // Participants
      const team1 = m.participants.filter((p) => p.teamId === 100);
      const team2 = m.participants.filter((p) => p.teamId === 200);
      const teamHtml = (team) =>
        team
          .map(
            (p) => `<div class="match-team-player">
              <img src="${DDRAGON}/img/champion/${p.championName}.png" onerror="this.style.display='none'" />
              ${escapeHtml(p.summonerName || 'Unknown')}
            </div>`
          )
          .join('');

      detail.innerHTML = `
        <div class="match-detail-section">
          <div class="match-detail-label">Build Order</div>
          <div class="build-timeline" data-match-id="${m.matchId}">
            <div class="build-loading"><div class="spinner-sm"></div> Loading build...</div>
          </div>
        </div>
        <div class="match-detail-section">
          <div class="match-detail-label">Stats</div>
          <div class="match-detail-stats">
            <span>${m.cs} CS</span>
            <span>${m.visionScore} Vision</span>
            <span>${m.goldEarned.toLocaleString()} Gold</span>
            <span>Level ${m.champLevel}</span>
          </div>
        </div>
        <div class="match-detail-section">
          <div class="match-detail-label">Players</div>
          <div class="match-detail-teams">
            <div class="match-team blue-team">${teamHtml(team1)}</div>
            <div class="match-team red-team">${teamHtml(team2)}</div>
          </div>
        </div>
      `;

      // Track whether timeline has been fetched
      let timelineLoaded = false;

      // Toggle on click — lazy-load timeline on first expand
      row.addEventListener('click', () => {
        const isExpanding = !wrapper.classList.contains('expanded');
        wrapper.classList.toggle('expanded');

        if (isExpanding && !timelineLoaded) {
          timelineLoaded = true;
          const buildEl = detail.querySelector('.build-timeline');
          loadBuildTimeline(m.matchId, buildEl);
        }
      });

      wrapper.appendChild(row);
      wrapper.appendChild(detail);
      matchList.appendChild(wrapper);
    });

    matchHistorySection.style.display = 'block';
  }

  // ── Build Timeline (lazy loaded) ────
  async function loadBuildTimeline(matchId, container) {
    try {
      const data = await apiFetch(
        `/api/match-timeline/${encodeURIComponent(matchId)}?region=${currentRegion}&puuid=${encodeURIComponent(currentPuuid)}`
      );

      if (!data.events || data.events.length === 0) {
        container.innerHTML = '<div class="build-empty">No build data available</div>';
        return;
      }

      const CONSUMABLE_IDS = new Set([2003, 2031, 2055, 2138, 2139, 2140, 3340, 3363, 3364, 2010]);

      let html = '';
      let lastMinBucket = -1;

      data.events.forEach((ev) => {
        const totalSec = Math.floor(ev.timestamp / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        const timeStr = `${min}:${sec.toString().padStart(2, '0')}`;

        // Time marker for new minute
        if (min !== lastMinBucket) {
          lastMinBucket = min;
          html += `<div class="build-time-marker">${min}m</div>`;
        }

        if (ev.type === 'kill') {
          html += `<div class="build-event kill" title="Kill @ ${timeStr}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#22c55e" stroke-width="2.5">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            <span class="build-event-time">${timeStr}</span>
          </div>`;
        } else if (ev.type === 'death') {
          html += `<div class="build-event death" title="Death @ ${timeStr}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ef4444" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="m15 9-6 6"/><path d="m9 9 6 6"/>
            </svg>
            <span class="build-event-time">${timeStr}</span>
          </div>`;
        } else if (ev.type === 'item') {
          const isConsumable = CONSUMABLE_IDS.has(ev.itemId);
          html += `<div class="build-item ${isConsumable ? 'consumable' : ''}" title="Item ${ev.itemId} @ ${timeStr}">
            <img src="${DDRAGON}/img/item/${ev.itemId}.png" onerror="this.parentElement.style.display='none'" />
            <span class="build-item-time">${timeStr}</span>
          </div>`;
        }
      });

      container.innerHTML = `<div class="build-items-flow">${html}</div>`;
    } catch {
      container.innerHTML = '<div class="build-empty">Failed to load build data</div>';
    }
  }

  // ── Helpers ──────────────────────────
  function showLoading(text) {
    loadingText.textContent = text || 'Searching...';
    loadingState.style.display = 'flex';
  }

  function hideLoading() {
    loadingState.style.display = 'none';
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorState.style.display = 'block';
  }

  function hideError() {
    errorState.style.display = 'none';
  }

  function hideResults() {
    profileSection.style.display = 'none';
    champPoolSection.style.display = 'none';
    matchHistorySection.style.display = 'none';
    rankPosition.style.display = 'none';
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
})();
