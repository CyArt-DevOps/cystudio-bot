// Gamified rebuild v2 — CyArt Studio: startup support for cybersecurity / AI / web3.
// Wipes channels, re-themes roles, adds rank ladder + domain roles, writes config.json.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;

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

const P = {
  VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n,
  HISTORY: 1n << 16n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, STREAM: 1n << 9n,
  ADD_REACT: 1n << 6n, THREADS: 1n << 35n, SEND_THREADS: 1n << 38n,
};
const s = v => v.toString();

// existing role ids
const R = {
  founder: '1524890090483089518', core: '1524890092676710701', mod: '1524890095453343915',
  verified: '1524890097458348244', newcomer: '932346888487858176',
};

console.log('== 1. Re-theme existing roles ==');
const rn = (id, name, color, hoist = true) => api(`/guilds/${G}/roles/${id}`, 'PATCH', { name, color, hoist });
await rn(R.founder, '⚜ Founder', 0xD4AF37);
await rn(R.core, '❖ Core Team', 0xC0632B);
await rn(R.mod, '⚔ Moderator', 0x4A78C4);
await rn(R.verified, '✓ Verified', 0x8899A6, false);
await rn(R.newcomer, '✧ Newcomer', 0x7F8C8D, false);
console.log(' renamed staff/gate roles');

console.log('== 2. Rank + domain roles ==');
// remove duplicates from any earlier partial run
const preRoles = await api(`/guilds/${G}/roles`);
for (const r of preRoles.filter(x => ['◈ Amateur', '★ Pro', '✦ Advisor', '⌖ Cybersecurity', '⏣ Artificial Intelligence', '⬡ Web3'].includes(x.name)))
  await api(`/guilds/${G}/roles/${r.id}`, 'DELETE').catch(() => {});
const mkRole = (name, color, hoist = false, mentionable = false, permissions = '0') =>
  api(`/guilds/${G}/roles`, 'POST', { name, color, hoist, mentionable, permissions });

const amateur = await mkRole('◈ Amateur', 0x3FA7D6, true);
const pro = await mkRole('★ Pro', 0x9B59B6, true);
const advisor = await mkRole('✦ Advisor', 0xE8C547, true, true);
const dCyber = await mkRole('⌖ Cybersecurity', 0x2ECC71, false, true);
const dAI = await mkRole('⏣ Artificial Intelligence', 0xE74C3C, false, true);
const dWeb3 = await mkRole('⬡ Web3', 0xF39C12, false, true);
console.log(' created rank + domain roles');

// hierarchy: bot > staff > advisor > pro > amateur > verified > newcomer > domains > @everyone
await api(`/guilds/${G}/roles`, 'PATCH', [
  { id: R.founder, position: 13 }, { id: R.core, position: 12 }, { id: R.mod, position: 11 },
  { id: advisor.id, position: 10 }, { id: pro.id, position: 9 }, { id: amateur.id, position: 8 },
  { id: R.verified, position: 7 }, { id: R.newcomer, position: 6 },
  { id: dCyber.id, position: 5 }, { id: dAI.id, position: 4 }, { id: dWeb3.id, position: 3 },
]);
console.log(' hierarchy ordered');

console.log('== 3. Wipe channels ==');
// disable COMMUNITY so required channels can go too, re-enable at the end
const g0 = await api(`/guilds/${G}`);
await api(`/guilds/${G}`, 'PATCH', { features: g0.features.filter(f => f !== 'COMMUNITY') });
for (const c of await api(`/guilds/${G}/channels`)) {
  await api(`/channels/${c.id}`, 'DELETE').catch(e => console.log(` keep ${c.name}: ${e.message.slice(0, 60)}`));
}
console.log(' wiped');

