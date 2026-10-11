// v4: domain zones, ⟢ Trusted link unlock (120 XP), booster perks, progressive onboarding channels.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const cfg = JSON.parse(readFileSync('./config.json'));
const BOOSTER = '934233361487114323'; // managed Server Booster role

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

const P = {
  VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n,
  CONNECT: 1n << 20n, SPEAK: 1n << 21n, STREAM: 1n << 9n, ADD_REACT: 1n << 6n,
  THREADS: 1n << 35n, SEND_THREADS: 1n << 38n,
};
const s = v => v.toString();
const ow = (id, allow = 0n, deny = 0n) => ({ id, type: 0, allow: s(allow), deny: s(deny) });
const STAFF = [cfg.roles.founder, cfg.roles.core, cfg.roles.mod];
const staffAllow = STAFF.map(id => ow(id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.CONNECT | P.SPEAK | P.STREAM | P.THREADS | P.SEND_THREADS));
const CHAT = P.VIEW | P.SEND | P.ADD_REACT | P.SEND_THREADS;

console.log('== 1. ⟢ Trusted role (link unlock @ 120 XP) ==');
for (const r of (await api(`/guilds/${G}/roles`)).filter(x => x.name === '⟢ Trusted'))
  await api(`/guilds/${G}/roles/${r.id}`, 'DELETE').catch(() => {});
const trusted = await api(`/guilds/${G}/roles`, 'POST', { name: '⟢ Trusted', color: 0x6FCF97, hoist: false, mentionable: false, permissions: '0' });
// exempt Trusted from the link automod rule ONLY (NSFW rules untouched)
const amRules = await api(`/guilds/${G}/auto-moderation/rules`);
const linkRule = amRules.find(r => r.name === 'Block links');
if (linkRule) await api(`/guilds/${G}/auto-moderation/rules/${linkRule.id}`, 'PATCH', {
  exempt_roles: [...new Set([...linkRule.exempt_roles, trusted.id])],
});
console.log(' ⟢ Trusted created + exempt from link filter');

console.log('== 2. Domain zones ==');
const chans = await api(`/guilds/${G}/channels`);
const byName = n => chans.find(c => c.name === n);
// remove old shared domain channels + old themed VCs + DOMAINS category
const oldDomains = byName('◇ ─ DOMAINS');
const tooling = byName('⚙・tooling-and-stack');
const buildCat = chans.find(c => c.type === 4 && c.name.includes('BUILD ZONE'));
if (tooling) await api(`/channels/${tooling.id}`, 'PATCH', { parent_id: buildCat.id }); // keep tooling, move to BUILD
for (const n of ['⌖・cybersecurity', '◎・ai-lab', '⬡・web3-forge', '⌖ War Room', '◎ Neural Lounge', '⬡ Block Space']) {
  const c = byName(n);
  if (c) await api(`/channels/${c.id}`, 'DELETE').catch(() => {});
}
if (oldDomains) await api(`/channels/${oldDomains.id}`, 'DELETE').catch(() => {});

const mkCh = (name, type, parent_id, permission_overwrites, extra = {}) =>
  api(`/guilds/${G}/channels`, 'POST', { name, type, parent_id, permission_overwrites, ...extra });

async function zone(catName, roleId, textChannels, vcName) {
  const catOw = [
    ow(G, 0n, P.VIEW),
    ow(roleId, CHAT | P.CONNECT | P.SPEAK | P.STREAM, P.EMBED | P.ATTACH),
    ow(trusted.id, P.EMBED),
    ow(BOOSTER, P.EMBED | P.ATTACH),
    ...staffAllow,
  ];
  const cat = await mkCh(catName, 4, null, catOw);
  for (const n of textChannels) await mkCh(n, 0, cat.id, catOw);
  await mkCh(vcName, 2, cat.id, catOw);
  return cat;
}
await zone('⌖ ─ CYBERSEC ZONE', cfg.roles.cyber, ['⌖・cyber-talk', '⌗・vuln-research', '✦・sec-startups'], '⌖ War Room');
await zone('◎ ─ AI ZONE', cfg.roles.ai, ['◎・ai-talk', '⌁・model-lab', '✦・ai-startups'], '◎ Neural Lounge');
await zone('⬡ ─ WEB3 ZONE', cfg.roles.web3, ['⬡・web3-talk', '◈・protocol-lab', '✦・web3-startups'], '⬡ Block Space');
console.log(' three gated zones created (domain role = access)');

