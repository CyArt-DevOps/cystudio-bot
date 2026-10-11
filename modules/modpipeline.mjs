// Moderator pipeline — observe, don't ask for volunteers.
// Passive telemetry (active days + hour-of-day spread) feeds /mod-candidates scoring;
// promotion runs through a 21-day 🧭 Trial Mod probation with auto-reminder.
// Warnings disqualify candidates and log to mod-logs.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits as PF } from 'discord.js';

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const mdrec = (ctx, id) => {
  const u = ctx.user(id);
  u.md ??= { d: {}, h: {}, warns: [], trial: null };
  return u.md;
};

export function init(ctx) {
  ctx.client.on('messageCreate', m => {
    if (m.author.bot || !m.inGuild() || m.guildId !== ctx.cfg.guildId) return;
    const md = mdrec(ctx, m.author.id);
    md.d[dayKey()] = (md.d[dayKey()] ?? 0) + 1;
    const h = new Date().getHours();
    md.h[h] = (md.h[h] ?? 0) + 1;
    ctx.markDirty();
  });
}

export function commands() {
  const staffPerm = String(PF.ModerateMembers);
  return [
    new SlashCommandBuilder().setName('warn').setDescription('Staff: formal warning (logged, disqualifies from mod pipeline)')
      .setDefaultMemberPermissions(staffPerm)
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName('warns').setDescription('Staff: view a member\'s warnings')
      .setDefaultMemberPermissions(staffPerm)
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName('mod-candidates').setDescription('Staff: ranked moderator candidates from activity telemetry')
      .setDefaultMemberPermissions(staffPerm).toJSON(),
    new SlashCommandBuilder().setName('trial-mod').setDescription('Staff: trial moderator probation')
      .setDefaultMemberPermissions(staffPerm)
      .addSubcommand(s => s.setName('start').setDescription('Start 21-day probation')
        .addUserOption(o => o.setName('user').setDescription('Candidate').setRequired(true)))
      .addSubcommand(s => s.setName('end').setDescription('Conclude probation')
        .addUserOption(o => o.setName('user').setDescription('Trial mod').setRequired(true))
        .addStringOption(o => o.setName('verdict').setDescription('Outcome').setRequired(true)
          .addChoices({ name: 'promote → full Mod', value: 'promote' }, { name: 'revoke', value: 'revoke' })))
      .toJSON(),
  ];
}

// prune telemetry >45 days; remind staff when a probation matures
export async function tick(ctx) {
  const cutoff = dayKey(new Date(Date.now() - 45 * 86_400_000));
  for (const u of Object.values(ctx.db)) {
    if (!u.md) continue;
    for (const k of Object.keys(u.md.d)) if (k < cutoff) { delete u.md.d[k]; ctx.markDirty(); }
    if (u.md.trial && !u.md.trial.notified &&
        Date.now() - u.md.trial.start >= ctx.cfg.modpipe.probationDays * 86_400_000) {
      u.md.trial.notified = true; ctx.markDirty();
      const logs = await ctx.client.channels.fetch(ctx.cfg.channels.modLogs).catch(() => null);
      if (logs) logs.send(`🧭 **Probation complete** for <@${u.md.trial.uid}> (${ctx.cfg.modpipe.probationDays} days). Decide: \`/trial-mod end verdict:promote\` or \`revoke\`.`).catch(() => {});
    }
  }
}

function score(ctx, id, member) {
  const md = ctx.user(id).md;
  if (!md) return null;
  const windowStart = dayKey(new Date(Date.now() - ctx.cfg.modpipe.windowDays * 86_400_000));
  const activeDays = Object.keys(md.d).filter(k => k >= windowStart).length;
  const hourSpread = Object.values(md.h).filter(n => n >= 5).length;
  const recentWarn = md.warns.some(w => Date.now() - w.ts < 90 * 86_400_000);
  const tenureDays = (Date.now() - member.joinedTimestamp) / 86_400_000;
  if (recentWarn || tenureDays < 30 || activeDays < ctx.cfg.modpipe.minActiveDays) return null;
  return {
    activeDays, hourSpread,
    total: activeDays * 3 + hourSpread * 2 + Math.min(Math.floor(ctx.user(id).xp / 500), 20),
  };
}

