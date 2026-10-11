// Quest engine — alternate-day drops cycling cyber → ai → web3.
// QP (quest points) is a separate monthly-reset economy from XP: XP = tenure, QP = skill.
// Answers stored as sha256 of normalized text so the bank file never leaks solutions.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from 'discord.js';

const QF = 'data/quests.json';
const bank = existsSync(QF)
  ? JSON.parse(readFileSync(QF))
  : { seq: 1, cycle: 0, lastPostDay: null, lastMonth: null, quests: [] };
const save = () => writeFileSync(QF, JSON.stringify(bank, null, 2));

const DOMAINS = ['cyber', 'ai', 'web3'];
const DOMAIN_META = {
  cyber: { label: '⌖ Cybersecurity', color: 0xE74C3C },
  ai:    { label: '◎ AI',            color: 0x9B59B6 },
  web3:  { label: '⬡ Web3',          color: 0x38B6FF },
};
const norm = s => s.trim().toLowerCase().replace(/,/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' '); // "zero-day" == "zero day", "1,000" == "1000"
const hash = s => createHash('sha256').update(norm(s)).digest('hex');
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const dayNum = k => Math.round(Date.parse(k) / 86_400_000);

// per-user quest record inside the shared xp db
const qrec = (ctx, id) => {
  const u = ctx.user(id);
  u.q ??= { qp: 0, streak: 0, lastDay: null, solved: [], att: {} };
  return u.q;
};

let CTX;
export function init(ctx) { CTX = ctx; }

// domains with a currently-live quest — consumed by the engagement module's reminders
export function liveDomains() {
  return [...new Set(bank.quests.filter(q => q.status === 'live').map(q => q.domain))];
}

