require('dotenv').config();
const express = require('express');
const path    = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

// Initialise DB tables on startup (idempotent)
db.init().catch(err => { console.error('DB init failed:', err.message); process.exit(1); });

const app = express();
const PORT = 3000;

// Riot API key — loaded from .env
const RIOT_API_KEY = process.env.RIOT_API_KEY;

// ── Google OAuth auth ─────────────────────────
const AUTHORIZED_EMAIL = 'kabelando@gmail.com';
const GOOGLE_CONFIGURED = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (GOOGLE_CONFIGURED) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
  }, (_accessToken, _refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (email !== AUTHORIZED_EMAIL) return done(null, false);
    done(null, { email, name: profile.displayName });
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function rankingKey(name, tag, region) {
  return `${name.toLowerCase()}#${tag.toLowerCase()}@${region}`;
}

// Region routing map: platform → regional host
const PLATFORM_HOSTS = {
  br1: 'br1.api.riotgames.com',
  eun1: 'eun1.api.riotgames.com',
  euw1: 'euw1.api.riotgames.com',
  jp1: 'jp1.api.riotgames.com',
  kr: 'kr.api.riotgames.com',
  la1: 'la1.api.riotgames.com',
  la2: 'la2.api.riotgames.com',
  na1: 'na1.api.riotgames.com',
  oc1: 'oc1.api.riotgames.com',
  ph2: 'ph2.api.riotgames.com',
  ru: 'ru.api.riotgames.com',
  sg2: 'sg2.api.riotgames.com',
  th2: 'th2.api.riotgames.com',
  tr1: 'tr1.api.riotgames.com',
  tw2: 'tw2.api.riotgames.com',
  vn2: 'vn2.api.riotgames.com',
};

// Platform → regional routing host (for Account v1 API)
const REGIONAL_HOSTS = {
  na1: 'americas.api.riotgames.com',
  br1: 'americas.api.riotgames.com',
  la1: 'americas.api.riotgames.com',
  la2: 'americas.api.riotgames.com',
  euw1: 'europe.api.riotgames.com',
  eun1: 'europe.api.riotgames.com',
  tr1: 'europe.api.riotgames.com',
  ru: 'europe.api.riotgames.com',
  kr: 'asia.api.riotgames.com',
  jp1: 'asia.api.riotgames.com',
  oc1: 'sea.api.riotgames.com',
  ph2: 'sea.api.riotgames.com',
  sg2: 'sea.api.riotgames.com',
  th2: 'sea.api.riotgames.com',
  tw2: 'sea.api.riotgames.com',
  vn2: 'sea.api.riotgames.com',
};

// In-memory cache for resolved Riot IDs (puuid → { gameName, tagLine })
const nameCache = new Map();

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Expose current DDragon version to client pages
app.get('/api/ddragon-version', (_req, res) => {
  res.json({ version: currentDDragonVersion });
});

// Proxy endpoint: /api/league/:tier?region=xx
// tier = challenger | grandmaster | master
app.get('/api/league/:tier', async (req, res) => {
  const { tier } = req.params;
  const region = req.query.region || 'la1';

  const validTiers = ['challenger', 'grandmaster', 'master'];
  if (!validTiers.includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier. Use: challenger, grandmaster, master' });
  }

  const host = PLATFORM_HOSTS[region];
  if (!host) {
    return res.status(400).json({ error: 'Invalid region' });
  }

  const riotUrl = `https://${host}/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`;

  try {
    const response = await fetch(riotUrl, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: `Riot API error: ${response.status}`,
        detail: text,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch from Riot API', detail: err.message });
  }
});

// Batch resolve puuids → Riot IDs (gameName#tagLine)
// POST /api/accounts/batch  body: { puuids: [...], region: "la1" }
app.post('/api/accounts/batch', async (req, res) => {
  const { puuids, region } = req.body;
  if (!Array.isArray(puuids) || puuids.length === 0) {
    return res.status(400).json({ error: 'puuids array required' });
  }
  if (puuids.length > 10) {
    return res.status(400).json({ error: 'Max 10 puuids per batch' });
  }

  const regionalHost = REGIONAL_HOSTS[region || 'la1'];
  if (!regionalHost) {
    return res.status(400).json({ error: 'Invalid region' });
  }

  const results = {};

  await Promise.all(
    puuids.map(async (puuid) => {
      // Check cache first
      if (nameCache.has(puuid)) {
        results[puuid] = nameCache.get(puuid);
        return;
      }

      try {
        const url = `https://${regionalHost}/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
        const resp = await fetch(url, {
          headers: { 'X-Riot-Token': RIOT_API_KEY },
        });

        if (resp.ok) {
          const data = await resp.json();
          const entry = { gameName: data.gameName, tagLine: data.tagLine };
          nameCache.set(puuid, entry);
          results[puuid] = entry;
        } else {
          results[puuid] = { gameName: null, tagLine: null };
        }
      } catch {
        results[puuid] = { gameName: null, tagLine: null };
      }
    })
  );

  res.json(results);
});

// ── Rate-limited Riot API helpers ──────────────

async function riotApiFetch(url, retries = 3) {
  const resp = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
  });
  if (resp.status === 429 && retries > 0) {
    const retryAfter = parseInt(resp.headers.get('retry-after') || '5', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return riotApiFetch(url, retries - 1);
  }
  if (!resp.ok) return null;
  return resp.json();
}

async function riotFetchBatch(urls, batchSize = 8, delayMs = 1500) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((u) => riotApiFetch(u)));
    results.push(...batchResults);
    if (i + batchSize < urls.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ── Caches ─────────────────────────────────────

const championStatsCache = new Map();
const STATS_CACHE_TTL = 15 * 60 * 1000; // 15 min

const playerChampionsCache = new Map();
const PLAYER_CACHE_TTL = 10 * 60 * 1000; // 10 min

// ── Champion Stats (aggregated tier meta) ──────
// GET /api/champion-stats?region=xx&tier=challenger

app.get('/api/champion-stats', async (req, res) => {
  const region = req.query.region || 'la1';
  const tier = req.query.tier || 'challenger';

  const validTiers = ['challenger', 'grandmaster', 'master'];
  if (!validTiers.includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  const cacheKey = `${tier}-${region}`;
  const cached = championStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
    return res.json(cached.data);
  }

  const host = PLATFORM_HOSTS[region];
  const regionalHost = REGIONAL_HOSTS[region];
  if (!host || !regionalHost) {
    return res.status(400).json({ error: 'Invalid region' });
  }

  try {
    // 1. Get league entries
    const league = await riotApiFetch(
      `https://${host}/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`
    );
    if (!league || !league.entries) {
      return res.status(500).json({ error: 'Failed to fetch league data' });
    }

    // 2. Top 10 players by LP
    league.entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
    const topPlayers = league.entries.slice(0, 10);
    const puuids = topPlayers.map((p) => p.puuid);

    // 3. Fetch match IDs for each player (ranked solo queue=420, 10 matches)
    const matchListUrls = puuids.map(
      (puuid) =>
        `https://${regionalHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=10`
    );
    const matchLists = await riotFetchBatch(matchListUrls);

    // 4. Deduplicate match IDs
    const uniqueMatchIds = new Set();
    matchLists.forEach((list) => {
      if (Array.isArray(list)) list.forEach((id) => uniqueMatchIds.add(id));
    });

    // 5. Fetch match details
    const matchUrls = [...uniqueMatchIds].map(
      (id) => `https://${regionalHost}/lol/match/v5/matches/${id}`
    );
    const matches = await riotFetchBatch(matchUrls);

    // 6. Aggregate champion stats (only for our sampled players)
    const puuidSet = new Set(puuids);
    const champStats = {};
    let totalPlayerGames = 0;

    matches.forEach((match) => {
      if (!match || !match.info) return;

      match.info.participants.forEach((p) => {
        if (!puuidSet.has(p.puuid)) return;

        totalPlayerGames++;
        const name = p.championName;
        if (!champStats[name]) {
          champStats[name] = {
            name,
            games: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
          };
        }
        champStats[name].games++;
        if (p.win) champStats[name].wins++;
        champStats[name].kills += p.kills;
        champStats[name].deaths += p.deaths;
        champStats[name].assists += p.assists;
      });
    });

    // 7. Build response
    const champions = Object.values(champStats)
      .map((c) => ({
        name: c.name,
        games: c.games,
        wins: c.wins,
        losses: c.games - c.wins,
        pickRate: totalPlayerGames > 0 ? +((c.games / totalPlayerGames) * 100).toFixed(1) : 0,
        winRate: c.games > 0 ? +((c.wins / c.games) * 100).toFixed(1) : 0,
        avgKills: c.games > 0 ? +(c.kills / c.games).toFixed(1) : 0,
        avgDeaths: c.games > 0 ? +(c.deaths / c.games).toFixed(1) : 0,
        avgAssists: c.games > 0 ? +(c.assists / c.games).toFixed(1) : 0,
      }))
      .sort((a, b) => b.games - a.games);

    const result = {
      tier,
      region,
      sampleSize: topPlayers.length,
      totalGames: uniqueMatchIds.size,
      totalPlayerGames,
      champions,
    };

    championStatsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze champion stats', detail: err.message });
  }
});

// ── Champion Meta (aggregated tier list across rank tiers) ──
// GET /api/champion-meta?region=xx&minRank=emerald&patch=16.5
app.get('/api/champion-meta', async (req, res) => {
  const region = req.query.region || 'la1';
  const minRank = req.query.minRank || 'emerald';
  const patch = req.query.patch || '';

  const validMinRanks = ['emerald', 'diamond', 'master', 'grandmaster', 'challenger'];
  if (!validMinRanks.includes(minRank)) {
    return res.status(400).json({ error: 'Invalid minRank. Use: emerald, diamond, master, grandmaster, challenger' });
  }

  const cacheKey = `meta-${minRank}-${region}-${patch}`;
  const cached = championStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
    return res.json(cached.data);
  }

  const host = PLATFORM_HOSTS[region];
  const regionalHost = REGIONAL_HOSTS[region];
  if (!host || !regionalHost) {
    return res.status(400).json({ error: 'Invalid region' });
  }

  // Tier hierarchy from highest to lowest
  const tierHierarchy = ['challenger', 'grandmaster', 'master', 'diamond', 'emerald'];
  const minIndex = tierHierarchy.indexOf(minRank);
  const includedTiers = tierHierarchy.slice(0, minIndex + 1);

  // Distribute sample across tiers
  const totalTarget = 12;
  const perTier = Math.max(2, Math.floor(totalTarget / includedTiers.length));

  try {
    const allPlayers = [];

    for (const tier of includedTiers) {
      let entries = [];

      if (['challenger', 'grandmaster', 'master'].includes(tier)) {
        const league = await riotApiFetch(
          `https://${host}/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`
        );
        if (league && league.entries) {
          entries = league.entries;
        }
      } else {
        const tierName = tier.toUpperCase();
        const pageData = await riotApiFetch(
          `https://${host}/lol/league/v4/entries/RANKED_SOLO_5x5/${tierName}/I?page=1`
        );
        if (Array.isArray(pageData)) {
          entries = pageData;
        }
      }

      entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
      const sampled = entries.slice(0, perTier);
      sampled.forEach((p) => allPlayers.push({ puuid: p.puuid, tier }));
    }

    if (allPlayers.length === 0) {
      return res.status(500).json({ error: 'No players found for selected tiers' });
    }

    const puuids = allPlayers.map((p) => p.puuid);

    // Fetch match IDs (ranked solo queue=420, 10 matches each)
    const matchListUrls = puuids.map(
      (puuid) =>
        `https://${regionalHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=10`
    );
    const matchLists = await riotFetchBatch(matchListUrls);

    const uniqueMatchIds = new Set();
    matchLists.forEach((list) => {
      if (Array.isArray(list)) list.forEach((id) => uniqueMatchIds.add(id));
    });

    // Fetch match details
    const matchUrls = [...uniqueMatchIds].map(
      (id) => `https://${regionalHost}/lol/match/v5/matches/${id}`
    );
    const matches = await riotFetchBatch(matchUrls);

    // Aggregate ALL participants for pick/win/ban rates (not just sampled)
    const champStats = {};
    let totalGamesInPatch = 0;
    let totalBanSlots = 0;
    const banCounts = {};

    matches.forEach((match) => {
      if (!match || !match.info) return;
      if (patch && !match.info.gameVersion.startsWith(patch)) return;
      totalGamesInPatch++;

      // Count bans
      if (match.info.teams) {
        match.info.teams.forEach((team) => {
          if (team.bans) {
            team.bans.forEach((ban) => {
              totalBanSlots++;
              if (ban.championId > 0) {
                const banName = championIdToName(ban.championId);
                if (banName) {
                  banCounts[banName] = (banCounts[banName] || 0) + 1;
                }
              }
            });
          }
        });
      }

      // Count all 10 participants per game for accurate pick/win stats
      match.info.participants.forEach((p) => {
        const name = p.championName;
        const role = normalizeRole(p.teamPosition);
        if (!champStats[name]) {
          champStats[name] = { name, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, roles: {} };
        }
        champStats[name].games++;
        if (p.win) champStats[name].wins++;
        champStats[name].kills += p.kills;
        champStats[name].deaths += p.deaths;
        champStats[name].assists += p.assists;
        champStats[name].roles[role] = (champStats[name].roles[role] || 0) + 1;
      });
    });

    // Total participant slots = totalGamesInPatch * 10
    const totalPickSlots = totalGamesInPatch * 10;

    const champions = Object.values(champStats)
      .map((c) => {
        const bans = banCounts[c.name] || 0;
        // Most played role
        let mainRole = 'NONE';
        let maxRoleCount = 0;
        for (const [role, count] of Object.entries(c.roles)) {
          if (count > maxRoleCount) { mainRole = role; maxRoleCount = count; }
        }
        return {
          name: c.name,
          games: c.games,
          wins: c.wins,
          pickRate: totalPickSlots > 0 ? +((c.games / totalPickSlots) * 100).toFixed(2) : 0,
          winRate: c.games > 0 ? +((c.wins / c.games) * 100).toFixed(2) : 0,
          banRate: totalBanSlots > 0 ? +((bans / totalGamesInPatch) * 100).toFixed(2) : 0,
          bans,
          role: mainRole,
          roles: c.roles,
          avgKills: c.games > 0 ? +(c.kills / c.games).toFixed(1) : 0,
          avgDeaths: c.games > 0 ? +(c.deaths / c.games).toFixed(1) : 0,
          avgAssists: c.games > 0 ? +(c.assists / c.games).toFixed(1) : 0,
        };
      })
      .sort((a, b) => b.games - a.games);

    // Average win rate
    const avgWr = champions.length > 0
      ? +(champions.reduce((s, c) => s + c.winRate * c.games, 0) / champions.reduce((s, c) => s + c.games, 0)).toFixed(2)
      : 50;

    const result = {
      minRank,
      region,
      patch: patch || 'all',
      sampleSize: allPlayers.length,
      totalGames: totalGamesInPatch,
      totalPickSlots,
      tiers: includedTiers,
      avgWinRate: avgWr,
      champions,
    };

    championStatsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze champion meta', detail: err.message });
  }
});

// Helper: normalize teamPosition to standard roles
function normalizeRole(pos) {
  const map = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'SUP' };
  return map[pos] || 'NONE';
}

// Helper: champion ID → name (loaded from DDragon on startup)
let currentDDragonVersion = '16.6.1'; // fallback if fetch fails
let championIdMap = {};
(async function initDDragon() {
  try {
    const vResp = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (vResp.ok) {
      const versions = await vResp.json();
      if (versions?.[0]) currentDDragonVersion = versions[0];
    }
  } catch { /* keep fallback version */ }

  try {
    const resp = await fetch(`https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/data/en_US/champion.json`);
    if (resp.ok) {
      const data = await resp.json();
      for (const [name, info] of Object.entries(data.data)) {
        championIdMap[parseInt(info.key)] = name;
      }
    }
  } catch { /* will fallback to null for unknown bans */ }
})();

function championIdToName(id) {
  return championIdMap[id] || null;
}

// ── Player Champions (per-player champion pool) ──
// GET /api/player-champions/:puuid?region=xx

app.get('/api/player-champions/:puuid', async (req, res) => {
  const { puuid } = req.params;
  const region = req.query.region || 'la1';

  const cacheKey = `${puuid}-${region}`;
  const cached = playerChampionsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PLAYER_CACHE_TTL) {
    return res.json(cached.data);
  }

  const regionalHost = REGIONAL_HOSTS[region];
  if (!regionalHost) {
    return res.status(400).json({ error: 'Invalid region' });
  }

  try {
    // Fetch recent ranked match IDs
    const matchIds = await riotApiFetch(
      `https://${regionalHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=15`
    );
    if (!matchIds || !Array.isArray(matchIds)) {
      return res.status(500).json({ error: 'Failed to fetch matches' });
    }

    // Fetch match details
    const matchUrls = matchIds.map(
      (id) => `https://${regionalHost}/lol/match/v5/matches/${id}`
    );
    const matches = await riotFetchBatch(matchUrls, 5, 1500);

    // Aggregate this player's champions
    const champStats = {};
    let gamesProcessed = 0;

    matches.forEach((match) => {
      if (!match || !match.info) return;
      const p = match.info.participants.find((part) => part.puuid === puuid);
      if (!p) return;

      gamesProcessed++;
      const name = p.championName;
      if (!champStats[name]) {
        champStats[name] = {
          name,
          games: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
        };
      }
      champStats[name].games++;
      if (p.win) champStats[name].wins++;
      champStats[name].kills += p.kills;
      champStats[name].deaths += p.deaths;
      champStats[name].assists += p.assists;
    });

    const champions = Object.values(champStats)
      .map((c) => ({
        name: c.name,
        games: c.games,
        wins: c.wins,
        losses: c.games - c.wins,
        winRate: c.games > 0 ? +((c.wins / c.games) * 100).toFixed(1) : 0,
        avgKills: c.games > 0 ? +(c.kills / c.games).toFixed(1) : 0,
        avgDeaths: c.games > 0 ? +(c.deaths / c.games).toFixed(1) : 0,
        avgAssists: c.games > 0 ? +(c.assists / c.games).toFixed(1) : 0,
      }))
      .sort((a, b) => b.games - a.games);

    const result = { totalGames: gamesProcessed, champions };
    playerChampionsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch player champions', detail: err.message });
  }
});

// ── Search Player: Account by Riot ID ──────────
// GET /api/account/by-riot-id/:gameName/:tagLine?region=xx
app.get('/api/account/by-riot-id/:gameName/:tagLine', async (req, res) => {
  const { gameName, tagLine } = req.params;
  const region = req.query.region || 'br1';
  const regionalHost = REGIONAL_HOSTS[region];
  if (!regionalHost) return res.status(400).json({ error: 'Invalid region' });

  const url = `https://${regionalHost}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const data = await riotApiFetch(url);
  if (!data) return res.status(404).json({ error: 'Player not found' });
  res.json(data);
});

// ── Search Player: Summoner profile by puuid ──────
// GET /api/summoner/:puuid?region=xx
app.get('/api/summoner/:puuid', async (req, res) => {
  const { puuid } = req.params;
  const region = req.query.region || 'br1';
  const host = PLATFORM_HOSTS[region];
  if (!host) return res.status(400).json({ error: 'Invalid region' });

  const url = `https://${host}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;
  const data = await riotApiFetch(url);
  if (!data) return res.status(404).json({ error: 'Summoner not found' });
  res.json(data);
});

// ── Search Player: Ranked entries by puuid ────────
// GET /api/ranked/:puuid?region=xx
app.get('/api/ranked/:puuid', async (req, res) => {
  const { puuid } = req.params;
  const region = req.query.region || 'br1';
  const host = PLATFORM_HOSTS[region];
  if (!host) return res.status(400).json({ error: 'Invalid region' });

  const url = `https://${host}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
  const data = await riotApiFetch(url);
  if (!data) return res.status(404).json({ error: 'Ranked data not found' });
  res.json(data);
});

// ── Search Player: Rank position in tier ──────────
// GET /api/rank-position/:puuid?region=xx&tier=xx
app.get('/api/rank-position/:puuid', async (req, res) => {
  const { puuid } = req.params;
  const region = req.query.region || 'br1';
  const tier = req.query.tier || 'challenger';

  const validTiers = ['challenger', 'grandmaster', 'master'];
  if (!validTiers.includes(tier)) {
    return res.json({ position: null, total: null });
  }

  const host = PLATFORM_HOSTS[region];
  if (!host) return res.status(400).json({ error: 'Invalid region' });

  const cacheKey = `pos-${tier}-${region}`;
  let league = championStatsCache.get(cacheKey)?.data;
  if (!league || Date.now() - championStatsCache.get(cacheKey).timestamp > STATS_CACHE_TTL) {
    league = await riotApiFetch(
      `https://${host}/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`
    );
    if (league) {
      championStatsCache.set(cacheKey, { data: league, timestamp: Date.now() });
    }
  }

  if (!league || !league.entries) return res.json({ position: null, total: null });

  league.entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
  const idx = league.entries.findIndex((e) => e.puuid === puuid);
  res.json({
    position: idx >= 0 ? idx + 1 : null,
    total: league.entries.length,
  });
});

