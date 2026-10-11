// Studio Bot v5 — verification, tickets, domain paths, XP rank engine,
// + phase-gated pillar modules: quests, campus ambassadors, intern waves, mod pipeline.
// CyArt Studio (studio.cyart.io): startup support for cybersecurity / AI / web3.
import 'dotenv/config';
process.on('unhandledRejection', e => console.error('unhandled rejection:', e));
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits as PF, MessageFlags,
  SlashCommandBuilder, Routes, REST,
} from 'discord.js';
import * as quests from './modules/quests.mjs';
import * as campus from './modules/campus.mjs';
import * as interns from './modules/interns.mjs';
import * as modpipeline from './modules/modpipeline.mjs';
import * as engagement from './modules/engagement.mjs';

const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
// /phase toggles persist in data/ so deploys can overwrite config.json without losing them
const PHASES_FILE = 'data/phases.json';
if (existsSync(PHASES_FILE)) cfg.phases = JSON.parse(readFileSync(PHASES_FILE));
const saveCfg = () => writeFileSync(PHASES_FILE, JSON.stringify(cfg.phases ?? {}, null, 2));
const RANKS = cfg.ranks; // ascending xp thresholds

// ── XP store (data/xp.json, debounced writes)
mkdirSync('data', { recursive: true });
const XP_FILE = 'data/xp.json';
const db = existsSync(XP_FILE) ? JSON.parse(readFileSync(XP_FILE)) : {};
let dirty = false;
const flushDb = () => { if (dirty) { try { writeFileSync(XP_FILE, JSON.stringify(db)); dirty = false; } catch (e) { console.error('db flush failed:', e); } } };
setInterval(flushDb, 15_000);
const user = id => (db[id] ??= { xp: 0, lastMsg: 0, lastBonus: 0 });

const rankFor = xp => [...RANKS].reverse().find(r => xp >= r.xp);
const nextRank = xp => RANKS.find(r => r.xp > xp);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildInvites],
});

// ── v5 pillar modules: phase-gated, rolled out one per week via /phase
const MODULES = [quests, campus, interns, modpipeline, engagement];
const hooks = { inviteUsed: [] }; // (member, code, inviterId) — fired on every tracked join
const ctx = {
  client, cfg, db, user,
  addXp: (...a) => addXp(...a),
  syncRank: (...a) => syncRank(...a),
  markDirty: () => { dirty = true; },
  hooks,
  phase: k => !!cfg.phases?.[k],
  liveQuestDomains: () => quests.liveDomains(),
  saveCfg,
};
for (const m of MODULES) m.init?.(ctx);

// ── invite tracking: cache code->uses, diff on join to credit inviter
const inviteCache = new Map();
const inv = id => { const u = user(id); u.inv ??= { n: 0, ids: [] }; return u.inv; };

async function cacheInvites() {
  const guild = client.guilds.cache.get(cfg.guildId);
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  inviteCache.clear();
  for (const [code, i] of invites) inviteCache.set(code, { uses: i.uses ?? 0, inviterId: i.inviterId });
}

async function creditInvite(member) {
  const guild = member.guild;
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  let inviterId = null, usedCode = null;
  for (const [code, i] of invites) {
    const prev = inviteCache.get(code);
    if (prev && (i.uses ?? 0) > prev.uses) { inviterId = i.inviterId; usedCode = code; break; }
    if (!prev && (i.uses ?? 0) > 0 && !usedCode) { inviterId = i.inviterId; usedCode = code; }
  }
  for (const [code, i] of invites) inviteCache.set(code, { uses: i.uses ?? 0, inviterId: i.inviterId });

  // module hooks first (ambassador recruit credit, intern wave role) — they run
  // even for bot-created invites, which the personal-XP path below skips
  if (!member.user.bot)
    for (const h of hooks.inviteUsed) await h(member, usedCode, inviterId).catch(() => {});

  if (!inviterId || inviterId === member.id || member.user.bot) return;
  if (inviterId === client.user.id) return; // bot-created invite (wave/ambassador) — no personal XP credit

  const rec = inv(inviterId);
  if (rec.ids.includes(member.id)) return; // rejoin farming — no double credit
  rec.ids.push(member.id); rec.n++; dirty = true;

  const inviter = await guild.members.fetch(inviterId).catch(() => null);
  if (!inviter) return;
  await addXp(inviter, cfg.invites.xpPerInvite);
  for (const m of cfg.invites.milestones) {
    if (rec.n === m.count && !inviter.roles.cache.has(m.role)) {
      await inviter.roles.add(m.role).catch(() => {});
      await addXp(inviter, m.bonus);
      const ch = await client.channels.fetch(cfg.channels.rankUps).catch(() => null);
      if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0x38B6FF)
        .setDescription(`⟐ **Milestone!** ${inviter} reached **${m.count} invites** → **${m.name}** (+${m.bonus} XP)`)] });
    }
  }
}