export async function onInteraction(i, ctx) {
  if (!i.isChatInputCommand()) return false;
  const { cfg } = ctx;

  if (i.commandName === 'warn') {
    const target = i.options.getUser('user', true);
    const reason = i.options.getString('reason', true);
    const md = mdrec(ctx, target.id);
    md.warns.push({ ts: Date.now(), by: i.user.id, reason });
    md.trial = null; // a warning ends any active probation
    ctx.markDirty();
    const logs = await ctx.client.channels.fetch(cfg.channels.modLogs).catch(() => null);
    if (logs) logs.send(`⚠ **Warn #${md.warns.length}** · ${target.tag} · by ${i.user.tag} · ${reason}`).catch(() => {});
    const member = await i.guild.members.fetch(target.id).catch(() => null);
    if (member) member.send(`⚠ You received a formal warning in CyArt Studio: **${reason}**\nPath: warn → timeout → ban. Three warnings = timeout review.`).catch(() => {});
    return i.reply({ content: `⚠ Warned ${target} (total: ${md.warns.length}).`, flags: MessageFlags.Ephemeral }), true;
  }

  if (i.commandName === 'warns') {
    const target = i.options.getUser('user', true);
    const md = ctx.user(target.id).md;
    const lines = (md?.warns ?? []).map((w, n) =>
      `\`${n + 1}\` <t:${Math.floor(w.ts / 1000)}:d> by <@${w.by}> — ${w.reason}`);
    return i.reply({ embeds: [new EmbedBuilder().setTitle(`⚠ Warnings · ${target.tag}`).setColor(0xE74C3C)
      .setDescription(lines.join('\n') || 'Clean record.')], flags: MessageFlags.Ephemeral }), true;
  }

  if (i.commandName === 'mod-candidates') {
    if (!ctx.phase('modpipeline'))
      return i.reply({ content: 'Mod pipeline phase is off — telemetry needs a few weeks of data anyway. Enable with `/phase set name:modpipeline state:on`.', flags: MessageFlags.Ephemeral }), true;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const staffRoles = [cfg.roles.founder, cfg.roles.core, cfg.roles.mod, cfg.modpipe.trialRole];
    await i.guild.members.fetch().catch(() => {}); // one bulk fetch, then cache reads
    const rows = [];
    for (const id of Object.keys(ctx.db)) {
      const member = i.guild.members.cache.get(id);
      if (!member || member.user.bot || staffRoles.some(r => member.roles.cache.has(r))) continue;
      const s = score(ctx, id, member);
      if (s) rows.push({ member, ...s });
    }
    rows.sort((a, b) => b.total - a.total);
    const lines = rows.slice(0, 10).map((r, n) =>
      `\`${String(n + 1).padStart(2)}\` **${r.member.displayName}** · score ${r.total} · ${r.activeDays}/${cfg.modpipe.windowDays}d active · ${r.hourSpread} hour-buckets`);
    return i.editReply({ embeds: [new EmbedBuilder().setTitle('🧭 Mod Candidates').setColor(0x4A78C4)
      .setDescription(lines.join('\n') || `Nobody clears the bar yet (${cfg.modpipe.minActiveDays}+ active days in ${cfg.modpipe.windowDays}, 30d tenure, no recent warns).`)
      .setFooter({ text: 'Score = consistency×3 + timezone-coverage×2 + capped XP. DM top picks 3 scenario questions before /trial-mod start — judgment > knowledge.' })] }), true;
  }

  if (i.commandName === 'trial-mod') {
    const sub = i.options.getSubcommand();
    const target = i.options.getUser('user', true);
    const member = await i.guild.members.fetch(target.id).catch(() => null);
    if (!member) return i.reply({ content: 'Member not found.', flags: MessageFlags.Ephemeral }), true;
    const md = mdrec(ctx, target.id);

    if (sub === 'start') {
      if (md.trial) return i.reply({ content: 'Already on probation.', flags: MessageFlags.Ephemeral }), true;
      md.trial = { uid: target.id, start: Date.now(), by: i.user.id, notified: false };
      ctx.markDirty();
      await member.roles.add(cfg.modpipe.trialRole).catch(() => {});
      await member.send({ embeds: [new EmbedBuilder().setTitle('🧭 Trial Moderator').setColor(0x4A78C4)
        .setDescription([
          `You've been selected for a **${cfg.modpipe.probationDays}-day trial mod probation** in CyArt Studio.`,
          '',
          '**You can:** timeout members, delete messages. **You can\'t yet:** ban (bans need two staff).',
          '**Expected:** de-escalate first, act second · log every action in mod-logs with one-line reason · when unsure, ask in staff chat.',
          '',
          'Full Mod decision comes at day 21. No pressure to be everywhere — consistency beats volume.',
        ].join('\n'))] }).catch(() => {});
      const logs = await ctx.client.channels.fetch(cfg.channels.modLogs).catch(() => null);
      if (logs) logs.send(`🧭 Trial probation started: ${target.tag} · by ${i.user.tag} · decision due <t:${Math.floor((Date.now() + cfg.modpipe.probationDays * 86_400_000) / 1000)}:d>`).catch(() => {});
      return i.reply({ content: `🧭 ${target} on probation for ${cfg.modpipe.probationDays} days.`, flags: MessageFlags.Ephemeral }), true;
    }

    // end
    if (!md.trial) return i.reply({ content: 'Not on probation.', flags: MessageFlags.Ephemeral }), true;
    const verdict = i.options.getString('verdict', true);
    md.trial = null; ctx.markDirty();
    await member.roles.remove(cfg.modpipe.trialRole).catch(() => {});
    if (verdict === 'promote') {
      await member.roles.add(cfg.roles.mod).catch(() => {});
      await member.send('🧭 → 🛡 Probation passed. You are now a full **Mod** of CyArt Studio. Guidelines doc is pinned in staff chat — bans still need a second staff sign-off.').catch(() => {});
    } else {
      await member.send('Your trial mod period ended without promotion this time. This isn\'t a strike — stay active, the pipeline reruns monthly.').catch(() => {});
    }
    const logs = await ctx.client.channels.fetch(cfg.channels.modLogs).catch(() => null);
    if (logs) logs.send(`🧭 Probation ${verdict === 'promote' ? '**passed** → full Mod' : 'ended, revoked'}: ${target.tag} · by ${i.user.tag}`).catch(() => {});
    return i.reply({ content: `Done: ${verdict} for ${target}.`, flags: MessageFlags.Ephemeral }), true;
  }
  return false;
}
