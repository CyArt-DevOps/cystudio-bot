// Supervisor — keeps the bot alive across crashes and network outages.
//   npm start           → runs this; it spawns index.mjs and respawns it on crash
//   exit code 0         → clean shutdown (Ctrl+C) — supervisor stops too
//   exit code 2         → fatal config (bad token) — do NOT loop, tell the human
//   anything else       → crash → respawn with exponential backoff (5s → 5min),
//                         backoff resets after 10 min of healthy uptime
// With TIDB_URL set, data/ is restored from TiDB before the first launch and mirrored
// back every 30s + on exit (see db-sync.mjs), so a wiped host loses nothing.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import * as dbSync from './db-sync.mjs';

const MIN_DELAY = 5_000, MAX_DELAY = 300_000, HEALTHY_MS = 600_000;
const SYNC_MS = 30_000, RESTORE_TRIES = 20;
let delay = MIN_DELAY;
let child = null;
let stopping = false;

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

async function shutdown(code) {
  if (dbSync.enabled()) {
    await dbSync.push(); await dbSync.push(); // second pass catches writes made during an in-flight one
    await dbSync.close();
  }
  process.exit(code);
}

function launch() {
  const startedAt = Date.now();
  console.log(`[supervisor ${ts()}] starting bot…`);
  child = spawn(process.execPath, ['index.mjs'], { stdio: 'inherit', cwd: import.meta.dirname });

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping || code === 0) {
      console.log(`[supervisor ${ts()}] bot exited cleanly — supervisor stopping.`);
      return shutdown(0);
    }
    if (code === 2) {
      console.error(`[supervisor ${ts()}] FATAL config error (exit 2) — fix .env, then npm start again. Not restarting.`);
      return shutdown(2);
    }
    if (Date.now() - startedAt > HEALTHY_MS) delay = MIN_DELAY; // ran fine for a while → fresh backoff
    console.error(`[supervisor ${ts()}] bot died (code ${code ?? 'null'}, signal ${signal ?? 'none'}) — restarting in ${delay / 1000}s`);
    setTimeout(launch, delay);
    delay = Math.min(delay * 2, MAX_DELAY);
  });
}

// forward Ctrl+C / termination to the child so it can flush the XP db
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig); else shutdown(0);
  });
}

// Restore before the bot reads data/. If TiDB stays unreachable, run on local files
// with syncing off rather than overwrite TiDB with whatever this host happens to have.
if (dbSync.enabled()) {
  for (let i = 1; i <= RESTORE_TRIES; i++) {
    try { await dbSync.restore(); break; }
    catch (e) {
      console.error(`[supervisor ${ts()}] TiDB restore failed (${i}/${RESTORE_TRIES}): ${e.message}`);
      if (i === RESTORE_TRIES) console.error(`[supervisor ${ts()}] starting WITHOUT TiDB sync — data changes stay local only.`);
      else await new Promise(r => setTimeout(r, SYNC_MS));
    }
  }
  setInterval(() => dbSync.push(), SYNC_MS).unref();
} else {
  console.warn(`[supervisor ${ts()}] TIDB_URL not set — data/ lives only on this host.`);
}

launch();
