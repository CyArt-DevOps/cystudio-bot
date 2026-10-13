// TiDB mirror for data/*.json — the host can wipe the server at any time, so TiDB is the
// source of truth. The bot keeps reading/writing local JSON files; the supervisor:
//   boot      → restore(): pull every row into data/ (or seed TiDB from data/ if it's empty)
//   running   → push() every 30s: upsert any file whose content changed
//   shutdown  → push() once more after the bot exits
// Enabled only when TIDB_URL is set: mysql://USER:PASSWORD@HOST:4000/DATABASE
import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DIR = process.env.DATA_DIR ?? join(import.meta.dirname, 'data');
const TABLE = 'studio_bot_data';
const synced = new Map(); // file name → sha1 of content last confirmed in TiDB
let pool = null;
let ready = false; // never push until a restore succeeded, or a stale/empty host would clobber TiDB
let inflight = null; // one push at a time; callers share the running one

const sha = s => createHash('sha1').update(s).digest('hex');
const localFiles = () => readdirSync(DIR).filter(f => f.endsWith('.json'));

export const enabled = () => !!process.env.TIDB_URL;

async function connect() {
  if (pool) return;
  const url = new URL(process.env.TIDB_URL);
  const database = decodeURIComponent(url.pathname.slice(1)) || 'cyart_intern_bot';
  const base = {
    host: url.hostname,
    port: Number(url.port) || 4000,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, // TiDB Cloud requires TLS
  };
  const c = await mysql.createConnection(base);
  try { await c.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\``); }
  finally { await c.end(); }
  pool = mysql.createPool({ ...base, database, connectionLimit: 2, enableKeepAlive: true });
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    name VARCHAR(191) PRIMARY KEY,
    content LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}

// Pull TiDB → data/. TiDB wins over local files; local-only files get uploaded.
export async function restore() {
  await connect();
  mkdirSync(DIR, { recursive: true });
  const [rows] = await pool.query(`SELECT name, content FROM ${TABLE}`);
  for (const { name, content } of rows) {
    writeFileSync(join(DIR, name), content);
    synced.set(name, sha(content));
  }
  ready = true;
  console.log(rows.length
    ? `[db-sync] restored ${rows.length} file(s) from TiDB: ${rows.map(r => r.name).join(', ')}`
    : '[db-sync] TiDB empty — seeding from local data/');
  await push();
}

// Upsert changed data/*.json into TiDB. Half-written files (invalid JSON) wait for the next tick.
export function push() {
  if (!ready) return Promise.resolve();
  return inflight ??= pushChanged().finally(() => { inflight = null; });
}

async function pushChanged() {
  for (const name of localFiles()) {
    let content;
    try { content = readFileSync(join(DIR, name), 'utf8'); JSON.parse(content); } catch { continue; }
    const h = sha(content);
    if (synced.get(name) === h) continue;
    try {
      await pool.query(
        `INSERT INTO ${TABLE} (name, content) VALUES (?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content)`,
        [name, content]);
      synced.set(name, h);
      console.log(`[db-sync] saved ${name} (${content.length} bytes)`);
    } catch (e) {
      console.error(`[db-sync] save ${name} failed: ${e.message}`);
    }
  }
}

export async function close() { ready = false; await pool?.end(); pool = null; }
