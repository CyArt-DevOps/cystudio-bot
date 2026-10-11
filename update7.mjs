// v7: (a) MonitoRSS feed channels in the CYBERSEC + AI zones,
//     (b) owner-only join log, and joins stop being announced in ✧・welcome.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const cfg = JSON.parse(readFileSync('./config.json'));

async function api(path, method = 'GET', body) {
  for (;;) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${T}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { const j = await res.json(); await new Promise(r => setTimeout(r, (j.retry_after ?? 1) * 1000 + 250)); continue; }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(j)}`);
    return j;
  }
}

const VIEW = 1n << 10n, HISTORY = 1n << 16n, SEND = 1n << 11n, EMBED = 1n << 14n;

const guild = await api(`/guilds/${G}`);
const me = await api('/users/@me');
const channels = await api(`/guilds/${G}/channels`);
const byName = n => channels.find(c => c.name === n);
const cat = n => channels.find(c => c.type === 4 && c.name === n);

// ── 1. feed channels (public, read-only for members — MonitoRSS posts, humans react)
const feeds = [
  { key: 'cyberFeed', name: '⌗・cyber-feed', parent: '⌖ ─ CYBERSEC ZONE', topic: 'Automated CVE / threat-intel / cybersecurity news via MonitoRSS. Read-only.' },
  { key: 'aiFeed',    name: '⌗・ai-feed',    parent: '◎ ─ AI ZONE',       topic: 'Automated AI research + product news via MonitoRSS. Read-only.' },
];
for (const f of feeds) {
  const existing = byName(f.name);
  const ch = existing ?? await api(`/guilds/${G}/channels`, 'POST', {
    name: f.name, type: 0, topic: f.topic, parent_id: cat(f.parent).id,
    permission_overwrites: [
      { id: G, type: 0, deny: String(SEND) },                       // @everyone: read, no chat
      { id: me.id, type: 1, allow: String(VIEW | SEND | EMBED) },
    ],
  });
  cfg.channels[f.key] = ch.id;
  console.log(`${existing ? 'exists' : 'created'} ${f.name} -> ${ch.id}`);
}

// ── 2. owner-only join log (staff category, but overwrites lock it to the owner)
const logName = '⌗・join-log';
const existingLog = byName(logName);
const log = existingLog ?? await api(`/guilds/${G}/channels`, 'POST', {
  name: logName, type: 0, parent_id: cat('⚔ ─ STAFF').id,
  topic: 'Private join feed. Owner + bot only.',
  permission_overwrites: [
    { id: G, type: 0, deny: String(VIEW) },
    { id: guild.owner_id, type: 1, allow: String(VIEW | HISTORY | SEND) },
    { id: me.id, type: 1, allow: String(VIEW | HISTORY | SEND | EMBED) },
  ],
});
cfg.channels.joinLog = log.id;
console.log(`${existingLog ? 'exists' : 'created'} ${logName} -> ${log.id}`);

// ── 3. stop Discord's "X just showed up!" system messages in ✧・welcome
//     bit 0 = SUPPRESS_JOIN_NOTIFICATIONS, bit 3 = SUPPRESS_JOIN_NOTIFICATION_REPLIES
await api(`/guilds/${G}`, 'PATCH', { system_channel_flags: (guild.system_channel_flags | 1 | 8) });
console.log('join notifications suppressed in ✧・welcome (boost messages kept)');

writeFileSync('config.json', JSON.stringify(cfg, null, 2));
console.log('DONE — restart the bot so guildMemberAdd starts writing to the join log.');