console.log('== 4. Channels ==');
const EV = G, STAFF = [R.founder, R.core, R.mod];
const ow = (id, allow = 0n, deny = 0n) => ({ id, type: 0, allow: s(allow), deny: s(deny) });
const staffAllow = STAFF.map(id => ow(id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.CONNECT | P.SPEAK | P.STREAM | P.THREADS | P.SEND_THREADS));
const mkCh = (name, type, parent_id, permission_overwrites, extra = {}) =>
  api(`/guilds/${G}/channels`, 'POST', { name, type, parent_id, permission_overwrites, ...extra });

const CHAT = P.VIEW | P.SEND | P.ADD_REACT | P.SEND_THREADS;
const READ = P.VIEW | P.ADD_REACT;

// ── GATEWAY (public, read-only)
const catGate = await mkCh('◈ ─ GATEWAY', 4, null, [ow(EV, READ, P.SEND), ...staffAllow]);
const chWelcome = await mkCh('✧・welcome', 0, catGate.id);
const chRules = await mkCh('⌘・rules', 0, catGate.id);
const chVerify = await mkCh('⌖・verify', 0, catGate.id, [
  ow(EV, P.VIEW, P.SEND), ow(R.verified, 0n, P.VIEW), ...staffAllow,
]);
const chPath = await mkCh('⟡・choose-your-path', 0, catGate.id, [
  ow(EV, 0n, P.VIEW), ow(R.verified, P.VIEW, P.SEND), ...staffAllow,
]);

// ── HEADQUARTERS (verified, read-only)
const hqOw = [ow(EV, 0n, P.VIEW), ow(R.verified, READ, P.SEND), ...staffAllow];
const catHQ = await mkCh('✦ ─ HEADQUARTERS', 4, null, hqOw);
const chAnnounce = await mkCh('⚑・announcements', 0, catHQ.id); // converted to type 5 after COMMUNITY re-enable
const chEvents = await mkCh('◈・events', 0, catHQ.id);
const chFame = await mkCh('♕・hall-of-fame', 0, catHQ.id);
const chBoard = await mkCh('⌗・leaderboard', 0, catHQ.id);
const chRankUp = await mkCh('⇮・rank-ups', 0, catHQ.id);

// ── LOUNGE (verified chat)
const loungeOw = [ow(EV, 0n, P.VIEW), ow(R.verified, CHAT, P.EMBED | P.ATTACH), ...staffAllow];
const catLounge = await mkCh('◆ ─ LOUNGE', 4, null, loungeOw);
const chGeneral = await mkCh('✎・general', 0, catLounge.id);
await mkCh('✉・introductions', 0, catLounge.id);
await mkCh('☕・water-cooler', 0, catLounge.id);
const chWins = await mkCh('⚡・wins', 0, catLounge.id, [
  ow(EV, 0n, P.VIEW), ow(R.verified, CHAT | P.ATTACH, P.EMBED), ...staffAllow,
]);

// ── DOMAINS (verified chat; domain roles pingable)
const catDom = await mkCh('⌬ ─ DOMAINS', 4, null, loungeOw);
await mkCh('⌖・cybersecurity', 0, catDom.id);
await mkCh('⏣・ai-lab', 0, catDom.id);
await mkCh('⬡・web3-forge', 0, catDom.id);
await mkCh('⚙・tooling-and-stack', 0, catDom.id);

