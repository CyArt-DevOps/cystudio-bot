// Supervisor — keeps the bot alive across crashes and network outages.
//   npm start           → runs this; it spawns index.mjs and respawns it on crash
//   exit code 0         → clean shutdown (Ctrl+C) — supervisor stops too
//   exit code 2         → fatal config (bad token) — do NOT loop, tell the human
//   anything else       → crash → respawn with exponential backoff (5s → 5min),
//                         backoff resets after 10 min of healthy uptime
import { spawn } from 'node:child_process';

const MIN_DELAY = 5_000, MAX_DELAY = 300_000, HEALTHY_MS = 600_000;
let delay = MIN_DELAY;
let child = null;
let stopping = false;

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function launch() {
  const startedAt = Date.now();
  console.log(`[supervisor ${ts()}] starting bot…`);
  child = spawn(process.execPath, ['index.mjs'], { stdio: 'inherit', cwd: import.meta.dirname });

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping || code === 0) {
      console.log(`[supervisor ${ts()}] bot exited cleanly — supervisor stopping.`);
      process.exit(0);
    }
    if (code === 2) {
      console.error(`[supervisor ${ts()}] FATAL config error (exit 2) — fix .env, then npm start again. Not restarting.`);
      process.exit(2);
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
    if (child) child.kill(sig); else process.exit(0);
  });
}

launch();
