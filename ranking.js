/**
 * Ranking — track players' elo and 24h PDL gains, sorted by rank.
 * Player list, notes, and goals are stored server-side.
 * Elo cache stays in localStorage for instant rendering.
 */
(function () {
  'use strict';

  // eloCache is now server-side; we keep a local copy in memory for instant re-renders

  const TIER_SCORE = {
    CHALLENGER: 9, GRANDMASTER: 8, MASTER: 7,
    DIAMOND: 6, EMERALD: 5, PLATINUM: 4,
    GOLD: 3, SILVER: 2, BRONZE: 1, IRON: 0,
  };
  const DIVISION_SCORE = { I: 3, II: 2, III: 1, IV: 0 };

  // DOM refs
  const riotIdInput  = document.getElementById('riotIdInput');
  const regionSelect = document.getElementById('regionSelect');
  const addBtn       = document.getElementById('addBtn');
  const refreshBtn   = document.getElementById('refreshBtn');
  const adminBtn     = document.getElementById('adminBtn');
  const playerList   = document.getElementById('playerList');

  // State
  let trackedPlayers  = [];
  let eloCache        = {};   // in-memory; populated from server on load
  let playerGoals     = {};
  let playerNotes     = {};
  let expandedNoteKey = null;
  const refreshingKeys = new Set();
  let adminStatus = false;

  function isAdmin() { return adminStatus; }
  function authHeaders() { return { 'Content-Type': 'application/json' }; }

  function playerKey(p) {
    return `${p.name.toLowerCase()}#${p.tag.toLowerCase()}@${p.region}`;
  }

  // ── Server data init ──────────────────────────
  async function initData() {
    // Check auth and load data in parallel
    const [meResp, dataResp] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/ranking/data'),
    ]);

    try {
      const me = await meResp.json();
      adminStatus = me.admin || false;
    } catch { adminStatus = false; }

    try {
      const data = await dataResp.json();
      trackedPlayers = data.players  || [];
      playerNotes    = data.notes    || {};
      playerGoals    = data.goals    || {};
      eloCache       = data.eloCache || {};
    } catch { trackedPlayers = []; }

    // Show auth=denied banner if redirected back after a rejected Google account
    if (new URLSearchParams(location.search).get('auth') === 'denied') {
      const banner = document.createElement('div');
      banner.className = 'auth-denied-banner';
      banner.textContent = 'Access denied — this app is restricted to its owner.';
      document.querySelector('.ranking-page')?.prepend(banner);
      history.replaceState(null, '', location.pathname);
    }

    updateAdminUI();
    renderSorted();
    refreshAll().then(startLivePolling);
  }

  // ── Auth ──────────────────────────────────────
  function updateAdminUI() {
    if (!adminBtn) return;
    adminBtn.textContent = isAdmin() ? '🔓 Logout' : '🔒 Login';
    adminBtn.classList.toggle('admin-active', isAdmin());

    const addForm = document.querySelector('.add-player-form');
    if (addForm) addForm.style.display = isAdmin() ? '' : 'none';
  }

  adminBtn?.addEventListener('click', async () => {
    if (isAdmin()) {
      await fetch('/auth/logout', { method: 'POST' });
      adminStatus = false;
      updateAdminUI();
      renderSorted();
    } else {
      window.location.href = '/auth/google';
    }
  });

  // ── Add player ───────────────────────────────
  addBtn?.addEventListener('click', addPlayer);
  riotIdInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });

  async function addPlayer() {
    const raw = riotIdInput.value.trim();
    if (!raw) return;

    const hashIdx = raw.lastIndexOf('#');
    if (hashIdx <= 0 || hashIdx >= raw.length - 1) {
      riotIdInput.setCustomValidity('Use Name#Tag format');
      riotIdInput.reportValidity();
      return;
    }
    riotIdInput.setCustomValidity('');

    const entry = {
      name:   raw.substring(0, hashIdx).trim(),
      tag:    raw.substring(hashIdx + 1).trim(),
      region: regionSelect.value,
    };

    if (trackedPlayers.some((p) => playerKey(p) === playerKey(entry))) return;

    addBtn.disabled = true;
    refreshingKeys.add(playerKey(entry));
    renderSorted();

    try {
      const resp = await fetch('/api/ranking/players', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(entry),
      });
      const result = await resp.json();
      if (!resp.ok) {
        riotIdInput.setCustomValidity(result.error || 'Failed to add');
        riotIdInput.reportValidity();
        refreshingKeys.delete(playerKey(entry));
        return;
      }
      riotIdInput.value = '';
      // Use player row from DB (includes entry_elo, entry_date)
      trackedPlayers.push(result.player || entry);
      const key = playerKey(entry);
      eloCache[key] = { data: result.eloData, cachedAt: result.eloData.updatedAt || Date.now() };
    } catch {
      refreshingKeys.delete(playerKey(entry));
      return;
    } finally {
      addBtn.disabled = false;
    }

    refreshingKeys.delete(playerKey(entry));
    renderSorted();
  }

  // ── Remove player ────────────────────────────
  async function removePlayer(key) {
    if (!isAdmin()) return;
    await fetch(`/api/ranking/players/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    trackedPlayers = trackedPlayers.filter((p) => playerKey(p) !== key);
    delete eloCache[key];
    renderSorted();
  }

  // ── Fetch ────────────────────────────────────
  async function fetchOne(player) {
    const key = playerKey(player);
    try {
      const resp = await fetch(
        `/api/ranking/player?name=${encodeURIComponent(player.name)}&tag=${encodeURIComponent(player.tag)}&region=${encodeURIComponent(player.region)}`
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Unknown error');
      eloCache[key] = { data, cachedAt: data.updatedAt || Date.now() };
    } catch (err) {
      if (!eloCache[key]) eloCache[key] = { error: err.message, cachedAt: Date.now() };
    }
  }

  async function refreshAll() {
    refreshBtn.disabled = true;
    trackedPlayers.forEach(p => refreshingKeys.add(playerKey(p)));
    renderSorted();

    await Promise.all(trackedPlayers.map(async (p) => {
      await fetchOne(p);
      refreshingKeys.delete(playerKey(p));
      rebuildCard(p);
    }));

    renderSorted();
    refreshBtn.disabled = false;
  }

  function rebuildCard(player) {
    const key  = playerKey(player);
    const card = findCard(key);
    if (!card) return;

    const sorted = trackedPlayers
      .map(p => ({ p, score: eloCache[playerKey(p)]?.data ? eloScore(eloCache[playerKey(p)].data.soloEntry) : -Infinity }))
      .sort((a, b) => b.score - a.score);
    const pos = sorted.findIndex(e => playerKey(e.p) === key) + 1;

    const cached = eloCache[key];
    if (!cached) {
      card.className = 'player-card loading';
      card.innerHTML = skeletonHTML(pos, player);
    } else if (cached.error && !cached.data) {
      card.className = 'player-card error';
      card.innerHTML = errorHTML(pos, player, cached.error);
    } else {
      card.className = 'player-card';
      card.innerHTML = buildCardHTML(pos, player, cached.data, cached.cachedAt);
    }
    if (isAdmin()) card.querySelector('.btn-remove')?.addEventListener('click', () => removePlayer(key));
    updateLiveBadges();
  }

  // ── Render ───────────────────────────────────
  function renderSorted() {
    if (trackedPlayers.length === 0) {
      playerList.innerHTML = '<div class="empty-state">No players tracked yet.</div>';
      return;
    }

    const entries = trackedPlayers.map((p) => {
      const key    = playerKey(p);
      const cached = eloCache[key];
      const score  = cached?.data ? eloScore(cached.data.soloEntry) : -Infinity;
      return { player: p, cached, score, key };
    });

    entries.sort((a, b) => b.score - a.score);

    expandedNoteKey = null;
    playerList.innerHTML = '';
    entries.forEach(({ player, cached, key }, i) => {
      const card = document.createElement('div');
      card.dataset.key = key;

      if (!cached) {
        card.className = 'player-card loading';
        card.innerHTML = skeletonHTML(i + 1, player);
      } else if (cached.error && !cached.data) {
        card.className = 'player-card error';
        card.innerHTML = errorHTML(i + 1, player, cached.error);
      } else {
        card.className = 'player-card';
        card.innerHTML = buildCardHTML(i + 1, player, cached.data, cached.cachedAt);
      }

      if (isAdmin()) card.querySelector('.btn-remove')?.addEventListener('click', () => removePlayer(key));
      playerList.appendChild(card);
    });

    updateLiveBadges();
  }

  // ── Card HTML builders ───────────────────────
  function posColHTML(pos, player) {
    return refreshingKeys.has(playerKey(player))
      ? '<div class="rank-spinner"><div class="spinner spinner-sm"></div></div>'
      : `<span class="rank-position">${pos}</span>`;
  }

  function skeletonHTML(pos, player) {
    return `
      ${posColHTML(pos, player)}
      <img class="profile-icon" src="" alt="" />
      <div class="player-info">
        <div class="player-name"><span class="player-name-text">${escHtml(player.name)}<span class="player-tag"> #${escHtml(player.tag)}</span></span></div>
        <div class="player-level">Loading…</div>
      </div>
      <div></div><div></div><div></div>
      ${isAdmin() ? '<button class="btn-remove" title="Remove">✕</button>' : '<div></div>'}
    `;
  }

  function errorHTML(pos, player, err) {
    return `
      ${posColHTML(pos, player)}
      <img class="profile-icon" src="" alt="" />
      <div class="player-info">
        <div class="player-name"><span class="player-name-text">${escHtml(player.name)}<span class="player-tag"> #${escHtml(player.tag)}</span></span></div>
      </div>
      <span class="card-error">${escHtml(err)}</span>
      ${isAdmin() ? '<button class="btn-remove" title="Remove">✕</button>' : '<div></div>'}
    `;
  }

  function buildCardHTML(pos, player, d, cachedAt) {
    const key     = playerKey(player);
    const iconUrl = d.profileIconId
      ? `https://ddragon.leagueoflegends.com/cdn/${currentDDVersion}/img/profileicon/${d.profileIconId}.png`
      : '';

    const solo        = d.soloEntry;
    const tierKey     = solo ? solo.tier : 'UNRANKED';
    const tierLabel   = solo ? `${capitalize(solo.tier)} ${solo.rank}` : 'Unranked';
    const lp          = solo ? solo.leaguePoints : '—';
    const totalWins   = solo ? solo.wins : 0;
    const totalLosses = solo ? solo.losses : 0;
    const totalGames  = totalWins + totalLosses;
    const winRate     = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : null;

    const net      = d.wins24h - d.losses24h;
    const pdlEst   = net * 18;
    const pdlClass = pdlEst > 0 ? 'pdl-positive' : pdlEst < 0 ? 'pdl-negative' : 'pdl-neutral';
    const pdlSign  = pdlEst > 0 ? '+' : '';
    const has24h   = d.wins24h > 0 || d.losses24h > 0;

    const showDivBar = solo && !APEX_TIERS.has(solo.tier);
    const divBarHtml = showDivBar
      ? `<div class="div-bar-wrap" title="${solo.leaguePoints} / 100 LP in division">
           <div class="div-bar-fill" style="width:${solo.leaguePoints}%"></div>
         </div>`
      : '';

    return `
      ${posColHTML(pos, player)}
      <img class="profile-icon" src="${escHtml(iconUrl)}" alt="" />
      <div class="player-info">
        <div class="player-name"><span class="player-name-text">${escHtml(d.gameName)}<span class="player-tag"> #${escHtml(d.tagLine)}</span></span>${playerNotes[key]?.trim() ? '<span class="notes-dot" title="Has notes"></span>' : ''}</div>
        <div class="player-level">Lv.${d.summonerLevel} · ${capitalize(player.region)}</div>
        ${tagsHTML(key)}
      </div>
      <div class="rank-block">
        <div class="rank-main">
          <span class="rank-tier tier-${tierKey}">${tierLabel}</span>
          <span class="rank-sep">·</span>
          <span class="rank-lp">${lp}</span>
          <span class="rank-lp-label">LP</span>
        </div>
        ${divBarHtml}
        ${winRate !== null ? `<div class="rank-sub">${totalWins}W ${totalLosses}L · ${winRate}% WR</div>` : ''}
      </div>
      <div class="stats-24h">
        ${has24h
          ? `<div class="stats-games"><span class="wins">${d.wins24h}W</span><span class="losses">${d.losses24h}L</span></div>
             <div class="stats-pdl ${pdlClass}">${pdlSign}${pdlEst} PDL</div>`
          : `<span class="no-games">—</span>`}
      </div>
      <span class="cached-badge" title="Last updated">${timeAgo(cachedAt)}</span>
      ${isAdmin() ? '<button class="btn-remove" title="Remove">✕</button>' : '<div></div>'}
      ${goalRowHTML(key, solo)}
      ${entryRowHTML(player, solo)}
    `;
  }

  function goalRowHTML(key, solo) {
    const goal = playerGoals[key];

    if (!goal) {
      if (!isAdmin()) return '';
      return `<div class="goal-row">
        <button class="btn-goal-set" data-key="${escHtml(key)}">⊕ Set Goal</button>
      </div>`;
    }

    const needed    = lpNeededForGoal(solo, goal.tier, goal.division);
    const current   = solo ? totalLp(solo.tier, solo.rank, solo.leaguePoints) : 0;
    const goalTotal = totalLp(goal.tier, APEX_TIERS.has(goal.tier) ? 'I' : (goal.division || 'IV'), 0);
    const percent   = goalTotal > 0 ? Math.min(100, Math.round((current / goalTotal) * 100)) : 100;
    const achieved  = needed === 0;
    const tierLabel = capitalize(goal.tier) + (!APEX_TIERS.has(goal.tier) && goal.division ? ` ${goal.division}` : '');

    return `<div class="goal-row">
      <span class="goal-flag">⚑</span>
      <span class="goal-tier-label tier-${escHtml(goal.tier)}">${escHtml(tierLabel)}</span>
      <div class="goal-bar-wrap">
        <div class="goal-bar-fill${achieved ? ' goal-achieved' : ''}" style="width:${percent}%"></div>
      </div>
      <span class="goal-lp-needed${achieved ? ' goal-achieved-text' : ''}">
        ${achieved ? '✓ Goal reached!' : '+' + needed.toLocaleString() + ' LP needed'}
      </span>
      ${isAdmin() ? `<button class="btn-goal-edit" data-key="${escHtml(key)}" title="Change goal">✎</button>` : ''}
    </div>`;
  }

  function entryRowHTML(player, solo) {
    // player row from DB has entry_elo and entry_date
    const entryLp = player.entry_elo;
    if (entryLp == null) return '';

    const currentLp = solo ? totalLp(solo.tier, solo.rank, solo.leaguePoints) : null;
    const delta = currentLp != null ? currentLp - entryLp : null;

    const entryLabel = lpToLabel(entryLp);
    const deltaText  = delta == null ? '' : (delta >= 0 ? `+${delta} LP` : `${delta} LP`);
    const deltaClass = delta == null ? '' : (delta > 0 ? 'entry-delta-pos' : delta < 0 ? 'entry-delta-neg' : 'entry-delta-neu');
    const dateLabel  = player.entry_date ? dateAgo(player.entry_date) : '';

    return `<div class="entry-row">
      <span class="entry-icon">🎓</span>
      <span class="entry-label">Joined ${dateLabel ? `<span class="entry-date">${escHtml(dateLabel)}</span>` : ''} at <span class="entry-tier">${escHtml(entryLabel)}</span></span>
      ${delta != null ? `<span class="entry-delta ${deltaClass}">${escHtml(deltaText)}</span>` : ''}
    </div>`;
  }

  function lpToLabel(absLp) {
    if (absLp >= 2800) return 'Master+';
    const tiers = [
      { name: 'Diamond', base: 2400 }, { name: 'Emerald', base: 2000 },
      { name: 'Platinum', base: 1600 }, { name: 'Gold', base: 1200 },
      { name: 'Silver', base: 800 },   { name: 'Bronze', base: 400 },
      { name: 'Iron', base: 0 },
    ];
    const divNames = ['IV','III','II','I'];
    for (const { name, base } of tiers) {
      if (absLp >= base) {
        const divIndex = Math.min(3, Math.floor((absLp - base) / 100));
        return `${name} ${divNames[divIndex]}`;
      }
    }
    return 'Unranked';
  }

  function openGoalEditor(key) {
    if (!isAdmin()) return;
    const card = findCard(key);
    if (!card) return;
    const goalRow = card.querySelector('.goal-row');
    if (!goalRow) return;

    const current = playerGoals[key];
    const tiers   = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];

    goalRow.innerHTML = `
      <span class="goal-edit-label">Goal:</span>
      <select class="goal-tier-select">
        ${tiers.map(t => `<option value="${t}"${current?.tier === t ? ' selected' : ''}>${capitalize(t)}</option>`).join('')}
      </select>
      <select class="goal-div-select">
        ${['IV','III','II','I'].map(d => `<option value="${d}"${current?.division === d ? ' selected' : ''}>${d}</option>`).join('')}
      </select>
      <button class="btn-goal-save" data-key="${escHtml(key)}">Set</button>
      <button class="btn-goal-cancel" data-key="${escHtml(key)}">✕</button>
    `;

    const tierSel = goalRow.querySelector('.goal-tier-select');
    const divSel  = goalRow.querySelector('.goal-div-select');
    const syncDiv = () => { divSel.style.display = APEX_TIERS.has(tierSel.value) ? 'none' : ''; };
    syncDiv();
    tierSel.addEventListener('change', syncDiv);
  }

  // ── Tag extraction ───────────────────────────
  function extractTags(notes) {
    if (!notes) return [];
    const matches = notes.match(/#(\w+)/g) || [];
    return [...new Set(matches.map(t => t.slice(1).toLowerCase()))];
  }

  function tagsHTML(key) {
    const tags = extractTags(playerNotes[key]);
    if (!tags.length) return '';
    return `<div class="player-tags">${tags.map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('')}</div>`;
  }

  // ── LP maths ─────────────────────────────────
  const TIER_LP_BASE = { IRON:0, BRONZE:400, SILVER:800, GOLD:1200, PLATINUM:1600, EMERALD:2000, DIAMOND:2400 };
  const DIV_LP       = { IV:0, III:100, II:200, I:300 };
  const APEX_TIERS   = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

  function totalLp(tier, division, lp) {
    if (APEX_TIERS.has(tier)) return 2800 + (lp || 0);
    return (TIER_LP_BASE[tier] ?? 0) + (DIV_LP[division] ?? 0) + (lp || 0);
  }

  function lpNeededForGoal(solo, goalTier, goalDiv) {
    const current = solo ? totalLp(solo.tier, solo.rank, solo.leaguePoints) : 0;
    const goal    = totalLp(goalTier, APEX_TIERS.has(goalTier) ? 'I' : (goalDiv || 'IV'), 0);
    return Math.max(0, goal - current);
  }

  function eloScore(soloEntry) {
    if (!soloEntry) return -1;
    return (TIER_SCORE[soloEntry.tier] ?? -1) * 10000
         + (DIVISION_SCORE[soloEntry.rank] ?? 0) * 400
         + (soloEntry.leaguePoints || 0);
  }

  // ── Helpers ──────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function dateAgo(isoDate) {
    const days = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;
    const years = Math.floor(days / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  }

  // ── Live game status ─────────────────────────
  const liveStatus = {};

  async function checkLiveAll() {
    const checks = trackedPlayers
      .filter((p) => eloCache[playerKey(p)]?.data?.puuid)
      .map(async (p) => {
        const key   = playerKey(p);
        const puuid = eloCache[key].data.puuid;
        try {
          const resp = await fetch(`/api/ranking/live?puuid=${encodeURIComponent(puuid)}&region=${encodeURIComponent(p.region)}`);
          liveStatus[key] = await resp.json();
        } catch { liveStatus[key] = { inGame: false }; }
      });
    await Promise.all(checks);
    updateLiveBadges();
  }

  function findCard(key) {
    for (const child of playerList.children) {
      if (child.dataset.key === key) return child;
    }
    return null;
  }

  function updateLiveBadges() {
    trackedPlayers.forEach((p) => {
      const key        = playerKey(p);
      const status     = liveStatus[key];
      const card       = findCard(key);
      if (!card || !status) return;

      card.querySelector('.live-badge')?.remove();
      card.querySelector('.live-game')?.remove();
      card.classList.remove('has-live-game');

      const iconEl     = card.querySelector('.profile-icon');
      const levelEl    = card.querySelector('.player-level');
      const cachedData = eloCache[key]?.data;

      if (iconEl && cachedData) {
        iconEl.src = cachedData.profileIconId
          ? `https://ddragon.leagueoflegends.com/cdn/${currentDDVersion}/img/profileicon/${cachedData.profileIconId}.png`
          : '';
        iconEl.style.borderRadius = '';
      }
      if (levelEl && cachedData) {
        levelEl.textContent = `Lv.${cachedData.summonerLevel} · ${capitalize(p.region)}`;
      }

      if (!status.inGame) return;

      if (iconEl && status.champion) {
        iconEl.src = `https://ddragon.leagueoflegends.com/cdn/${currentDDVersion}/img/champion/${status.champion}.png`;
        iconEl.title = status.champion;
        iconEl.style.borderRadius = '4px';
      }

      const nameEl = card.querySelector('.player-name');
      if (nameEl) {
        const badge = document.createElement('span');
        badge.className = 'live-badge';
        badge.innerHTML = `<span class="live-dot"></span>LIVE`;
        nameEl.appendChild(badge);
      }

      if (levelEl && status.champion) {
        levelEl.innerHTML = `<span class="live-playing">&#9654; ${escHtml(status.champion)}</span>`;
      }

      if (status.participants?.length) {
        card.classList.add('has-live-game');
        const trackedPuuid = eloCache[key]?.data?.puuid;
        card.appendChild(buildLiveGameEl(status, trackedPuuid));
      }
    });
  }

  function buildLiveGameEl(status, trackedPuuid) {
    const blue = status.participants.filter((p) => p.teamId === 100);
    const red  = status.participants.filter((p) => p.teamId === 200);
    const dur  = status.gameStartTime ? gameDuration(status.gameStartTime) : '';

    const el = document.createElement('div');
    el.className = 'live-game';
    el.innerHTML = `
      <div class="live-game-header">
        <span>${escHtml(status.queueLabel)}</span>
        ${dur ? `<span class="live-timer">${dur}</span>` : ''}
      </div>
      <div class="live-teams">
        <div class="live-team">${blue.map((p) => participantHTML(p, trackedPuuid)).join('')}</div>
        <div class="live-team">${red.map((p) => participantHTML(p, trackedPuuid)).join('')}</div>
      </div>
    `;

    if (status.gameStartTime) {
      const timerEl = el.querySelector('.live-timer');
      const interval = setInterval(() => {
        if (!document.body.contains(timerEl)) { clearInterval(interval); return; }
        timerEl.textContent = gameDuration(status.gameStartTime);
      }, 1000);
    }

    return el;
  }

  function participantHTML(p, trackedPuuid) {
    const isSelf      = p.puuid === trackedPuuid;
    const teamClass   = p.teamId === 100 ? 'team-blue' : 'team-red';
    const selfClass   = isSelf ? ' is-self' : '';
    const iconUrl     = `https://ddragon.leagueoflegends.com/cdn/${currentDDVersion}/img/champion/${escHtml(p.champion)}.png`;
    const displayName = p.name.includes('#') ? p.name.split('#')[0] : p.name;

    return `
      <div class="live-participant ${teamClass}${selfClass}">
        <img class="live-champ-icon" src="${iconUrl}" alt="${escHtml(p.champion)}" />
        <span class="live-participant-name">${escHtml(displayName)}</span>
        <span class="live-participant-champ">${escHtml(p.champion)}</span>
      </div>
    `;
  }

  function gameDuration(startTimeMs) {
    const total = Math.floor((Date.now() - startTimeMs) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  let liveInterval = null;

  function startLivePolling() {
    checkLiveAll();
    liveInterval = setInterval(checkLiveAll, 60000);
  }

  // ── Player panel (notes) ──────────────────────
  function openNotePanel(key) {
    if (expandedNoteKey === key) { closeNotePanel(); return; }
    closeNotePanel();

    const card = findCard(key);
    if (!card) return;
    expandedNoteKey = key;
    card.classList.add('notes-open');

    const panel = document.createElement('div');
    panel.className = 'notes-panel';
    panel.innerHTML = `
      <div class="notes-header">
        <span class="notes-title">&#128203; Notes</span>
        <button class="btn-notes-close" title="Close">✕</button>
      </div>
      ${isAdmin()
        ? `<textarea class="notes-textarea" placeholder="Write notes… use #tags to label this player (e.g. #aggressive #jungler)" spellcheck="false">${escHtml(playerNotes[key] || '')}</textarea>`
        : `<div class="notes-readonly">${playerNotes[key]?.trim() ? escHtml(playerNotes[key]) : '<span class="notes-empty">No notes yet.</span>'}</div>`
      }
    `;
    card.appendChild(panel);
  }

  function closeNotePanel() {
    if (!expandedNoteKey) return;
    const card = findCard(expandedNoteKey);
    if (card) {
      card.querySelector('.notes-panel')?.remove();
      card.classList.remove('notes-open');
    }
    expandedNoteKey = null;
  }

  // Toggle panel on card click
  playerList.addEventListener('click', (e) => {
    if (e.target.closest('button, select, input, a')) return;
    if (e.target.closest('.notes-panel')) return;
    const card = e.target.closest('.player-card');
    if (!card || !card.dataset.key) return;
    openNotePanel(card.dataset.key);
  });

  // Auto-save notes on input (admin only)
  playerList.addEventListener('input', (e) => {
    if (!e.target.classList.contains('notes-textarea')) return;
    const card = e.target.closest('.player-card');
    if (!card) return;
    const key = card.dataset.key;
    playerNotes[key] = e.target.value;

    fetch(`/api/ranking/notes/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ text: e.target.value }),
    });

    const dot = card.querySelector('.notes-dot');
    if (e.target.value.trim()) {
      if (!dot) {
        const nameText = card.querySelector('.player-name-text');
        nameText?.insertAdjacentHTML('afterend', '<span class="notes-dot" title="Has notes"></span>');
      }
    } else {
      dot?.remove();
    }

    const infoEl = card.querySelector('.player-info');
    if (infoEl) {
      infoEl.querySelector('.player-tags')?.remove();
      const html = tagsHTML(key);
      if (html) infoEl.insertAdjacentHTML('beforeend', html);
    }
  });

  // Close-button inside the panel
  playerList.addEventListener('click', (e) => {
    if (!e.target.classList.contains('btn-notes-close')) return;
    closeNotePanel();
  });

  // ── Goal interactions ─────────────────────────
  playerList.addEventListener('click', (e) => {
    if (!isAdmin()) return;
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;

    if (btn.classList.contains('btn-goal-set') || btn.classList.contains('btn-goal-edit')) {
      openGoalEditor(key);

    } else if (btn.classList.contains('btn-goal-save')) {
      const card    = findCard(key);
      const tierSel = card?.querySelector('.goal-tier-select');
      const divSel  = card?.querySelector('.goal-div-select');
      if (!tierSel) return;
      const tier     = tierSel.value;
      const division = APEX_TIERS.has(tier) ? null : divSel.value;
      playerGoals[key] = { tier, division };

      fetch(`/api/ranking/goals/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ tier, division }),
      });

      rebuildCard(trackedPlayers.find(p => playerKey(p) === key));

    } else if (btn.classList.contains('btn-goal-cancel')) {
      rebuildCard(trackedPlayers.find(p => playerKey(p) === key));
    }
  });

  // DDragon version
  let currentDDVersion = '16.6.1';
  (async function initVersion() {
    try {
      const r = await fetch('/api/ddragon-version');
      const { version } = await r.json();
      currentDDVersion = version;
    } catch { /* keep fallback */ }
  })();

  // ── Boot ─────────────────────────────────────
  refreshBtn.addEventListener('click', async () => {
    await refreshAll();
    checkLiveAll();
  });

  initData();
})();