export function commands(cfg) {
  return [
    new SlashCommandBuilder().setName('quest').setDescription('Quest system')
      .addSubcommand(s => s.setName('me').setDescription('Your QP, streak, and solve history'))
      .addSubcommand(s => s.setName('lb').setDescription('Monthly quest-points leaderboard'))
      .addSubcommand(s => s.setName('add').setDescription('Staff: add a quest to the bank')
        .addStringOption(o => o.setName('domain').setDescription('Domain').setRequired(true)
          .addChoices(...DOMAINS.map(d => ({ name: d, value: d }))))
        .addStringOption(o => o.setName('tier').setDescription('Difficulty').setRequired(true)
          .addChoices({ name: 'easy', value: 'easy' }, { name: 'hard', value: 'hard' }))
        .addStringOption(o => o.setName('question').setDescription('The challenge text').setRequired(true))
        .addStringOption(o => o.setName('answer').setDescription('Exact answer (case/spacing ignored)').setRequired(true))
        .addStringOption(o => o.setName('hint').setDescription('Shown after 2 failed attempts — make it teach, not spoil'))
        .addStringOption(o => o.setName('explain').setDescription('Posted with the answer when the quest closes — the lesson'))
        .addStringOption(o => o.setName('ref').setDescription('Reference link posted with the solution'))
        .addIntegerOption(o => o.setName('qp').setDescription('QP override (default easy 10 / hard 25)')))
      .addSubcommand(s => s.setName('post').setDescription('Staff: post a queued quest now')
        .addIntegerOption(o => o.setName('id').setDescription('Quest id').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('Staff: quest bank status'))
      .toJSON(),
  ];
}

const isStaff = (cfg, member) =>
  [cfg.roles.founder, cfg.roles.core, cfg.roles.mod].some(r => member.roles.cache.has(r));

async function postQuest(ctx, quest) {
  const { cfg, client } = ctx;
  const ch = await client.channels.fetch(cfg.channels.quests).catch(() => null);
  if (!ch) return false;
  const meta = DOMAIN_META[quest.domain];
  const msg = await ch.send({
    content: `<@&${cfg.roles[quest.domain]}>`,
    embeds: [new EmbedBuilder()
      .setTitle(`⚔ Quest #${quest.id} · ${meta.label} · ${quest.tier === 'hard' ? '★ Hard' : '✧ Easy'}`)
      .setColor(meta.color)
      .setDescription(quest.q)
      .addFields({
        name: 'Bounty',
        value: `**${quest.qp} QP** + ${cfg.quests.solveXp[quest.tier]} XP · first 3 solvers get +${cfg.quests.firstSolverQp.join('/+')} bonus QP`,
      })
      .setFooter({ text: 'Solvers: 0 · closes in 48h · answers are private — nobody sees your attempts' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`q_open_${quest.id}`).setLabel('Submit Answer').setEmoji('🗝️').setStyle(ButtonStyle.Primary))],
  }).catch(() => null);
  if (!msg) return false;
  quest.status = 'live'; quest.msgId = msg.id; quest.postedAt = Date.now();
  save();
  return true;
}

async function closeQuest(ctx, quest) {
  quest.status = 'closed'; save();
  const ch = await ctx.client.channels.fetch(ctx.cfg.channels.quests).catch(() => null);
  const msg = ch && await ch.messages.fetch(quest.msgId).catch(() => null);
  if (msg) {
    const e = EmbedBuilder.from(msg.embeds[0])
      .setFooter({ text: `Closed · ${quest.solvers.length} solver${quest.solvers.length === 1 ? '' : 's'}` });
    await msg.edit({ embeds: [e], components: [] }).catch(() => {});
  }
  // learning loop closes here: everyone who missed it still walks away knowing why
  if (ch && quest.reveal) {
    await ch.send({ embeds: [new EmbedBuilder()
      .setTitle(`📖 Quest #${quest.id} — solution`)
      .setColor(DOMAIN_META[quest.domain].color)
      .setDescription([
        `**Answer:** \`${quest.reveal}\``,
        quest.explain ? `**Why:** ${quest.explain}` : '',
        quest.ref ? `📚 **Go deeper:** ${quest.ref}` : '',
        '',
        `${quest.solvers.length} solver${quest.solvers.length === 1 ? '' : 's'} cracked it. Didn't get it? That's the point — now you know it forever. Next drop in 2 days.`,
      ].filter(Boolean).join('\n'))] }).catch(() => {});
  }
}

async function monthlyReset(ctx) {
  const { cfg, client, db } = ctx;
  const top = Object.entries(db)
    .filter(([, u]) => u.q?.qp > 0)
    .sort((a, b) => b[1].q.qp - a[1].q.qp).slice(0, 3);
  const guild = client.guilds.cache.get(cfg.guildId);
  if (guild && top.length) {
    // rotate ⚔ Quest Champion to this month's #1
    const prev = guild.roles.cache.get(cfg.roles.questChampion)?.members ?? new Map();
    for (const [, m] of prev) await m.roles.remove(cfg.roles.questChampion).catch(() => {});
    const champ = await guild.members.fetch(top[0][0]).catch(() => null);
    if (champ) await champ.roles.add(cfg.roles.questChampion).catch(() => {});
    const fame = await client.channels.fetch(cfg.channels.fame).catch(() => null);
    if (fame) {
      const medals = ['♕', '♖', '♗'];
      const lines = await Promise.all(top.map(async ([id, u], i) => {
        const m = await guild.members.fetch(id).catch(() => null);
        return `${medals[i]} **${m ? m.displayName : 'departed member'}** · ${u.q.qp} QP`;
      }));
      await fame.send({ embeds: [new EmbedBuilder().setTitle(`⚔ Quest Champions · ${bank.lastMonth}`)
        .setColor(0xE8C547)
        .setDescription(lines.join('\n') + '\n\nBoard is reset — everyone starts the new month at 0. Fresh race.')] }).catch(() => {});
    }
  }
  for (const u of Object.values(db)) if (u.q) u.q.qp = 0;
  ctx.markDirty();
}

// tick: called by index every 10 min. Idempotent via lastPostDay / lastMonth markers.
export async function tick(ctx) {
  const now = new Date();

  // month rollover runs even when phase is off (champion of a finished month must still be crowned)
  if (bank.lastMonth && bank.lastMonth !== monthKey(now)) {
    await monthlyReset(ctx);
    bank.lastMonth = monthKey(now); save();
  }
  bank.lastMonth ??= monthKey(now);

  // close live quests past 48h
  for (const q of bank.quests.filter(q => q.status === 'live' && now - q.postedAt > 48 * 3_600_000))
    await closeQuest(ctx, q);

  if (!ctx.phase('quests')) return;

  // alternate-day drop: even day numbers only, once per day, at/after postHour
  const today = dayKey(now);
  if (bank.lastPostDay === today) return;
  if (dayNum(today) % 2 !== 0) return;
  if (now.getHours() < ctx.cfg.quests.postHour) return;

  const domain = DOMAINS[bank.cycle % DOMAINS.length];
  const pick = tier => bank.quests.find(q => q.status === 'queued' && q.domain === domain && q.tier === tier);
  const easy = pick('easy'), hard = pick('hard');
  if (!easy && !hard) {
    const logs = await ctx.client.channels.fetch(ctx.cfg.channels.modLogs).catch(() => null);
    if (logs) logs.send(`⚔ Quest bank empty for **${domain}** — add with \`/quest add\`.`).catch(() => {});
    bank.lastPostDay = today; bank.cycle++; save();
    return;
  }
  if (easy) await postQuest(ctx, easy);
  if (hard) await postQuest(ctx, hard);
  bank.lastPostDay = today; bank.cycle++; save();
}

async function handleSolve(ctx, i, quest) {
  const { cfg } = ctx;
  const rec = qrec(ctx, i.user.id);
  const answer = i.fields.getTextInputValue('q_answer');

  if (hash(answer) !== quest.hash) {
    const att = rec.att[quest.id] ??= { n: 0, day: dayKey() };
    if (att.day !== dayKey()) { att.n = 0; att.day = dayKey(); }
    att.n++; ctx.markDirty();
    // learning loop: after 2 misses the hint unlocks — a nudge, never the answer
    const hint = quest.hint && att.n >= 2 ? `\n💡 **Hint unlocked:** ${quest.hint}` : '';
    if (att.n >= cfg.quests.maxAttemptsPerDay)
      return i.reply({ content: `✗ Not it — attempt ${att.n}/${cfg.quests.maxAttemptsPerDay} today. Sleep on it, retry tomorrow. The answer gets revealed when the quest closes, so you'll learn it either way.${hint}`, flags: MessageFlags.Ephemeral });
    return i.reply({ content: `✗ Not it. Attempt ${att.n}/${cfg.quests.maxAttemptsPerDay} today — think again.${hint}`, flags: MessageFlags.Ephemeral });
  }

  // correct
  const pos = quest.solvers.length;
  const bonus = cfg.quests.firstSolverQp[pos] ?? 0;
  quest.solvers.push({ id: i.user.id, ts: Date.now() });
  save();
  rec.qp += quest.qp + bonus;
  rec.solved.push(quest.id);

  // streak: consecutive drops, with one streak-shield per month (a single missed
  // drop must not vaporize weeks of discipline — that kills the habit loop)
  const today = dayKey();
  let shieldUsed = false;
  if (rec.lastDay !== today) {
    const gap = rec.lastDay ? dayNum(today) - dayNum(rec.lastDay) : null;
    if (gap === null) rec.streak = 1;
    else if (gap <= 2) rec.streak += 1;                                // on schedule
    else if (gap <= 4 && rec.shield !== monthKey()) {                  // missed exactly one drop
      rec.shield = monthKey(); rec.streak += 1; shieldUsed = true;
    }
    else rec.streak = 1;
    rec.lastDay = today;
  }
  ctx.markDirty();
  await ctx.addXp(i.member, cfg.quests.solveXp[quest.tier]);

  // streak certificate — public, screenshot-able (LinkedIn bait by design)
  if (rec.streak === cfg.quests.streakCertSolves && !i.member.roles.cache.has(cfg.roles.streak)) {
    await i.member.roles.add(cfg.roles.streak).catch(() => {});
    const fame = await ctx.client.channels.fetch(cfg.channels.fame).catch(() => null);
    if (fame) fame.send({ embeds: [new EmbedBuilder().setColor(0xE8C547)
      .setTitle('🜂 Streak Certificate')
      .setDescription(`**${i.member.displayName}** solved **${cfg.quests.streakCertSolves} consecutive quest drops** in CyArt Studio.\nDiscipline certified. Screenshot-worthy.`)
      .setTimestamp()] }).catch(() => {});
  }

  // update solver count on the quest message
  const ch = await ctx.client.channels.fetch(cfg.channels.quests).catch(() => null);
  const msg = ch && await ch.messages.fetch(quest.msgId).catch(() => null);
  if (msg) {
    const e = EmbedBuilder.from(msg.embeds[0])
      .setFooter({ text: `Solvers: ${quest.solvers.length} · closes in 48h · answers are private — nobody sees your attempts` });
    msg.edit({ embeds: [e] }).catch(() => {});
  }

  // podium win card → wins channel (shareable artifact)
  if (pos < 3) {
    const wins = await ctx.client.channels.fetch(cfg.channels.wins).catch(() => null);
    const medals = ['♕ FIRST BLOOD', '♖ SECOND', '♗ THIRD'];
    if (wins) wins.send({ embeds: [new EmbedBuilder().setColor(DOMAIN_META[quest.domain].color)
      .setTitle(`${medals[pos]} · Quest #${quest.id}`)
      .setDescription(`**${i.member.displayName}** cracked the ${DOMAIN_META[quest.domain].label} ${quest.tier} quest.\n+${quest.qp + bonus} QP banked.`)
      .setThumbnail(i.user.displayAvatarURL())
      .setTimestamp()] }).catch(() => {});
  }

  return i.reply({
    content: `⚔ **Correct.** +${quest.qp} QP${bonus ? ` +${bonus} first-solver bonus` : ''} +${cfg.quests.solveXp[quest.tier]} XP\nStreak: **${rec.streak}**${shieldUsed ? ' 🛡 *(streak shield used — you missed a drop but the chain lives; one shield per month)*' : ''} · Monthly QP: **${rec.qp}** · \`/quest me\` for full stats`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function onInteraction(i, ctx) {
  const { cfg } = ctx;

  // submit button → modal
  if (i.isButton() && i.customId.startsWith('q_open_')) {
    const id = Number(i.customId.slice(7));
    const quest = bank.quests.find(q => q.id === id);
    if (!quest || quest.status !== 'live')
      return i.reply({ content: 'This quest is closed.', flags: MessageFlags.Ephemeral }), true;
    const rec = qrec(ctx, i.user.id);
    if (rec.solved.includes(id))
      return i.reply({ content: 'Already solved ✓ — wait for the next drop.', flags: MessageFlags.Ephemeral }), true;
    const att = rec.att[id];
    if (att && att.day === dayKey() && att.n >= cfg.quests.maxAttemptsPerDay)
      return i.reply({ content: 'Out of attempts today. Fresh eyes tomorrow.', flags: MessageFlags.Ephemeral }), true;
    await i.showModal(new ModalBuilder().setCustomId(`q_sub_${id}`).setTitle(`Quest #${id}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('q_answer').setLabel('Your answer')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200))));
    return true;
  }

  // modal submit
  if (i.isModalSubmit() && i.customId.startsWith('q_sub_')) {
    const quest = bank.quests.find(q => q.id === Number(i.customId.slice(6)));
    if (!quest || quest.status !== 'live')
      return i.reply({ content: 'Quest closed while you typed. Faster next time.', flags: MessageFlags.Ephemeral }), true;
    await handleSolve(ctx, i, quest);
    return true;
  }

  if (!i.isChatInputCommand() || i.commandName !== 'quest') return false;
  const sub = i.options.getSubcommand();

  if (sub === 'me') {
    const rec = qrec(ctx, i.user.id);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0xE8C547)
      .setAuthor({ name: i.member.displayName, iconURL: i.user.displayAvatarURL() })
      .setDescription([
        `**Monthly QP:** ${rec.qp}`,
        `**Streak:** ${rec.streak} consecutive drops (certificate at ${cfg.quests.streakCertSolves})`,
        `**Total solved:** ${rec.solved.length}`,
      ].join('\n'))], flags: MessageFlags.Ephemeral }), true;
  }

  if (sub === 'lb') {
    const top = Object.entries(ctx.db).filter(([, u]) => u.q?.qp > 0)
      .sort((a, b) => b[1].q.qp - a[1].q.qp).slice(0, 10);
    const lines = await Promise.all(top.map(async ([id, u], n) => {
      const m = await i.guild.members.fetch(id).catch(() => null);
      return `\`${String(n + 1).padStart(2)}\` **${m ? m.displayName : 'departed'}** · ${u.q.qp} QP`;
    }));
    return i.reply({ embeds: [new EmbedBuilder().setTitle(`⚔ Quest Points · ${monthKey()}`)
      .setColor(0xE8C547)
      .setDescription(lines.join('\n') || 'No solves yet this month.')
      .setFooter({ text: 'Resets monthly · #1 takes ⚔ Quest Champion' })], flags: MessageFlags.Ephemeral }), true;
  }

  // staff subcommands below
  if (!isStaff(cfg, i.member))
    return i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral }), true;

  if (sub === 'add') {
    const tier = i.options.getString('tier', true);
    const answer = i.options.getString('answer', true);
    const quest = {
      id: bank.seq++,
      domain: i.options.getString('domain', true),
      tier,
      q: i.options.getString('question', true),
      hash: hash(answer),
      reveal: answer, // posted on close so non-solvers still learn — keep data/ private
      hint: i.options.getString('hint') ?? null,
      explain: i.options.getString('explain') ?? null,
      ref: i.options.getString('ref') ?? null,
      qp: i.options.getInteger('qp') ?? (tier === 'hard' ? 25 : 10),
      status: 'queued', msgId: null, postedAt: null, solvers: [],
    };
    bank.quests.push(quest); save();
    return i.reply({ content: `Queued **Quest #${quest.id}** · ${quest.domain} · ${tier} · ${quest.qp} QP. Auto-posts on its domain's day, or force with \`/quest post id:${quest.id}\`.`, flags: MessageFlags.Ephemeral }), true;
  }

  if (sub === 'post') {
    const quest = bank.quests.find(q => q.id === i.options.getInteger('id', true));
    if (!quest) return i.reply({ content: 'No such quest.', flags: MessageFlags.Ephemeral }), true;
    if (quest.status !== 'queued') return i.reply({ content: `Quest is ${quest.status}, not queued.`, flags: MessageFlags.Ephemeral }), true;
    const ok = await postQuest(ctx, quest);
    return i.reply({ content: ok ? `Posted Quest #${quest.id} → <#${cfg.channels.quests}>` : 'Post failed — check quests channel id.', flags: MessageFlags.Ephemeral }), true;
  }

  if (sub === 'list') {
    const counts = {};
    for (const d of DOMAINS) for (const t of ['easy', 'hard'])
      counts[`${d}/${t}`] = bank.quests.filter(q => q.status === 'queued' && q.domain === d && q.tier === t).length;
    const live = bank.quests.filter(q => q.status === 'live').map(q => `#${q.id} ${q.domain}/${q.tier} · ${q.solvers.length} solvers`);
    return i.reply({ embeds: [new EmbedBuilder().setTitle('⚔ Quest Bank').setColor(0x9B59B6)
      .setDescription([
        `**Next drop domain:** ${DOMAINS[bank.cycle % DOMAINS.length]}`,
        '',
        '**Queued:** ' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · '),
        '',
        '**Live:**', ...(live.length ? live : ['none']),
      ].join('\n'))
      .setFooter({ text: 'Keep ≥2 queued per domain/tier — bank-empty alerts go to mod-logs' })], flags: MessageFlags.Ephemeral }), true;
  }
  return true;
}
