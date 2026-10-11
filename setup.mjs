// One-time server rebuild for studio.cyart.io community.
// Wipes all channels, creates roles/channels/AutoMod, writes IDs to config.json.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const BASE = 'https://discord.com/api/v10';

async function api(path, method = 'GET', body) {
  for (;;) {
    const res = await fetch(`${BASE}${path}`, {
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

// permission bits
const P = {
  VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n,
  HISTORY: 1n << 16n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, ADMIN: 1n << 3n,
  KICK: 1n << 1n, BAN: 1n << 2n, MANAGE_MSG: 1n << 13n, TIMEOUT: 1n << 40n,
  MANAGE_CH: 1n << 4n, MANAGE_THREADS: 1n << 34n,
};
const s = v => v.toString();

console.log('== 1. Wipe channels ==');
const existing = await api(`/guilds/${G}/channels`);
const failed = [];
for (const c of existing) {
  try { await api(`/channels/${c.id}`, 'DELETE'); console.log(` deleted #${c.name}`); }
  catch (e) { failed.push(c); console.log(` KEEP #${c.name} (${e.message.slice(0, 80)})`); }
}

console.log('== 2. Roles ==');
const mkRole = (name, color, permissions, hoist = true, mentionable = false) =>
  api(`/guilds/${G}/roles`, 'POST', { name, color, permissions: s(permissions), hoist, mentionable });

const modPerms = P.KICK | P.BAN | P.MANAGE_MSG | P.TIMEOUT | P.MANAGE_THREADS | P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY | P.CONNECT | P.SPEAK;
const memberPerms = P.VIEW | P.SEND | P.HISTORY | P.CONNECT | P.SPEAK; // no EMBED/ATTACH -> no link previews / files

const founder = await mkRole('🏆 Founder', 0xF1C40F, P.ADMIN);
const core = await mkRole('⚙️ Core Team', 0xE67E22, modPerms | P.MANAGE_CH);
const mod = await mkRole('🛡️ Moderator', 0x3498DB, modPerms);
const verified = await mkRole('✅ Verified', 0x2ECC71, memberPerms, false);
console.log(' created Founder/Core Team/Moderator/Verified');

// order among new roles (all sit below Studio Bot): founder > core > mod > verified
await api(`/guilds/${G}/roles`, 'PATCH', [
  { id: founder.id, position: 5 }, { id: core.id, position: 4 },
  { id: mod.id, position: 3 }, { id: verified.id, position: 2 },
]).catch(e => console.log(' reorder skipped:', e.message.slice(0, 80)));

// @everyone: strip perms so unverified see nothing except what overwrites allow
await api(`/guilds/${G}/roles/${G}`, 'PATCH', { permissions: s(P.HISTORY) });
console.log(' @everyone locked down');

console.log('== 3. Channels ==');
const EVERYONE = G;
const STAFF = [founder.id, core.id, mod.id];
const ow = (id, allow = 0n, deny = 0n, type = 0) => ({ id, type, allow: s(allow), deny: s(deny) });
const staffAllow = STAFF.map(id => ow(id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.CONNECT | P.SPEAK));

const mkCh = (name, type, parent_id, permission_overwrites, extra = {}) =>
  api(`/guilds/${G}/channels`, 'POST', { name, type, parent_id, permission_overwrites, ...extra });

// -- INFO (visible to all, read-only)
const catInfo = await mkCh('📌 INFO', 4, null, [
  ow(EVERYONE, P.VIEW, P.SEND), ...staffAllow,
]);
const chWelcome = await mkCh('👋-welcome', 0, catInfo.id);
const chRules = await mkCh('📜-rules', 0, catInfo.id);
const chAnnounce = await mkCh('📢-announcements', 0, catInfo.id);

// -- VERIFY (unverified see it; verified don't)
const catVerify = await mkCh('✅ VERIFICATION', 4, null, [
  ow(EVERYONE, P.VIEW, P.SEND | P.EMBED | P.ATTACH),
  ow(verified.id, 0n, P.VIEW), ...staffAllow,
]);
const chVerify = await mkCh('✅-verify', 0, catVerify.id);

// -- COMMUNITY (verified only)
const communityOw = [
  ow(EVERYONE, 0n, P.VIEW),
  ow(verified.id, P.VIEW | P.SEND, P.EMBED | P.ATTACH), ...staffAllow,
];
const catComm = await mkCh('💬 COMMUNITY', 4, null, communityOw);
const chGeneral = await mkCh('💬-general', 0, catComm.id);
await mkCh('👋-introductions', 0, catComm.id);
await mkCh('🚀-startup-talk', 0, catComm.id);
await mkCh('🎨-showcase', 0, catComm.id, [
  ow(EVERYONE, 0n, P.VIEW),
  ow(verified.id, P.VIEW | P.SEND | P.ATTACH, P.EMBED), ...staffAllow, // images ok, links no
]);
await mkCh('📚-resources', 0, catComm.id, [
  ow(EVERYONE, 0n, P.VIEW),
  ow(verified.id, P.VIEW, P.SEND), ...staffAllow, // staff-curated
]);

// -- SUPPORT
const catSupport = await mkCh('🎫 SUPPORT', 4, null, [
  ow(EVERYONE, 0n, P.VIEW),
  ow(verified.id, P.VIEW, P.SEND), ...staffAllow,
]);
const chTicket = await mkCh('🎫-create-ticket', 0, catSupport.id);
const catTickets = await mkCh('🗂️ TICKETS', 4, null, [
  ow(EVERYONE, 0n, P.VIEW), ...staffAllow,
]);

// -- VOICE (verified only)
const voiceOw = [
  ow(EVERYONE, 0n, P.VIEW | P.CONNECT),
  ow(verified.id, P.VIEW | P.CONNECT | P.SPEAK), ...staffAllow,
];
const catVoice = await mkCh('🔊 VOICE', 4, null, voiceOw);
await mkCh('🛋️ Lounge', 2, catVoice.id);
await mkCh('🎨 Studio Room 1', 2, catVoice.id);
await mkCh('🎨 Studio Room 2', 2, catVoice.id);
await mkCh('🤝 Meeting Room', 2, catVoice.id);
await mkCh('🚀 Pitch Room', 2, catVoice.id);

// -- STAFF
const catStaff = await mkCh('🛡️ STAFF', 4, null, [
  ow(EVERYONE, 0n, P.VIEW), ...staffAllow,
]);
await mkCh('🛡️-staff-chat', 0, catStaff.id);
const chLogs = await mkCh('📋-mod-logs', 0, catStaff.id);
await mkCh('🛡️ Staff VC', 2, catStaff.id);
console.log(' channels created');

console.log('== 4. Guild settings ==');
await api(`/guilds/${G}`, 'PATCH', {
  verification_level: 2,            // must be registered 5+ min
  explicit_content_filter: 2,       // scan all members' media (NSFW removal)
  default_message_notifications: 1, // mentions only
  rules_channel_id: chRules.id,
  public_updates_channel_id: chLogs.id,
  system_channel_id: chWelcome.id,
}).catch(e => console.log(' guild patch partial:', e.message.slice(0, 120)));

// retry channels that failed earlier (old rules channel etc.)
for (const c of failed) {
  await api(`/channels/${c.id}`, 'DELETE')
    .then(() => console.log(` deleted (retry) #${c.name}`))
    .catch(e => console.log(` STILL FAILED #${c.name}: ${e.message.slice(0, 80)}`));
}

console.log('== 5. AutoMod ==');
const exempt = STAFF;
// block links for everyone (staff exempt)
await api(`/guilds/${G}/auto-moderation/rules`, 'POST', {
  name: 'Block links', event_type: 1, trigger_type: 1,
  trigger_metadata: { keyword_filter: ['*http://*', '*https://*', '*www.*', '*discord.gg/*', '*.com*', '*.io*', '*.gg*', '*.xyz*', '*.net*', '*.org*'] },
  actions: [
    { type: 1, metadata: { custom_message: 'Link sharing is not allowed on this server.' } },
    { type: 2, metadata: { channel_id: chLogs.id } },
  ],
  enabled: true, exempt_roles: exempt,
}).catch(e => console.log(' link rule failed:', e.message.slice(0, 200)));
// NSFW / profanity presets
await api(`/guilds/${G}/auto-moderation/rules`, 'POST', {
  name: 'Block NSFW & slurs', event_type: 1, trigger_type: 4,
  trigger_metadata: { presets: [1, 2, 3] },
  actions: [{ type: 1, metadata: {} }, { type: 2, metadata: { channel_id: chLogs.id } }],
  enabled: true, exempt_roles: exempt,
}).catch(e => console.log(' preset rule failed:', e.message.slice(0, 200)));
console.log(' automod rules created');

console.log('== 6. Content ==');
await api(`/channels/${chWelcome.id}/messages`, 'POST', {
  embeds: [{
    title: '👋 Welcome to CyArt Studio',
    description: 'Community hub for **studio.cyart.io** — a startup studio where ideas become products.\n\n**Get started:**\n1. Read <#' + chRules.id + '>\n2. Verify in <#' + chVerify.id + '>\n3. Introduce yourself and join the conversation 🚀',
    color: 0x2ECC71,
  }],
});
await api(`/channels/${chRules.id}/messages`, 'POST', {
  embeds: [{
    title: '📜 Server Rules',
    color: 0x3498DB,
    description: [
      '**1. Be respectful.** No harassment, hate speech, or personal attacks.',
      '**2. No NSFW content.** Zero tolerance — instant ban.',
      '**3. No link sharing.** Links are auto-removed. Staff share official links only.',
      '**4. No spam or self-promo.** No DM advertising, no shilling.',
      '**5. No scams / crypto shills.** Instant ban.',
      '**6. English in public channels.**',
      '**7. Use the right channel.** Need help? Open a ticket in <#' + chTicket.id + '>.',
      '',
      '_Staff decisions are final. Breaking rules = warn → timeout → ban._',
    ].join('\n'),
  }],
});
writeFileSync('config.json', JSON.stringify({
  guildId: G,
  roles: { founder: founder.id, core: core.id, mod: mod.id, verified: verified.id, fam: '932346888487858176' },
  channels: { welcome: chWelcome.id, rules: chRules.id, announcements: chAnnounce.id, verify: chVerify.id, general: chGeneral.id, createTicket: chTicket.id, ticketsCategory: catTickets.id, modLogs: chLogs.id },
}, null, 2));
console.log('DONE. IDs saved to config.json');