// ── rank sync: ensure member holds exactly their earned rank role
async function syncRank(member, announce = true) {
  const xp = user(member.id).xp;
  const target = rankFor(xp);
  if (member.roles.cache.has(target.role)) return;
  const others = RANKS.filter(r => r.role !== target.role && member.roles.cache.has(r.role)).map(r => r.role);
  await member.roles.add(target.role).catch(() => {});
  for (const r of others) await member.roles.remove(r).catch(() => {});
  if (announce && target.xp > 0) {
    const ch = await client.channels.fetch(cfg.channels.rankUps).catch(() => null);
    if (ch) ch.send({ embeds: [new EmbedBuilder()
      .setColor(0xE8C547)
      .setDescription(`⇮ **Rank up!** ${member} ascended to **${target.name}** — ${xp.toLocaleString()} XP`)] });
  }
}

// ── progressive onboarding: one tip at a time, delivered when it becomes relevant
const TIPS = {
  t50: (u) => `✧ You're at **${u.xp} XP** — every message (15–25 XP/min), voice minute, and ⚡wins post moves you up.\nRanks unlock perks: ◈ Amateur at 300 → ◆ Builder at 1,000 → ★ Pro at 2,500 → ✦ Advisor at 10,000.\nFastest XP in the server: quest solves (60–150 each). See ✧・start-here for the full map.`,
  t120: () => `⟢ **Trusted unlocked!** At 120 XP you've earned link-sharing rights — your links no longer auto-delete.\nKeep them clean: NSFW links are an instant ban, no exceptions.`,
};
async function sendTip(member, key) {
  const u = user(member.id);
  u.tips ??= [];
  if (u.tips.includes(key)) return;
  u.tips.push(key); dirty = true;
  await member.send({ embeds: [new EmbedBuilder().setColor(0x6FCF97)
    .setTitle('CyArt Studio').setDescription(TIPS[key](u))] }).catch(() => {});
}

async function addXp(member, amount) {
  const u = user(member.id);
  const before = rankFor(u.xp);
  if (member.roles.cache.has(cfg.roles.booster)) amount = Math.round(amount * cfg.boost.multiplier);
  u.xp += amount; dirty = true;
  if (rankFor(u.xp) !== before) await syncRank(member);
  if (u.xp >= 50) await sendTip(member, 't50');
  if (u.xp >= cfg.trustedXp && !member.roles.cache.has(cfg.roles.trusted)) {
    await member.roles.add(cfg.roles.trusted).catch(() => {});
    await sendTip(member, 't120');
  }
}

// ── message XP: 15–25, 60s cooldown; wins/showcase bonus +40, 1h cooldown
client.on('messageCreate', async (m) => {
  if (m.author.bot || !m.inGuild() || m.guildId !== cfg.guildId) return;
  const u = user(m.author.id);
  const now = Date.now();
  let gain = 0;
  if (now - u.lastMsg >= 60_000) { gain += 15 + Math.floor(Math.random() * 11); u.lastMsg = now; }
  // very first message ever → visible spark. First action must get feedback within seconds.
  if (gain && u.xp === 0) m.react('⚡').catch(() => {});
  if ([cfg.channels.wins, cfg.channels.showcase].includes(m.channelId) && now - u.lastBonus >= 3_600_000) {
    gain += 40; u.lastBonus = now;
    m.react('⚡').catch(() => {});
  }
  if (gain) await addXp(m.member, gain);
});

// ── voice XP: +8 per 5 min when not alone
setInterval(async () => {
  const guild = client.guilds.cache.get(cfg.guildId);
  if (!guild) return;
  for (const [, vs] of guild.voiceStates.cache) {
    if (!vs.channel || !vs.member || vs.member.user.bot) continue;
    const humans = vs.channel.members.filter(mm => !mm.user.bot);
    if (humans.size >= 2) await addXp(vs.member, 8);
  }
}, 300_000);

