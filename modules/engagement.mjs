// Engagement engine — two dopamine loops that run on top of the quest system.
//
// 1. QUEST RUMBLE: a battle-royale mini-event. Members opt in by clicking a button
//    (opt-in = they WANT their name in the story = zero spam). The bot simulates a
//    themed elimination bracket where every line names a real participant, editing
//    one message round-by-round for suspense. Winner gets QP + a fleeting shout-out.
//    It's a random coin-flip dressed as a saga — people love it because they're IN it.
//
// 2. PERSONALIZED REMINDERS: instead of one nagging "come back" DM, the bot picks the
//    single most-relevant nudge for each member (close to top 10 / streak at risk /
//    rank almost up / drop waiting / genuine comeback) and NEVER sends the same type
//    twice in a row. Respects a cooldown and a one-click opt-out. Variety = it reads
//    as the server noticing you, not a mailing list.
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, PermissionFlagsBits as PF,
} from 'discord.js';

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const dayNum = k => Math.round(Date.parse(k) / 86_400_000);
const isStaff = (cfg, m) => [cfg.roles.founder, cfg.roles.core, cfg.roles.mod].some(r => m.roles.cache.has(r));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const DOMAINS = ['cyber', 'ai', 'web3'];
const DOMAIN_LABEL = { cyber: '⌖ Cybersecurity', ai: '◎ AI', web3: '⬡ Web3', all: '⚔ All domains' };

// active = messaged within `days` (telemetry written by modpipeline's messageCreate hook)
const isActive = (ctx, id, days = 7) => {
  const d = ctx.db[id]?.md?.d;
  if (!d) return false;
  const cutoff = dayNum(dayKey()) - days;
  return Object.keys(d).some(k => dayNum(k) >= cutoff);
};
const inDomain = (cfg, member, domain) => domain === 'all' || member.roles.cache.has(cfg.roles[domain]);

// roster pool: members who are active AND (if a domain is set) hold that domain role
async function activeDomainMembers(ctx, guild, domain) {
  const out = [];
  for (const id of Object.keys(ctx.db)) {
    if (!isActive(ctx, id)) continue;
    const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    if (!member || member.user.bot) continue;
    if (!inDomain(ctx.cfg, member, domain)) continue;
    out.push(member);
  }
  return out;
}

// ────────────────────────────── RUMBLE flavor ──────────────────────────────
// {a} = eliminated player, {b} = the one who knocked them out. Themed to the server.
const ELIMS = [
  '💥 **{a}**’s regex went greedy and matched **{b}**’s whole payload instead. Out.',
  '🗡️ **{b}** slid into **{a}**’s DMs with a malicious PDF. **{a}** clicked. Gone.',
  '🔥 **{a}** ran `rm -rf` in the wrong directory. Nobody could save them.',
  '⛓️ **{a}** got rug-pulled by **{b}** and rage-quit the arena.',
  '🧠 **{b}** prompt-injected **{a}** into eliminating themselves. Poetic.',
  '🪤 **{a}** stepped on **{b}**’s honeypot. Alarms everywhere.',
  '💸 **{a}** aped into a token **{b}** shilled. Down bad, down out.',
  '🐛 **{a}** shipped on a Friday. The bug ate them. **{b}** watched.',
  '🔑 **{b}** phished **{a}**’s seed phrase. Wallet AND dignity drained.',
  '📉 **{a}**’s model overfit to the arena and failed to generalize. Eliminated.',
  '⚡ **{b}** flash-loaned enough hype to knock **{a}** clean off the leaderboard.',
  '🧊 **{a}** left their approvals unrevoked. **{b}** did the rest.',
  '🎭 **{b}** deepfaked the ref and had **{a}** disqualified.',
  '🌀 **{a}** got caught in an infinite loop and never returned.',
  '🛰️ **{a}** rate-limited themselves into oblivion arguing with **{b}**.',
  '🔓 **{b}** found a zero-day in **{a}**’s defense. No patch in time.',
];
const FINAL_TWO = [
  'Down to two. **{a}** and **{b}** stare across the terminal. One keystroke decides it…',
  'Final showdown: **{a}** vs **{b}**. Both hovering the Enter key…',
  '**{a}** and **{b}** are all that’s left. The leaderboard holds its breath…',
];
const WINS = [
  '🏆 **{w}** is the last dev standing. Absolute unit.',
  '👑 **{w}** cracked the final exploit and took the crown.',
  '🥇 **{w}** wins the Rumble. The arena chants their name.',
];
const fmt = (t, a, b, w) => t.replaceAll('{a}', a ?? '').replaceAll('{b}', b ?? '').replaceAll('{w}', w ?? '');