// ── Search Player: Match history with details ─────
// GET /api/match-history/:puuid?region=xx&count=15
app.get('/api/match-history/:puuid', async (req, res) => {
  const { puuid } = req.params;
  const region = req.query.region || 'br1';
  const count = Math.min(parseInt(req.query.count) || 15, 20);
  const regionalHost = REGIONAL_HOSTS[region];
  if (!regionalHost) return res.status(400).json({ error: 'Invalid region' });

  try {
    const matchIds = await riotApiFetch(
      `https://${regionalHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=${count}`
    );
    if (!matchIds || !Array.isArray(matchIds)) {
      return res.status(500).json({ error: 'Failed to fetch match IDs' });
    }

    const matchUrls = matchIds.map(
      (id) => `https://${regionalHost}/lol/match/v5/matches/${id}`
    );
    const matches = await riotFetchBatch(matchUrls, 5, 1500);

    const results = [];
    matches.forEach((match) => {
      if (!match || !match.info) return;
      const player = match.info.participants.find((p) => p.puuid === puuid);
      if (!player) return;

      results.push({
        matchId: match.metadata.matchId,
        gameCreation: match.info.gameCreation,
        gameDuration: match.info.gameDuration,
        queueId: match.info.queueId,
        champion: player.championName,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        cs: player.totalMinionsKilled + player.neutralMinionsKilled,
        win: player.win,
        summoner1Id: player.summoner1Id,
        summoner2Id: player.summoner2Id,
        items: [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5, player.item6],
        visionScore: player.visionScore,
        goldEarned: player.goldEarned,
        champLevel: player.champLevel,
        teamPosition: player.teamPosition,
        // team info for context
        teams: match.info.teams.map(t => ({ teamId: t.teamId, win: t.win })),
        participants: match.info.participants.map(p => ({
          puuid: p.puuid,
          championName: p.championName,
          teamId: p.teamId,
          summonerName: p.riotIdGameName || p.summonerName,
          tagLine: p.riotIdTagline || '',
        })),
      });
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch match history', detail: err.message });
  }
});

// ── Match Timeline: item purchase order ────────
// GET /api/match-timeline/:matchId?region=xx&puuid=xx
app.get('/api/match-timeline/:matchId', async (req, res) => {
  const { matchId } = req.params;
  const region = req.query.region || 'br1';
  const puuid = req.query.puuid;
  const regionalHost = REGIONAL_HOSTS[region];
  if (!regionalHost) return res.status(400).json({ error: 'Invalid region' });
  if (!puuid) return res.status(400).json({ error: 'puuid required' });

  try {
    const timeline = await riotApiFetch(
      `https://${regionalHost}/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`
    );
    if (!timeline || !timeline.info || !timeline.info.frames) {
      return res.status(404).json({ error: 'Timeline not found' });
    }

    // Find participant ID for this puuid
    const participant = timeline.info.participants.find((p) => p.puuid === puuid);
    if (!participant) return res.status(404).json({ error: 'Player not in match' });
    const participantId = participant.participantId;

    // Collect item events and kill/death events for this player
    const events = [];
    const undoneItemIds = [];
    timeline.info.frames.forEach((frame) => {
      if (!frame.events) return;
      frame.events.forEach((ev) => {
        if (ev.type === 'ITEM_PURCHASED' && ev.participantId === participantId) {
          events.push({ type: 'item', itemId: ev.itemId, timestamp: ev.timestamp });
        } else if (ev.type === 'ITEM_UNDO' && ev.participantId === participantId && ev.afterId === 0) {
          undoneItemIds.push(ev.beforeId);
        } else if (ev.type === 'CHAMPION_KILL') {
          if (ev.killerId === participantId) {
            events.push({ type: 'kill', timestamp: ev.timestamp, victimId: ev.victimId });
          } else if (ev.victimId === participantId) {
            events.push({ type: 'death', timestamp: ev.timestamp, killerId: ev.killerId });
          }
        }
      });
    });

    // Remove first occurrence of each undone item (from the end)
    for (const undoneId of undoneItemIds) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'item' && events[i].itemId === undoneId) {
          events.splice(i, 1);
          break;
        }
      }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    res.json({ participantId, events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch timeline', detail: err.message });
  }
});

// ── Shared player fetch (used by both GET and POST add) ──
async function fetchPlayerData(name, tag, region) {
  const platformHost = PLATFORM_HOSTS[region];
  const regionalHost = REGIONAL_HOSTS[region];
  if (!platformHost) return null;

  const account = await riotApiFetch(
    `https://${regionalHost}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
  );
  if (!account) return null;
  const { puuid, gameName, tagLine } = account;

  const summoner = await riotApiFetch(
    `https://${platformHost}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
  );

  const ranked = await riotApiFetch(
    `https://${platformHost}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  );
  const soloEntry = (ranked || []).find((e) => e.queueType === 'RANKED_SOLO_5x5') || null;

  const startTime = Math.floor((Date.now() - 86400000) / 1000);
  const matchIds = await riotApiFetch(
    `https://${regionalHost}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&startTime=${startTime}&count=100`
  );

  let wins24h = 0, losses24h = 0;
  if (matchIds?.length) {
    const matchUrls = matchIds.map((id) => `https://${regionalHost}/lol/match/v5/matches/${id}`);
    const matches = await riotFetchBatch(matchUrls, 8, 1500);
    matches.forEach((m) => {
      if (!m?.info) return;
      const p = m.info.participants.find((pt) => pt.puuid === puuid);
      if (!p) return;
      p.win ? wins24h++ : losses24h++;
    });
  }

  return { puuid, gameName, tagLine, profileIconId: summoner?.profileIconId ?? 0, summonerLevel: summoner?.summonerLevel ?? 0, soloEntry, wins24h, losses24h, updatedAt: Date.now() };
}

// ── Ranking: single-call player snapshot ──────
app.get('/api/ranking/player', async (req, res) => {
  const { name, tag, region = 'br1' } = req.query;
  if (!name || !tag) return res.status(400).json({ error: 'name and tag are required' });
  if (!PLATFORM_HOSTS[region]) return res.status(400).json({ error: 'Invalid region' });

  const data = await fetchPlayerData(name, tag, region);
  if (!data) return res.status(404).json({ error: 'Player not found' });

  // Cache in DB so all visitors benefit
  const key = rankingKey(name, tag, region);
  await db.setEloCache(key, data, data.updatedAt);

  // Set entry elo if not yet recorded (only sets if NULL in DB)
  if (data.soloEntry) {
    const TIER_LP_BASE = { IRON:0,BRONZE:400,SILVER:800,GOLD:1200,PLATINUM:1600,EMERALD:2000,DIAMOND:2400 };
    const DIV_LP = { IV:0,III:100,II:200,I:300 };
    const APEX = new Set(['MASTER','GRANDMASTER','CHALLENGER']);
    const s = data.soloEntry;
    const absLp = APEX.has(s.tier) ? 2800+(s.leaguePoints||0) : (TIER_LP_BASE[s.tier]||0)+(DIV_LP[s.rank]||0)+(s.leaguePoints||0);
    await db.setEntryElo(key, absLp);
  }

  res.json(data);
});

// ── Ranking: live game check ───────────────────
// GET /api/ranking/live?puuid=xxx&region=xx
app.get('/api/ranking/live', async (req, res) => {
  const { puuid, region = 'br1' } = req.query;
  if (!puuid) return res.status(400).json({ error: 'puuid required' });

  const platformHost = PLATFORM_HOSTS[region];
  if (!platformHost) return res.status(400).json({ error: 'Invalid region' });

  const game = await riotApiFetch(
    `https://${platformHost}/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`
  );

  if (!game || !game.gameId) return res.json({ inGame: false });

  const QUEUE_LABELS = { 420: 'Ranked Solo', 440: 'Ranked Flex', 400: 'Normal Draft', 450: 'ARAM' };

  const participants = (game.participants || []).map((p) => ({
    puuid:       p.puuid,
    name:        p.riotId || p.summonerName || 'Unknown',
    championId:  p.championId,
    champion:    championIdToName(p.championId) || String(p.championId),
    teamId:      p.teamId, // 100 = blue, 200 = red
    spell1Id:    p.spell1Id,
    spell2Id:    p.spell2Id,
  }));

  const self = participants.find((p) => p.puuid === puuid);

  res.json({
    inGame:        true,
    champion:      self?.champion || null,
    queueId:       game.gameQueueConfigId,
    queueLabel:    QUEUE_LABELS[game.gameQueueConfigId] || 'Game',
    gameStartTime: game.gameStartTime,
    participants,
  });
});

// ── Auth ──────────────────────────────────────
app.get('/auth/google', (req, res, next) => {
  if (!GOOGLE_CONFIGURED) return res.status(503).send('Google OAuth not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!GOOGLE_CONFIGURED) return res.redirect('/ranking.html');
  passport.authenticate('google', { failureRedirect: '/ranking.html?auth=denied' })(req, res, () => res.redirect('/ranking.html'));
});

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ admin: false });
  res.json({ admin: true, email: req.user.email, name: req.user.name });
});