// ── leaderboard channel refresh (hourly)
async function refreshLeaderboard() {
  const guild = client.guilds.cache.get(cfg.guildId);
  const ch = await client.channels.fetch(cfg.channels.leaderboard).catch(() => null);
  if (!guild || !ch) return;
  const top = Object.entries(db).sort((a, b) => b[1].xp - a[1].xp).slice(0, 15);
  const medals = ['♕', '♖', '♗'];
  const lines = await Promise.all(top.map(async ([id, u], i) => {
    const m = await guild.members.fetch(id).catch(() => null);
    const tag = m ? m.displayName : 'departed member';
    return `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} **${tag}** · ${rankFor(u.xp).name} · ${u.xp.toLocaleString()} XP`;
  }));
  const embed = new EmbedBuilder().setTitle('⌗ Leaderboard').setColor(0x9B59B6)
    .setDescription(lines.join('\n') || 'No XP earned yet — be the first.')
    .setFooter({ text: 'Refreshes hourly · earn XP by chatting, voice, and posting wins' })
    .setTimestamp();
  // second board: the monthly quest race — resets on the 1st, so it's winnable by
  // anyone who joined yesterday. The all-time board honors veterans; this one recruits.
  const qtop = Object.entries(db).filter(([, u]) => u.q?.qp > 0)
    .sort((a, b) => b[1].q.qp - a[1].q.qp).slice(0, 10);
  const qlines = await Promise.all(qtop.map(async ([id, u], i) => {
    const m = await guild.members.fetch(id).catch(() => null);
    return `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} **${m ? m.displayName : 'departed member'}** · ${u.q.qp} QP`;
  }));
  const qEmbed = new EmbedBuilder().setTitle('⚔ Monthly Quest Race').setColor(0xE8C547)
    .setDescription(qlines.join('\n') || 'Nobody has solved a quest yet this month — the board is wide open.')
    .setFooter({ text: 'Resets on the 1st · anyone can win this · #1 takes ⚔ Quest Champion' });
  const msgs = await ch.messages.fetch({ limit: 10 });
  const mine = msgs.find(mm => mm.author.id === client.user.id);
  if (mine) await mine.edit({ embeds: [embed, qEmbed] }); else await ch.send({ embeds: [embed, qEmbed] });
}