export function commands() {
  return [
    new SlashCommandBuilder().setName('rumble').setDescription('Staff: start a Quest Rumble battle-royale')
      .setDefaultMemberPermissions(String(PF.ManageMessages))
      .addSubcommand(s => s.setName('start').setDescription('Open a Rumble (60s join window)')
        .addStringOption(o => o.setName('domain').setDescription('Restrict roster to one domain (default all)')
          .addChoices(...DOMAINS.map(d => ({ name: d, value: d })), { name: 'all', value: 'all' }))
        .addIntegerOption(o => o.setName('qp').setDescription('QP for the winner (default 20)')))
      .toJSON(),
    new SlashCommandBuilder().setName('reminders').setDescription('Turn your personal nudge DMs on or off')
      .addStringOption(o => o.setName('state').setDescription('on/off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })).toJSON(),
  ];
}

// ────────────────────────────── RUMBLE runner ──────────────────────────────
async function runRumble(ctx, channel, players, winnerQp, optedIn = new Set()) {
  const names = players.map(p => p.displayName);
  let alive = shuffle([...names]);
  const log = [`⚔️ **QUEST RUMBLE** — ${alive.length} builders enter the arena.\n`];
  const embed = () => new EmbedBuilder().setTitle('⚔️ Quest Rumble').setColor(0xE8C547)
    .setDescription(log.slice(-14).join('\n'))
    .setFooter({ text: `${alive.length} still standing` });
  const msg = await channel.send({ embeds: [embed()] });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  while (alive.length > 2) {
    // eliminate ~a third each round so big lobbies don't drag
    const toKill = Math.max(1, Math.floor(alive.length / 3));
    for (let k = 0; k < toKill && alive.length > 2; k++) {
      const victimIdx = Math.floor(Math.random() * alive.length);
      const victim = alive.splice(victimIdx, 1)[0];
      const killer = alive.length ? pick(alive) : null;
      log.push(fmt(pick(ELIMS), victim, killer));
    }
    await wait(4000);
    await msg.edit({ embeds: [embed()] }).catch(() => {});
  }

  if (alive.length === 2) {
    log.push('\n' + fmt(pick(FINAL_TWO), alive[0], alive[1]));
    await msg.edit({ embeds: [embed()] }).catch(() => {});
    await wait(4500);
  }
  const winnerName = alive[Math.floor(Math.random() * alive.length)];
  const winner = players.find(p => p.displayName === winnerName);
  log.push('\n' + fmt(pick(WINS), null, null, winnerName));
  await msg.edit({ embeds: [embed().setColor(0xF1C40F)] }).catch(() => {});

  // reward + shout-out (mention only the winner, so it's a treat not noise)
  if (winner) {
    const rec = ctx.user(winner.id); rec.q ??= { qp: 0, streak: 0, lastDay: null, solved: [], att: {} };
    rec.q.qp += winnerQp; ctx.markDirty();
    // ping only if they opted in; auto-drafted winners get a name shout-out, no surprise ping
    const who = optedIn.has(winner.id) ? `${winner}` : `**${winner.displayName}**`;
    await channel.send({ content: `${who} just won the **Quest Rumble** — +${winnerQp} QP. 🎉` }).catch(() => {});
  }
}

// ─────────────────────────── PERSONALIZED reminders ───────────────────────────
// Priority-ordered generators. Each returns a message string or null. The engine
// sends the FIRST applicable type whose key != the user's last-sent key.
function buildReminders(ctx, id, member) {
  const { cfg, db } = ctx;
  const u = db[id];
  if (!u) return [];
  const q = u.q ?? { qp: 0, streak: 0, lastDay: null };
  const out = [];

  // rank almost up
  const RANKS = cfg.ranks;
  const cur = [...RANKS].reverse().find(r => u.xp >= r.xp);
  const nxt = RANKS.find(r => r.xp > u.xp);
  if (nxt && nxt.xp - u.xp <= 120) out.push(['rank',
    `You’re **${nxt.xp - u.xp} XP** from **${nxt.name}**. That’s one quest solve or a good chat session. Go claim it.`]);

  // close to the monthly QP top 10
  const qp = Object.values(db).map(x => x.q?.qp ?? 0).filter(v => v > 0).sort((a, b) => b - a);
  const tenth = qp[9] ?? 0;
  if (q.qp > 0 && tenth > q.qp && tenth - q.qp <= 30) out.push(['top10',
    `You’re only **${tenth - q.qp} QP** off the **monthly top 10**. One hard quest (25 QP) and you’re on the board.`]);

  // streak at risk: has a streak, hasn't solved today, a quest is live
  const liveExists = ctx.liveQuestDomains?.().length > 0;
  if (q.streak >= 3 && q.lastDay && dayNum(dayKey()) - dayNum(q.lastDay) >= 2 && liveExists)
    out.push(['streak',
      `🔥 Your **${q.streak}-drop streak** is about to break. A quest is live right now — solve it to keep the chain alive. (You have one 🛡 shield, don’t waste it.)`]);

  // a live quest in a domain they follow, unattempted
  const myDomains = ['cyber', 'ai', 'web3'].filter(d => member.roles.cache.has(cfg.roles[d]));
  const liveMine = (ctx.liveQuestDomains?.() ?? []).filter(d => myDomains.includes(d));
  if (liveMine.length) out.push(['drop',
    `A fresh **${liveMine[0]}** quest just dropped in <#${cfg.channels.quests}> and you haven’t taken a shot yet. First solvers get bonus QP.`]);

  // genuine comeback: quiet 5–12 days
  const lastActive = u.md?.d ? Object.keys(u.md.d).sort().at(-1) : null;
  if (lastActive) {
    const gap = dayNum(dayKey()) - dayNum(lastActive);
    if (gap >= 5 && gap <= 12) out.push(['comeback',
      `The arena’s been quieter without you. **${gap} days**, a few quests you’ve missed, and the leaderboard’s shifting. Drop back in — <#${cfg.channels.quests}>.`]);
  }
  return out;
}

// tick: once/day (guarded by lastReminderDay), DM eligible users their best nudge
let lastReminderDay = null;
export async function tick(ctx) {
  if (!ctx.phase('engage')) return;
  const today = dayKey();
  if (lastReminderDay === today) return;
  // only run in the evening so it lands when students are online
  if (new Date().getHours() < (ctx.cfg.engage?.reminderHour ?? 18)) return;
  lastReminderDay = today;

  const guild = ctx.client.guilds.cache.get(ctx.cfg.guildId);
  if (!guild) return;
  const cooldownMs = (ctx.cfg.engage?.cooldownDays ?? 3) * 86_400_000;
  let sent = 0;
  const cap = ctx.cfg.engage?.dailyCap ?? 40; // protect against rate limits / spam feel

  for (const [id, u] of Object.entries(ctx.db)) {
    if (sent >= cap) break;
    if (u.remOff) continue;                                   // opted out
    if (u.lastRem && Date.now() - u.lastRem < cooldownMs) continue;
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member || member.user.bot) continue;

    const options = buildReminders(ctx, id, member);
    // never repeat the last kind — rotate the flavor
    const choice = options.find(([k]) => k !== u.lastRemKind) ?? options[0];
    if (!choice) continue;
    const [kind, text] = choice;

    const ok = await member.send({ embeds: [new EmbedBuilder().setColor(0x6FCF97)
      .setAuthor({ name: 'CyArt Studio' })
      .setDescription(text)
      .setFooter({ text: 'Personalized nudge · /reminders off to stop these' })] }).catch(() => null);
    if (ok) { u.lastRem = Date.now(); u.lastRemKind = kind; ctx.markDirty(); sent++; }
  }
  if (sent) console.log(`engagement: sent ${sent} personalized reminders`);
}

export async function onInteraction(i, ctx) {
  const { cfg } = ctx;

  if (i.isChatInputCommand() && i.commandName === 'reminders') {
    const on = i.options.getString('state', true) === 'on';
    ctx.user(i.user.id).remOff = !on; ctx.markDirty();
    return i.reply({ content: on ? '🔔 Personal nudges on — I’ll ping you when you’re close to something good.' : '🔕 Nudges off. Turn them back on anytime with `/reminders on`.', flags: MessageFlags.Ephemeral }), true;
  }

  if (i.isChatInputCommand() && i.commandName === 'rumble') {
    if (!ctx.phase('engage'))
      return i.reply({ content: 'Engagement phase is off — enable with `/phase set name:engage state:on`.', flags: MessageFlags.Ephemeral }), true;
    if (!isStaff(cfg, i.member))
      return i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral }), true;
    const winnerQp = i.options.getInteger('qp') ?? 20;
    const domain = i.options.getString('domain') ?? 'all';

    const joiners = new Map();
    const gate = domain === 'all'
      ? 'Only **active members** (posted in the last 7 days) can enter.'
      : `Only **active ${DOMAIN_LABEL[domain]} members** can enter — you need the domain role and a message in the last 7 days.`;
    const row = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rumble_join').setLabel(`Enter the Arena (${joiners.size})`).setEmoji('⚔️').setStyle(ButtonStyle.Success));
    await i.reply({ embeds: [new EmbedBuilder().setTitle(`⚔️ Quest Rumble — ${DOMAIN_LABEL[domain]}`).setColor(0xE8C547)
      .setDescription(`A battle-royale of builders. Click to enter — your name goes into the saga.\n\n${gate}\n**60 seconds** to join. Active ${domain === 'all' ? '' : DOMAIN_LABEL[domain] + ' '}members may be auto-drafted to fill the arena.`)
      .setFooter({ text: 'Pure fun · winner takes bonus QP' })], components: [row()] });
    const panel = await i.fetchReply();

    const collector = panel.createMessageComponentCollector({ time: 60_000 });
    collector.on('collect', async (b) => {
      if (b.customId !== 'rumble_join') return;
      if (joiners.has(b.user.id)) return b.reply({ content: 'You’re already in. ⚔️', flags: MessageFlags.Ephemeral });
      // gate: must be active + (if domain-specific) hold the domain role
      if (!inDomain(cfg, b.member, domain))
        return b.reply({ content: `This Rumble is **${DOMAIN_LABEL[domain]}** only — grab the domain role in <#${cfg.channels.path}> to qualify.`, flags: MessageFlags.Ephemeral });
      if (!isActive(ctx, b.user.id))
        return b.reply({ content: 'The arena is for **active** builders — chat, solve a quest, then jump in next round. 🙂', flags: MessageFlags.Ephemeral });
      joiners.set(b.user.id, b.member);
      await b.reply({ content: 'You’re in the arena. Good luck. ⚔️', flags: MessageFlags.Ephemeral });
      await panel.edit({ components: [row()] }).catch(() => {});
    });
    collector.on('end', async () => {
      await panel.edit({ components: [] }).catch(() => {});
      const roster = new Map(joiners);
      // auto-draft active domain-specific members to reach a lively arena (up to 16)
      if (roster.size < 12) {
        const guild = i.guild;
        const pool = shuffle(await activeDomainMembers(ctx, guild, domain));
        for (const m of pool) { if (roster.size >= 16) break; if (!roster.has(m.id)) roster.set(m.id, m); }
      }
      if (roster.size < 3) {
        await i.channel.send(`⚔️ Not enough active ${domain === 'all' ? '' : DOMAIN_LABEL[domain] + ' '}builders for a Rumble right now. Get the arena buzzing and try again!`).catch(() => {});
        return;
      }
      await runRumble(ctx, i.channel, [...roster.values()], winnerQp, new Set(joiners.keys())).catch(e => console.error('rumble error', e));
    });
    return true;
  }
  return false;
}