// ── Sync orphaned elo_cache keys → players table ──
app.post('/api/ranking/sync-cache', requireAuth, async (_req, res) => {
  const cache   = await db.getEloCache();
  const players = await db.getPlayers();
  const existingKeys = new Set(players.map(p => rankingKey(p.name, p.tag, p.region)));

  const added = [];
  for (const key of Object.keys(cache)) {
    if (existingKeys.has(key)) continue;
    // key format: name#tag@region
    const atIdx   = key.lastIndexOf('@');
    const region  = key.slice(atIdx + 1);
    const hashIdx = key.lastIndexOf('#', atIdx);
    const name    = key.slice(0, hashIdx);
    const tag     = key.slice(hashIdx + 1, atIdx);
    if (!PLATFORM_HOSTS[region]) continue;
    await db.addPlayer(name, tag, region);
    added.push(key);
  }

  res.json({ ok: true, added });
});

// ── Ranking data (public read, protected write) ──
app.get('/api/ranking/data', async (_req, res) => {
  const [players, notes, goals, eloCache] = await Promise.all([
    db.getPlayers(), db.getNotes(), db.getGoals(), db.getEloCache(),
  ]);
  res.json({ players, notes, goals, eloCache });
});

app.post('/api/ranking/players', requireAuth, async (req, res) => {
  const { name, tag, region } = req.body;
  if (!name || !tag || !region) return res.status(400).json({ error: 'Missing fields' });
  if (!PLATFORM_HOSTS[region]) return res.status(400).json({ error: 'Invalid region' });

  const key = rankingKey(name, tag, region);
  const players = await db.getPlayers();
  if (players.find(p => rankingKey(p.name, p.tag, p.region) === key))
    return res.status(409).json({ error: 'Player already tracked' });

  // Fetch elo immediately so we can set entry_elo
  const eloData = await fetchPlayerData(name, tag, region);
  if (!eloData) return res.status(404).json({ error: 'Player not found on Riot servers' });

  await db.addPlayer(name, tag, region);
  await db.setEloCache(key, eloData, eloData.updatedAt);

  // Compute absolute LP for entry elo
  if (eloData.soloEntry) {
    const TIER_LP_BASE = { IRON:0,BRONZE:400,SILVER:800,GOLD:1200,PLATINUM:1600,EMERALD:2000,DIAMOND:2400 };
    const DIV_LP = { IV:0,III:100,II:200,I:300 };
    const APEX = new Set(['MASTER','GRANDMASTER','CHALLENGER']);
    const s = eloData.soloEntry;
    const absLp = APEX.has(s.tier) ? 2800+(s.leaguePoints||0) : (TIER_LP_BASE[s.tier]||0)+(DIV_LP[s.rank]||0)+(s.leaguePoints||0);
    await db.setEntryElo(key, absLp);
  }

  const player = (await db.getPlayers()).find(p => rankingKey(p.name, p.tag, p.region) === key);
  res.json({ ok: true, player, eloData });
});

app.delete('/api/ranking/players/:key', requireAuth, async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  await db.removePlayer(key);
  await db.deletePlayerData(key);
  res.json({ ok: true });
});

app.put('/api/ranking/notes/:key', requireAuth, async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  await db.setNote(key, req.body.text);
  res.json({ ok: true });
});

app.put('/api/ranking/goals/:key', requireAuth, async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  await db.setGoal(key, req.body.tier, req.body.division);
  res.json({ ok: true });
});

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`StrategyHub server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