// ── BUILD ZONE (progression-gated posting)
const catBuild = await mkCh('⟡ ─ BUILD ZONE', 4, null, loungeOw);
await mkCh('✦・startup-ideas', 0, catBuild.id);
await mkCh('◈・feedback-exchange', 15, catBuild.id, [
  ow(EV, 0n, P.VIEW),
  ow(R.verified, P.VIEW | P.SEND_THREADS | P.SEND | P.ADD_REACT, P.EMBED | P.ATTACH), ...staffAllow,
], { topic: 'Post your product / landing page / deck for structured feedback. One thread per project.' });
const chShowcase = await mkCh('⌘・showcase', 0, catBuild.id, [ // Amateur+ post
  ow(EV, 0n, P.VIEW), ow(R.verified, READ, P.SEND),
  ow(amateur.id, CHAT | P.ATTACH), ow(pro.id, CHAT | P.ATTACH), ow(advisor.id, CHAT | P.ATTACH), ...staffAllow,
]);
await mkCh('⌗・resources', 0, catBuild.id, [ // Pro+ post
  ow(EV, 0n, P.VIEW), ow(R.verified, READ, P.SEND),
  ow(pro.id, CHAT), ow(advisor.id, CHAT), ...staffAllow,
]);
await mkCh('✍・founder-diaries', 0, catBuild.id, [ // Amateur+ post
  ow(EV, 0n, P.VIEW), ow(R.verified, READ, P.SEND),
  ow(amateur.id, CHAT | P.SEND_THREADS), ow(pro.id, CHAT | P.SEND_THREADS), ow(advisor.id, CHAT | P.SEND_THREADS), ...staffAllow,
]);

// ── MENTORSHIP
const catMentor = await mkCh('✦ ─ MENTORSHIP', 4, null, loungeOw);
await mkCh('☴・ask-an-advisor', 0, catMentor.id);
await mkCh('◉・office-hours', 0, catMentor.id, [
  ow(EV, 0n, P.VIEW), ow(R.verified, READ, P.SEND), ow(advisor.id, CHAT), ...staffAllow,
]);
await mkCh('✦・advisor-lounge', 0, catMentor.id, [ // Advisor-only perk
  ow(EV, 0n, P.VIEW), ow(advisor.id, CHAT | P.EMBED | P.ATTACH), ...staffAllow,
]);

// ── SUPPORT
const catSup = await mkCh('⌘ ─ SUPPORT', 4, null, [
  ow(EV, 0n, P.VIEW), ow(R.verified, P.VIEW, P.SEND), ...staffAllow,
]);
const chTicket = await mkCh('✉・open-a-ticket', 0, catSup.id);
const catTickets = await mkCh('🗂 ─ TICKETS', 4, null, [ow(EV, 0n, P.VIEW), ...staffAllow]);

// ── VOICE
const vOw = [ow(EV, 0n, P.VIEW | P.CONNECT), ow(R.verified, P.VIEW | P.CONNECT | P.SPEAK | P.STREAM), ...staffAllow];
const catVoice = await mkCh('♪ ─ VOICE', 4, null, vOw);
await mkCh('◈ Commons', 2, catVoice.id);
await mkCh('⌖ War Room', 2, catVoice.id);
await mkCh('⏣ Neural Lounge', 2, catVoice.id);
await mkCh('⬡ Block Space', 2, catVoice.id);
await mkCh('✦ Pitch Deck', 2, catVoice.id);
await mkCh('◉ Deep Focus', 2, catVoice.id, undefined, { user_limit: 4 });

// ── STAFF
const catStaff = await mkCh('⚔ ─ STAFF', 4, null, [ow(EV, 0n, P.VIEW), ...staffAllow]);
await mkCh('⚔・staff-chat', 0, catStaff.id);
const chLogs = await mkCh('⌗・mod-logs', 0, catStaff.id);
await mkCh('⚔ Staff VC', 2, catStaff.id);
console.log(' channels created');

console.log('== 5. Community + automod re-point ==');
await api(`/guilds/${G}`, 'PATCH', {
  features: [...g0.features.filter(f => f !== 'COMMUNITY'), 'COMMUNITY'],
  rules_channel_id: chRules.id, public_updates_channel_id: chLogs.id,
  system_channel_id: chWelcome.id, verification_level: 2, explicit_content_filter: 2,
  default_message_notifications: 1,
});
await api(`/channels/${chAnnounce.id}`, 'PATCH', { type: 5 }).catch(() => {});
// automod log channel moved -> update alert channel ids
const rules = await api(`/guilds/${G}/auto-moderation/rules`);
for (const r of rules) {
  const actions = r.actions.map(a => a.type === 2 ? { type: 2, metadata: { channel_id: chLogs.id } } : a);
  await api(`/guilds/${G}/auto-moderation/rules/${r.id}`, 'PATCH', { actions }).catch(() => {});
}
console.log(' done');