// ── panels (idempotent)
async function ensurePanel(channelId, matchTitle, payload) {
  const ch = await client.channels.fetch(channelId);
  const msgs = await ch.messages.fetch({ limit: 20 });
  if (msgs.some(m => m.author.id === client.user.id && m.embeds[0]?.title === matchTitle)) return;
  await ch.send(payload);
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.APP_ID, cfg.guildId), { body: [
    new SlashCommandBuilder().setName('rank').setDescription('Your XP, rank, and progress to the next tier')
      .addUserOption(o => o.setName('user').setDescription('Check someone else')).toJSON(),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Top 15 members by XP').toJSON(),
    new SlashCommandBuilder().setName('invites').setDescription('Your invite count and next reward')
      .addUserOption(o => o.setName('user').setDescription('Check someone else')).toJSON(),
    new SlashCommandBuilder().setName('grant-xp').setDescription('Staff: grant bonus XP')
      .setDefaultMemberPermissions(String(PF.ModerateMembers))
      .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('XP amount (can be negative)').setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName('phase').setDescription('Staff: staged rollout of v5 pillars')
      .setDefaultMemberPermissions(String(PF.ManageGuild))
      .addSubcommand(s => s.setName('list').setDescription('Show phase states'))
      .addSubcommand(s => s.setName('set').setDescription('Toggle a phase')
        .addStringOption(o => o.setName('name').setDescription('Phase').setRequired(true)
          .addChoices(...['quests', 'campus', 'interns', 'modpipeline', 'engage'].map(p => ({ name: p, value: p }))))
        .addStringOption(o => o.setName('state').setDescription('on/off').setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))).toJSON(),
    ...MODULES.flatMap(m => m.commands?.(cfg) ?? []),
  ]});

  await ensurePanel(cfg.channels.verify, '⌖ Verification', {
    embeds: [new EmbedBuilder().setTitle('⌖ Verification').setColor(0x2ECC71)
      .setDescription('Welcome to **CyArt Studio**.\n\nVerify to unlock the community and start earning XP.\nBy verifying you accept the protocol in ⌘・rules.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify').setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success))],
  });

  await ensurePanel(cfg.channels.path, '⟡ Choose Your Path', {
    embeds: [new EmbedBuilder().setTitle('⟡ Choose Your Path').setColor(0xD4AF37)
      .setDescription('Pick the domains you build in — toggle anytime.\nDomain roles are pingable for domain events, drops, and collabs.\n\n⌖ **Cybersecurity** — offensive/defensive, appsec, compliance\n⏣ **Artificial Intelligence** — ML, LLMs, agents, infra\n⬡ **Web3** — protocols, smart contracts, tokenomics')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('path_cyber').setLabel('Cybersecurity').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('path_ai').setLabel('AI').setEmoji('🧠').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('path_web3').setLabel('Web3').setEmoji('⛓️').setStyle(ButtonStyle.Secondary))],
  });

  await ensurePanel(cfg.channels.createTicket, '✉ Support Tickets', {
    embeds: [new EmbedBuilder().setTitle('✉ Support Tickets').setColor(0x4A78C4)
      .setDescription('Need help, a partnership, or a private word with staff about **studio.cyart.io**?\nOpen a confidential ticket below.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary))],
  });

  await ensurePanel(cfg.channels.startHere, '✧ Start Here', {
    embeds: [new EmbedBuilder().setTitle('✧ Start Here').setColor(0xD4AF37)
      .setDescription('No wall of text. Tap what you want to know — answers are private, read at your pace.\n\nThe short version: **participate, earn XP, unlock the server piece by piece.**')],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('guide_xp').setLabel('XP & Ranks').setEmoji('📈').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('guide_domains').setLabel('Domain Zones').setEmoji('🗺️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('guide_links').setLabel('Link Rights').setEmoji('🔗').setStyle(ButtonStyle.Secondary)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('guide_invites').setLabel('Invite Rewards').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('guide_boost').setLabel('Boost Perks').setEmoji('💠').setStyle(ButtonStyle.Secondary)),
    ],
  });

  await ensurePanel(cfg.channels.inviteRewards, '⟐ Invite Rewards', {
    embeds: [new EmbedBuilder().setTitle('⟐ Invite Rewards').setColor(0x38B6FF)
      .setDescription([
        'Grow the studio — every builder you bring in pays you back.',
        '',
        `**Per invite** · +${cfg.invites.xpPerInvite} XP toward your rank`,
        '',
        '**Milestones**',
        '⟐ **Scout** — 3 invites · +300 XP · image rights in the Lounge',
        '◇ **Ambassador** — 10 invites · +1,000 XP · hoisted profile badge, embeds + images everywhere in the Lounge',
        '',
        'Right-click the server → *Invite People* to get your link.',
        'Track progress with `/invites`. Rejoin farming does not count.',
      ].join('\n'))],
  });

  await cacheInvites();
  await refreshLeaderboard();
  setInterval(refreshLeaderboard, 3_600_000);

  // module heartbeat: quest drops/closures, monthly resets, probation reminders
  const tickAll = async () => {
    for (const m of MODULES) {
      try { await m.tick?.(ctx); } catch (e) { console.error('module tick error:', e); }
    }
  };
  await tickAll();
  setInterval(tickAll, 600_000);
  console.log('Panels + leaderboard + invite cache + module ticks ensured.');
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== cfg.guildId) return;
  await member.roles.add(cfg.roles.newcomer).catch(() => {});
  await creditInvite(member).catch(() => {});
  // private owner-only join feed (replaces the system message in ✧・welcome)
  if (cfg.channels.joinLog) {
    const ch = await client.channels.fetch(cfg.channels.joinLog).catch(() => null);
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0x5DADE2)
      .setAuthor({ name: `${member.user.tag} joined`, iconURL: member.user.displayAvatarURL() })
      .setDescription(`${member} • \`${member.id}\`${member.user.bot ? ' • **BOT**' : ''}`)
      .addFields(
        { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members', value: String(member.guild.memberCount), inline: true },
      )
      .setTimestamp()] }).catch(() => {});
  }
});
client.on('inviteCreate', i => inviteCache.set(i.code, { uses: i.uses ?? 0, inviterId: i.inviterId }));
client.on('inviteDelete', i => inviteCache.delete(i.code));

