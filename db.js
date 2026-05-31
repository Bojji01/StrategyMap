const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// Local dev → SQLite file. Production (Vercel) → Turso cloud.
const client = createClient({
  url:       process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'data', 'ranking.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function init() {
  await client.batch([
    { sql: `CREATE TABLE IF NOT EXISTS players (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        tag        TEXT NOT NULL,
        region     TEXT NOT NULL,
        entry_elo  INTEGER,
        entry_date TEXT,
        UNIQUE(name, tag, region)
      )` },
    { sql: `CREATE TABLE IF NOT EXISTS notes (
        player_key TEXT PRIMARY KEY,
        text       TEXT NOT NULL DEFAULT ''
      )` },
    { sql: `CREATE TABLE IF NOT EXISTS goals (
        player_key TEXT PRIMARY KEY,
        tier       TEXT NOT NULL,
        division   TEXT
      )` },
    { sql: `CREATE TABLE IF NOT EXISTS elo_cache (
        player_key TEXT    PRIMARY KEY,
        data       TEXT    NOT NULL,
        cached_at  INTEGER NOT NULL
      )` },
  ], 'write');

  // One-time migration from ranking_data.json if it exists and DB is empty
  await migrateFromJson();
}

async function migrateFromJson() {
  const jsonPath = path.join(__dirname, 'data', 'ranking_data.json');
  if (!fs.existsSync(jsonPath)) return;
  const count = (await client.execute('SELECT COUNT(*) as c FROM players')).rows[0].c;
  if (Number(count) > 0) return;

  try {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const stmts = [];
    for (const p of json.players || [])
      stmts.push({ sql: 'INSERT OR IGNORE INTO players (name, tag, region) VALUES (?,?,?)', args: [p.name, p.tag, p.region] });
    for (const [key, text] of Object.entries(json.notes || {}))
      if (text) stmts.push({ sql: 'INSERT OR IGNORE INTO notes (player_key, text) VALUES (?,?)', args: [key, text] });
    for (const [key, g] of Object.entries(json.goals || {}))
      if (g) stmts.push({ sql: 'INSERT OR IGNORE INTO goals (player_key, tier, division) VALUES (?,?,?)', args: [key, g.tier, g.division || null] });
    if (stmts.length) await client.batch(stmts, 'write');
    console.log('Migrated ranking_data.json → database');
  } catch (e) {
    console.error('Migration error:', e.message);
  }
}

function playerKeyToRow(key) {
  const atIdx   = key.lastIndexOf('@');
  const region  = key.slice(atIdx + 1);
  const hashIdx = key.lastIndexOf('#', atIdx);
  const name    = key.slice(0, hashIdx).toLowerCase();
  const tag     = key.slice(hashIdx + 1, atIdx).toLowerCase();
  return { name, tag, region };
}

module.exports = {
  init,

  async getPlayers() {
    const r = await client.execute('SELECT * FROM players ORDER BY id');
    return r.rows.map(row => ({
      id:         Number(row.id),
      name:       row.name,
      tag:        row.tag,
      region:     row.region,
      entry_elo:  row.entry_elo != null ? Number(row.entry_elo) : null,
      entry_date: row.entry_date,
    }));
  },

  async addPlayer(name, tag, region) {
    await client.execute({
      sql:  'INSERT OR IGNORE INTO players (name, tag, region, entry_date) VALUES (?,?,?,?)',
      args: [name, tag, region, new Date().toISOString()],
    });
  },

  async removePlayer(key) {
    const { name, tag, region } = playerKeyToRow(key);
    await client.execute({
      sql:  'DELETE FROM players WHERE LOWER(name)=? AND LOWER(tag)=? AND region=?',
      args: [name, tag, region],
    });
  },

  async setEntryElo(key, elo) {
    const { name, tag, region } = playerKeyToRow(key);
    await client.execute({
      sql:  'UPDATE players SET entry_elo=? WHERE LOWER(name)=? AND LOWER(tag)=? AND region=? AND entry_elo IS NULL',
      args: [elo, name, tag, region],
    });
  },

  async getNotes() {
    const r = await client.execute('SELECT player_key, text FROM notes');
    return Object.fromEntries(r.rows.map(row => [row.player_key, row.text]));
  },

  async setNote(key, text) {
    if (text?.trim())
      await client.execute({ sql: 'INSERT OR REPLACE INTO notes (player_key, text) VALUES (?,?)', args: [key, text] });
    else
      await client.execute({ sql: 'DELETE FROM notes WHERE player_key=?', args: [key] });
  },

  async getGoals() {
    const r = await client.execute('SELECT player_key, tier, division FROM goals');
    return Object.fromEntries(r.rows.map(row => [row.player_key, { tier: row.tier, division: row.division }]));
  },

  async setGoal(key, tier, division) {
    if (tier)
      await client.execute({ sql: 'INSERT OR REPLACE INTO goals (player_key, tier, division) VALUES (?,?,?)', args: [key, tier, division || null] });
    else
      await client.execute({ sql: 'DELETE FROM goals WHERE player_key=?', args: [key] });
  },

  async getEloCache() {
    const r = await client.execute('SELECT player_key, data, cached_at FROM elo_cache');
    return Object.fromEntries(
      r.rows.map(row => [row.player_key, { data: JSON.parse(row.data), cachedAt: Number(row.cached_at) }])
    );
  },

  async setEloCache(key, data, cachedAt) {
    await client.execute({
      sql:  'INSERT OR REPLACE INTO elo_cache (player_key, data, cached_at) VALUES (?,?,?)',
      args: [key, JSON.stringify(data), cachedAt],
    });
  },

  async deletePlayerData(key) {
    await client.batch([
      { sql: 'DELETE FROM elo_cache WHERE player_key=?', args: [key] },
      { sql: 'DELETE FROM notes    WHERE player_key=?', args: [key] },
      { sql: 'DELETE FROM goals    WHERE player_key=?', args: [key] },
    ], 'write');
  },
};