console.log('== 6. Static content ==');
await api(`/channels/${chWelcome.id}/messages`, 'POST', { embeds: [{
  title: '✧ Welcome to CyArt Studio',
  color: 0xD4AF37,
  description: [
    'The community behind **studio.cyart.io** — startup support for builders in **⌖ Cybersecurity**, **⏣ AI**, and **⬡ Web3**.',
    '',
    '**Start here**',
    `⌘ Read <#${chRules.id}>`,
    `⌖ Verify in <#${chVerify.id}>`,
    `⟡ Pick your domain in <#${chPath.id}>`,
    '',
    '**Earn your rank** — everything you do here builds XP:',
    '✧ **Newcomer** → ◈ **Amateur** (300 XP) → ★ **Pro** (2,500 XP) → ✦ **Advisor** (10,000 XP)',
    '',
    '· Chatting earns 15–25 XP per message (1/min)',
    '· Voice time earns 8 XP per 5 minutes',
    `· Posting in <#${chWins.id}> earns a +40 XP bonus`,
    '',
    '**Rank perks**',
    '◈ Amateur — post in ⌘·showcase & ✍·founder-diaries',
    '★ Pro — publish in ⌗·resources, shape the knowledge base',
    '✦ Advisor — private ✦·advisor-lounge, mentor status, host office-hours',
    '',
    `Check \`/rank\` anytime · standings live in <#${chBoard.id}>`,
  ].join('\n'),
}]});
await api(`/channels/${chRules.id}/messages`, 'POST', { embeds: [{
  title: '⌘ Protocol',
  color: 0x4A78C4,
  description: [
    '**1 · Respect is baseline.** No harassment, hate speech, or personal attacks.',
    '**2 · Zero NSFW.** Instant ban.',
    '**3 · No links.** Auto-removed. Staff share official links only.',
    '**4 · No spam, shilling, or DM advertising.**',
    '**5 · No scams / token shills.** Instant ban.',
    '**6 · English in public channels.**',
    `**7 · Right channel, right topic.** Help → <#${chTicket.id}>.`,
    '**8 · Earn, don\'t farm.** XP farming (spam, one-word floods) gets XP reset.',
    '',
    '_warn → timeout → ban. Staff decisions final._',
  ].join('\n'),
}]});
await api(`/channels/${chFame.id}/messages`, 'POST', { embeds: [{
  title: '♕ Hall of Fame',
  color: 0xE8C547,
  description: 'Launched a product? Landed funding? Shipped something remarkable?\nStaff immortalize the biggest community wins here.',
}]});

writeFileSync('config.json', JSON.stringify({
  guildId: G,
  roles: {
    founder: R.founder, core: R.core, mod: R.mod, verified: R.verified, newcomer: R.newcomer,
    amateur: amateur.id, pro: pro.id, advisor: advisor.id,
    cyber: dCyber.id, ai: dAI.id, web3: dWeb3.id,
  },
  ranks: [
    { xp: 0, role: R.newcomer, name: '✧ Newcomer' },
    { xp: 300, role: amateur.id, name: '◈ Amateur' },
    { xp: 2500, role: pro.id, name: '★ Pro' },
    { xp: 10000, role: advisor.id, name: '✦ Advisor' },
  ],
  channels: {
    welcome: chWelcome.id, rules: chRules.id, announcements: chAnnounce.id, events: chEvents.id,
    verify: chVerify.id, path: chPath.id, general: chGeneral.id, wins: chWins.id,
    showcase: chShowcase.id, leaderboard: chBoard.id, rankUps: chRankUp.id, fame: chFame.id,
    createTicket: chTicket.id, ticketsCategory: catTickets.id, modLogs: chLogs.id,
  },
}, null, 2));
console.log('DONE — config.json v2 written');