console.log('== 3. Trusted/Booster overwrites on shared chat areas ==');
const chans2 = await api(`/guilds/${G}/channels`);
const shared = chans2.filter(c =>
  ['LOUNGE', 'BUILD ZONE', 'MENTORSHIP'].some(k => c.type === 4 && c.name.includes(k)));
for (const cat of shared) {
  const kids = chans2.filter(c => c.parent_id === cat.id && c.type !== 2);
  for (const c of [cat, ...kids]) {
    await api(`/channels/${c.id}/permissions/${trusted.id}`, 'PUT', { type: 0, allow: s(P.EMBED), deny: '0' });
    await api(`/channels/${c.id}/permissions/${BOOSTER}`, 'PUT', { type: 0, allow: s(P.EMBED | P.ATTACH), deny: '0' });
  }
}
console.log(' applied');

console.log('== 4. Onboarding: start-here + trimmed welcome ==');
const gate = chans2.find(c => c.type === 4 && c.name.includes('GATEWAY'));
let startHere = chans2.find(c => c.name === '✧・start-here');
if (!startHere) startHere = await mkCh('✧・start-here', 0, gate.id, [
  ow(G, 0n, P.VIEW),
  ow(cfg.roles.verified, P.VIEW | P.ADD_REACT, P.SEND),
  ...staffAllow,
]);
// trim welcome: wipe old bot messages, post short one
const wm = await api(`/channels/${cfg.channels.welcome}/messages?limit=20`);
for (const m of wm.filter(x => x.author.id === '1524885011294195912'))
  await api(`/channels/${cfg.channels.welcome}/messages/${m.id}`, 'DELETE').catch(() => {});
await api(`/channels/${cfg.channels.welcome}/messages`, 'POST', { embeds: [{
  title: '✧ Welcome to CyArt Studio',
  color: 0xD4AF37,
  description: [
    'The community behind **studio.cyart.io** — startup support for builders in **⌖ Cybersecurity · ◎ AI · ⬡ Web3**.',
    '',
    `**Three steps, that's all:**`,
    `⌘ Read <#${cfg.channels.rules}>`,
    `⌖ Verify in <#${cfg.channels.verify}>`,
    `✎ Say hello in the Lounge`,
    '',
    '_Everything else — ranks, XP, rewards — reveals itself as you participate. Curious now? Peek at ✧・start-here after verifying._',
  ].join('\n'),
}]});
// rules: update rule 3 (links earned at 120 XP)
const rm = await api(`/channels/${cfg.channels.rules}/messages?limit=20`);
for (const m of rm.filter(x => x.author.id === '1524885011294195912'))
  await api(`/channels/${cfg.channels.rules}/messages/${m.id}`, 'DELETE').catch(() => {});
await api(`/channels/${cfg.channels.rules}/messages`, 'POST', { embeds: [{
  title: '⌘ Protocol',
  color: 0x4A78C4,
  description: [
    '**1 · Respect is baseline.** No harassment, hate speech, or personal attacks.',
    '**2 · Zero NSFW.** Content or links — instant ban.',
    '**3 · Links are earned.** Sharing links unlocks at **120 XP** (⟢ Trusted). Until then they auto-delete.',
    '**4 · No spam, shilling, or DM advertising.**',
    '**5 · No scams / token shills.** Instant ban.',
    '**6 · English in public channels.**',
    `**7 · Right channel, right topic.** Help → <#${cfg.channels.createTicket}>.`,
    '**8 · Earn, don\'t farm.** XP farming (spam, one-word floods) gets XP reset.',
    '',
    '_warn → timeout → ban. Staff decisions final._',
  ].join('\n'),
}]});
console.log(' onboarding surfaces rebuilt');

cfg.roles.trusted = trusted.id;
cfg.roles.booster = BOOSTER;
cfg.channels.startHere = startHere.id;
cfg.trustedXp = 120;
cfg.boost = { bonusXp: 500, multiplier: 1.5 };
writeFileSync('config.json', JSON.stringify(cfg, null, 2));
console.log('DONE — config v4');
