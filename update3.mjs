// v3 update: kick old bots, invite-reward roles, emoji polish.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const cfg = JSON.parse(readFileSync('./config.json'));

async function api(path, method = 'GET', body) {
  for (;;) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${T}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const j = await res.json();
      await new Promise(r => setTimeout(r, (j.retry_after ?? 1) * 1000 + 250));
      continue;
    }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(j)}`);
    return j;
  }
}

console.log('== 1. Kick unwanted bots ==');
const KEEP = ['Studio Bot', 'Server Booster'];
const roles = await api(`/guilds/${G}/roles`);
for (const r of roles.filter(x => x.managed && !KEEP.includes(x.name))) {
  const botId = r.tags?.bot_id;
  if (!botId) { console.log(` skip ${r.name} (no bot user)`); continue; }
  await api(`/guilds/${G}/members/${botId}`, 'DELETE')
    .then(() => console.log(` kicked ${r.name}`))
    .catch(e => console.log(` kick ${r.name} failed: ${e.message.slice(0, 80)}`));
}

console.log('== 2. Invite-reward roles ==');
// remove earlier partial duplicates
for (const r of (await api(`/guilds/${G}/roles`)).filter(x => ['⟐ Scout', '◇ Ambassador'].includes(x.name)))
  await api(`/guilds/${G}/roles/${r.id}`, 'DELETE').catch(() => {});
const scout = await api(`/guilds/${G}/roles`, 'POST', { name: '⟐ Scout', color: 0x58C6B2, hoist: false, mentionable: false, permissions: '0' });
const ambassador = await api(`/guilds/${G}/roles`, 'POST', { name: '◇ Ambassador', color: 0x38B6FF, hoist: true, mentionable: false, permissions: '0' });
// position just above ✓ Verified (below Amateur)
const cur = await api(`/guilds/${G}/roles`);
const vPos = cur.find(r => r.id === cfg.roles.verified).position;
await api(`/guilds/${G}/roles`, 'PATCH', [
  { id: ambassador.id, position: vPos + 1 }, { id: scout.id, position: vPos },
]).catch(e => console.log(' reorder note:', e.message.slice(0, 80)));
console.log(' ⟐ Scout + ◇ Ambassador created');

console.log('== 3. Perk overwrites (image rights in LOUNGE) ==');
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n, ADD_REACT: 1n << 6n, SEND_THREADS: 1n << 38n };
const s = v => v.toString();
const chans = await api(`/guilds/${G}/channels`);
const lounge = chans.find(c => c.type === 4 && c.name.includes('LOUNGE'));
const loungeKids = chans.filter(c => c.parent_id === lounge.id);
for (const c of [lounge, ...loungeKids]) {
  // Scout: attach files; Ambassador: attach + embeds
  await api(`/channels/${c.id}/permissions/${scout.id}`, 'PUT', { type: 0, allow: s(P.ATTACH), deny: '0' });
  await api(`/channels/${c.id}/permissions/${ambassador.id}`, 'PUT', { type: 0, allow: s(P.ATTACH | P.EMBED), deny: '0' });
}
console.log(' lounge perks applied');

console.log('== 4. Emoji polish ==');
const renameCh = async (match, name) => {
  const c = chans.find(x => x.name === match);
  if (c) { await api(`/channels/${c.id}`, 'PATCH', { name }); console.log(` ${match} -> ${name}`); }
  else console.log(` not found: ${match}`);
};
await renameCh('⌬ ─ DOMAINS', '◇ ─ DOMAINS');
await renameCh('⏣・ai-lab', '◎・ai-lab');
await renameCh('☴・ask-an-advisor', '❋・ask-an-advisor');
await renameCh('⇮・rank-ups', '△・rank-ups');
await renameCh('✍・founder-diaries', '✒・founder-diaries');
await renameCh('♪ ─ VOICE', '◉ ─ VOICE');
await renameCh('🗂 ─ TICKETS', '◫ ─ TICKETS');
await renameCh('⏣ Neural Lounge', '◎ Neural Lounge');
await api(`/guilds/${G}/roles/${cfg.roles.ai}`, 'PATCH', { name: '◎ Artificial Intelligence' });
console.log(' role ⏣ -> ◎ Artificial Intelligence');

console.log('== 5. Invite-rewards channel ==');
const hq = chans.find(c => c.type === 4 && c.name.includes('HEADQUARTERS'));
let invCh = chans.find(c => c.name === '⟐・invite-rewards');
if (!invCh) invCh = await api(`/guilds/${G}/channels`, 'POST', {
  name: '⟐・invite-rewards', type: 0, parent_id: hq.id,
  permission_overwrites: [
    { id: G, type: 0, allow: '0', deny: s(P.VIEW) },
    { id: cfg.roles.verified, type: 0, allow: s(P.VIEW | P.ADD_REACT), deny: s(P.SEND) },
    ...[cfg.roles.founder, cfg.roles.core, cfg.roles.mod].map(id => ({ id, type: 0, allow: s(P.VIEW | P.SEND | P.EMBED | P.ATTACH), deny: '0' })),
  ],
});

cfg.roles.scout = scout.id;
cfg.roles.ambassador = ambassador.id;
cfg.channels.inviteRewards = invCh.id;
cfg.invites = {
  xpPerInvite: 75,
  milestones: [
    { count: 3, role: scout.id, name: '⟐ Scout', bonus: 300 },
    { count: 10, role: ambassador.id, name: '◇ Ambassador', bonus: 1000 },
  ],
};
writeFileSync('config.json', JSON.stringify(cfg, null, 2));
console.log('DONE — config.json v3 written');