// ── server boost reward: +500 XP instantly, 1.5x XP forever while boosting
client.on('guildMemberUpdate', async (oldM, newM) => {
  if (newM.guild.id !== cfg.guildId) return;
  if (!oldM.premiumSince && newM.premiumSince) {
    await addXp(newM, cfg.boost.bonusXp);
    const ch = await client.channels.fetch(cfg.channels.rankUps).catch(() => null);
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xF47FFF)
      .setDescription(`♦ **${newM} boosted the studio!** +${cfg.boost.bonusXp} XP and a **${cfg.boost.multiplier}× XP multiplier** while boosting. Thank you.`)] });
  }
});

const PATHS = { path_cyber: 'cyber', path_ai: 'ai', path_web3: 'web3' };

client.on('interactionCreate', async (i) => {
  // ── v5 modules get first pass (their buttons/modals/commands are namespaced)
  for (const m of MODULES) {
    try { if (await m.onInteraction?.(i, ctx)) return; }
    catch (e) { console.error('module interaction error:', e); return; }
  }

  // ── phase rollout control
  if (i.isChatInputCommand() && i.commandName === 'phase') {
    cfg.phases ??= { quests: false, campus: false, interns: false, modpipeline: false, engage: false };
    if (i.options.getSubcommand() === 'set') {
      const name = i.options.getString('name', true);
      cfg.phases[name] = i.options.getString('state', true) === 'on';
      saveCfg();
    }
    return i.reply({ embeds: [new EmbedBuilder().setTitle('⚙ Rollout Phases').setColor(0x4A78C4)
      .setDescription(Object.entries(cfg.phases).map(([k, v]) => `${v ? '🟢' : '⚫'} **${k}**`).join('\n'))
      .setFooter({ text: 'Recommended order: quests → interns → campus → modpipeline, one per week' })],
      flags: MessageFlags.Ephemeral });
  }

  // ── slash commands
  if (i.isChatInputCommand()) {
    if (i.commandName === 'rank') {
      const target = i.options.getUser('user') ?? i.user;
      const u = user(target.id);
      const cur = rankFor(u.xp), nxt = nextRank(u.xp);
      const bar = nxt
        ? (() => { const p = (u.xp - cur.xp) / (nxt.xp - cur.xp); const f = Math.round(p * 12);
            return `\`${'▰'.repeat(f)}${'▱'.repeat(12 - f)}\` ${u.xp.toLocaleString()} / ${nxt.xp.toLocaleString()} XP → ${nxt.name}`; })()
        : `\`▰▰▰▰▰▰▰▰▰▰▰▰\` **Max rank** · ${u.xp.toLocaleString()} XP`;
      return i.reply({ embeds: [new EmbedBuilder().setColor(0x9B59B6)
        .setAuthor({ name: target.displayName ?? target.username, iconURL: target.displayAvatarURL() })
        .setDescription(`**Rank:** ${cur.name}\n${bar}`)], flags: MessageFlags.Ephemeral });
    }
    if (i.commandName === 'invites') {
      const target = i.options.getUser('user') ?? i.user;
      const rec = inv(target.id);
      const next = cfg.invites.milestones.find(m => rec.n < m.count);
      return i.reply({ embeds: [new EmbedBuilder().setColor(0x38B6FF)
        .setAuthor({ name: target.displayName ?? target.username, iconURL: target.displayAvatarURL() })
        .setDescription(`⟐ **Invites:** ${rec.n}\n${next
          ? `Next reward: **${next.name}** at ${next.count} invites (${next.count - rec.n} to go)`
          : 'All invite milestones unlocked ◇'}`)], flags: MessageFlags.Ephemeral });
    }
    if (i.commandName === 'leaderboard') {
      await refreshLeaderboard();
      return i.reply({ content: `Standings updated → <#${cfg.channels.leaderboard}>`, flags: MessageFlags.Ephemeral });
    }
    if (i.commandName === 'grant-xp') {
      const target = i.options.getUser('user', true);
      const amount = i.options.getInteger('amount', true);
      const u = user(target.id);
      u.xp = Math.max(0, u.xp + amount); dirty = true;
      const member = await i.guild.members.fetch(target.id).catch(() => null);
      if (member) await syncRank(member);
      return i.reply({ content: `Granted **${amount} XP** to ${target} (now ${u.xp.toLocaleString()}).`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (!i.isButton()) return;

  // ── verify
  if (i.customId === 'verify') {
    if (i.member.roles.cache.has(cfg.roles.verified))
      return i.reply({ content: 'Already verified ✓', flags: MessageFlags.Ephemeral });
    await i.member.roles.add(cfg.roles.verified);
    await syncRank(i.member, false); // gives ✧ Newcomer if no rank yet
    return i.reply({ content: `Verified ✓\n\nThree things, in order:\n⟡ Pick your domain in <#${cfg.channels.path}> — it opens your zone\n✎ Say hello in <#${cfg.channels.general}> — your first message earns XP instantly\n⚔ Try the live challenge in <#${cfg.channels.quests}> — solve it and you're on the board day one\n\nThe rest you'll discover as you go. Curious? <#${cfg.channels.startHere}>`, flags: MessageFlags.Ephemeral });
  }

  // ── start-here guide pages (ephemeral, on demand)
  const GUIDES = {
    guide_xp: ['📈 XP & Ranks', [
      '**Earning XP**',
      '· Messages — 15–25 XP (once per minute)',
      '· Voice — 8 XP per 5 min (with at least one other human)',
      '· Posting in ⚡・wins or ⌘・showcase — +40 XP bonus (hourly)',
      '',
      '**The ladder**',
      '✧ Newcomer → ◈ **Amateur** (300 XP): post in showcase & founder-diaries',
      '→ ◆ **Builder** (1,000): hoisted name — you\'re visible in the member list',
      '→ ★ **Pro** (2,500): publish in ⌗・resources',
      '→ ✦ **Advisor** (10,000): private lounge, mentor status, office-hours voice',
      '',
      'Check `/rank` anytime · top 15 live in ⌗・leaderboard',
    ]],
    guide_domains: ['🗺️ Domain Zones', [
      'Each domain has its own private zone — channels + a voice room only its members see.',
      '',
      '⌖ **Cybersec Zone** — cyber-talk, vuln-research, sec-startups, War Room VC',
      '◎ **AI Zone** — ai-talk, model-lab, ai-startups, Neural Lounge VC',
      '⬡ **Web3 Zone** — web3-talk, protocol-lab, web3-startups, Block Space VC',
      '',
      `Join or leave any zone with the buttons in <#${cfg.channels.path}>. Pick as many as you build in.`,
    ]],
    guide_links: ['🔗 Link Rights', [
      'Links are **earned, not given** — new accounts can\'t paste links here.',
      '',
      'At **120 XP** you automatically receive ⟢ **Trusted**: your links stop being auto-deleted and previews render.',
      '',
      'One hard rule stays: **NSFW links = instant ban.** The content filter never sleeps.',
    ]],
    guide_invites: ['🤝 Invite Rewards', [
      `Every member you bring in: **+${cfg.invites.xpPerInvite} XP**.`,
      '',
      '⟐ **Scout** — 3 invites · +300 XP · image rights in the Lounge',
      '◇ **Ambassador** — 10 invites · +1,000 XP · hoisted badge, embeds + images in the Lounge',
      '',
      'Track with `/invites`. Rejoins never double-count.',
    ]],
    guide_boost: ['💠 Boost Perks', [
      'Boost the server and the studio boosts you back:',
      '',
      `♦ **+${cfg.boost.bonusXp} XP** instantly`,
      `♦ **${cfg.boost.multiplier}× XP multiplier** on everything while boosting`,
      '♦ Embeds + image rights across the Lounge and zones',
      '♦ The pink Booster badge, obviously',
    ]],
  };
  if (GUIDES[i.customId]) {
    const [title, lines] = GUIDES[i.customId];
    return i.reply({ embeds: [new EmbedBuilder().setTitle(title).setColor(0xD4AF37)
      .setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral });
  }

  // ── domain path toggles
  if (PATHS[i.customId]) {
    const roleId = cfg.roles[PATHS[i.customId]];
    const has = i.member.roles.cache.has(roleId);
    if (has) { await i.member.roles.remove(roleId); }
    else { await i.member.roles.add(roleId); }
    return i.reply({ content: `${has ? 'Left' : 'Joined'} <@&${roleId}> ${has ? '' : '— welcome to the guild.'}`, flags: MessageFlags.Ephemeral });
  }

  // ── tickets
  if (i.customId === 'ticket_open') {
    const existing = i.guild.channels.cache.find(
      c => c.parentId === cfg.channels.ticketsCategory && c.topic === `ticket:${i.user.id}`);
    if (existing)
      return i.reply({ content: `You already have a ticket: ${existing}`, flags: MessageFlags.Ephemeral });
    const ch = await i.guild.channels.create({
      name: `ticket-${i.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: cfg.channels.ticketsCategory,
      topic: `ticket:${i.user.id}`,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PF.ViewChannel] },
        { id: i.user.id, allow: [PF.ViewChannel, PF.SendMessages, PF.ReadMessageHistory, PF.AttachFiles] },
        ...[cfg.roles.mod, cfg.roles.core, cfg.roles.founder].map(id =>
          ({ id, allow: [PF.ViewChannel, PF.SendMessages, PF.ReadMessageHistory] })),
      ],
    });
    await ch.send({
      content: `${i.user} <@&${cfg.roles.mod}>`,
      embeds: [new EmbedBuilder().setTitle('✉ Ticket opened').setColor(0x4A78C4)
        .setDescription('Describe your issue — staff will respond shortly.')],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger))],
    });
    return i.reply({ content: `Ticket created: ${ch}`, flags: MessageFlags.Ephemeral });
  }

  if (i.customId === 'ticket_close') {
    if (!i.channel.topic?.startsWith('ticket:')) return;
    const isStaff = [cfg.roles.mod, cfg.roles.core, cfg.roles.founder].some(r => i.member.roles.cache.has(r));
    if (!isStaff && i.channel.topic !== `ticket:${i.user.id}`)
      return i.reply({ content: 'Only staff or the ticket owner can close this.', flags: MessageFlags.Ephemeral });
    await i.reply({ content: '🔒 Closing in 5 seconds…' });
    const logs = await i.guild.channels.fetch(cfg.channels.modLogs).catch(() => null);
    if (logs) await logs.send(`🔒 Ticket **#${i.channel.name}** closed by ${i.user.tag}`);
    setTimeout(() => i.channel.delete().catch(() => {}), 5000);
  }
});

// ── resilience: survive gateway hiccups, never lose XP data, restart cleanly ──
// 1. Gateway/WebSocket errors must be LISTENED to or Node crashes the process
//    (that's exactly the "Opening handshake has timed out" crash).
client.on('error', e => console.error('[gateway] client error:', e.message));
client.on('shardError', (e, id) => console.error(`[gateway] shard ${id} error:`, e.message));
client.on('shardDisconnect', (ev, id) => console.warn(`[gateway] shard ${id} disconnected (code ${ev?.code ?? '?'}) — discord.js will reconnect`));
client.on('shardReconnecting', id => console.warn(`[gateway] shard ${id} reconnecting…`));
client.on('shardResume', (id, replayed) => console.log(`[gateway] shard ${id} resumed (${replayed} events replayed)`));
client.on('invalidated', () => { console.error('[gateway] session invalidated — exiting for supervisor restart'); shutdown(1); });

// 2. Login with exponential backoff — a timeout during startup retries instead of dying.
async function loginWithRetry() {
  for (let attempt = 1, delay = 5_000; ; attempt++, delay = Math.min(delay * 2, 300_000)) {
    try {
      await client.login(process.env.DISCORD_TOKEN);
      return;
    } catch (e) {
      // an invalid token will never succeed — fail fast so the supervisor doesn't loop forever
      if (/token/i.test(e.message ?? '')) { console.error('FATAL: invalid DISCORD_TOKEN —', e.message); process.exit(2); }
      console.error(`[login] attempt ${attempt} failed (${e.message}) — retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// 3. Watchdog: if the gateway stays dead past 5 min despite discord.js retries,
//    exit non-zero and let the supervisor give us a truly fresh process.
setInterval(() => {
  const ready = client.isReady();
  const stale = Date.now() - (client.readyTimestamp ?? 0);
  if (!ready && client.readyTimestamp && stale > 300_000) {
    console.error('[watchdog] gateway down >5 min — exiting for supervisor restart');
    shutdown(1);
  }
}, 60_000);

// 4. Graceful shutdown: ALWAYS flush the XP db before the process dies.
function shutdown(code = 0) {
  try { flushDb(); } catch {}
  try { client.destroy(); } catch {}
  process.exit(code);
}
process.on('SIGINT', () => { console.log('SIGINT — flushing db, shutting down'); shutdown(0); });
process.on('SIGTERM', () => { console.log('SIGTERM — flushing db, shutting down'); shutdown(0); });
process.on('uncaughtException', e => { console.error('uncaught exception:', e); shutdown(1); });

loginWithRetry();
