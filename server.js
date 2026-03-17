require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Riot API key — loaded from .env
const RIOT_API_KEY = process.env.RIOT_API_KEY;

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

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

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

app.listen(PORT, () => {
  console.log(`StrategyHub server running at http://localhost:${PORT}`);
});
