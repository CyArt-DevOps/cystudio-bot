// v6: ◆ Builder rank at 1,000 XP — kills the progression desert between
// ◈ Amateur (300) and ★ Pro (2,500). Hoisted = the perk is visibility itself.
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

if (cfg.ranks.some(r => r.xp === 1000)) {
  console.log('◆ Builder already in config — nothing to do.');
  process.exit(0);
}
const existing = (await api(`/guilds/${G}/roles`)).find(r => r.name === '◆ Builder');
const builder = existing ?? await api(`/guilds/${G}/roles`, 'POST', {
  name: '◆ Builder', color: 0x5DADE2, hoist: true, permissions: '0',
});
cfg.roles.builder = builder.id;
cfg.ranks.push({ xp: 1000, role: builder.id, name: '◆ Builder' });
cfg.ranks.sort((a, b) => a.xp - b.xp); // engine assumes ascending
writeFileSync('config.json', JSON.stringify(cfg, null, 2));
console.log('DONE — ◆ Builder at 1,000 XP inserted. Restart the bot; members between 1,000–2,499 XP get the role on their next XP gain.');
