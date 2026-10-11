// Campus Ambassador program — apply → staff approve → personal tracked invite →
// event reports with verification → auto tier ladder (T1 Ambassador / T2 Lead).
// Recruits counted via the ambassador's dedicated invite code (inviteUsed hook),
// separate from the general invite-XP engine.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from 'discord.js';

const CF = 'data/campus.json';
const data = existsSync(CF) ? JSON.parse(readFileSync(CF)) : { amb: {}, lastReminderMonth: null };
const save = () => writeFileSync(CF, JSON.stringify(data, null, 2));

const isStaff = (cfg, member) =>
  [cfg.roles.founder, cfg.roles.core, cfg.roles.mod].some(r => member.roles.cache.has(r));

export function init(ctx) {
  // count joins through an ambassador's personal code toward their recruit total
  ctx.hooks.inviteUsed.push(async (member, code) => {
    if (!code) return;
    const entry = Object.entries(data.amb).find(([, a]) => a.code === code && a.approved);
    if (!entry) return;
    const [uid, a] = entry;
    a.recruits ??= [];
    if (a.recruits.includes(member.id)) return;
    a.recruits.push(member.id); save();
    await evalTier(ctx, uid);
  });
}

export function commands() {
  return [
    new SlashCommandBuilder().setName('ambassador').setDescription('Campus Ambassador program')
      .addSubcommand(s => s.setName('apply').setDescription('Apply to represent CyArt Studio at your college'))
      .addSubcommand(s => s.setName('stats').setDescription('Your ambassador dashboard'))
      .addSubcommand(s => s.setName('report-event').setDescription('Ambassadors: log a campus event you hosted'))
      .addSubcommand(s => s.setName('roster').setDescription('Staff: all ambassadors ranked by output'))
      .toJSON(),
  ];
}

function tierOf(cfg, a) {
  const events = (a.events ?? []).filter(e => e.ok).length;
  const recruits = (a.recruits ?? []).length;
  const [t1, t2] = cfg.campus.tiers;
  if (recruits >= t2.invites && events >= t2.events) return 2;
  if (recruits >= t1.invites && events >= t1.events) return 1;
  return 0;
}

async function evalTier(ctx, uid) {
  const { cfg, client } = ctx;
  const a = data.amb[uid];
  const t = tierOf(cfg, a);
  if (t <= (a.tier ?? 0)) return;
  a.tier = t; save();
  const guild = client.guilds.cache.get(cfg.guildId);
  const member = await guild?.members.fetch(uid).catch(() => null);
  if (!member) return;
  const tierCfg = cfg.campus.tiers[t - 1];
  await member.roles.add(tierCfg.role).catch(() => {});
  const fame = await client.channels.fetch(cfg.channels.fame).catch(() => null);
  if (fame) fame.send({ embeds: [new EmbedBuilder().setColor(0xD4AF37)
    .setTitle(`🏛 ${tierCfg.name} · ${a.college}`)
    .setDescription(`**${member.displayName}** hit Tier ${t}: ${a.recruits.length} recruits · ${(a.events ?? []).filter(e => e.ok).length} verified events.\n${t === 2 ? 'Lead perks unlocked: LoR + internship interview fast-track.' : 'Next: Tier 2 Lead Ambassador.'}`)] }).catch(() => {});
}

// monthly report-cycle reminder in ambassador HQ, 1st of each month
export async function tick(ctx) {
  if (!ctx.phase('campus')) return;
  const mo = new Date().toISOString().slice(0, 7);
  if (data.lastReminderMonth === mo || new Date().getDate() !== 1) return;
  data.lastReminderMonth = mo; save();
  const hq = await ctx.client.channels.fetch(ctx.cfg.channels.ambassadorHq).catch(() => null);
  if (hq) hq.send({ content: `📋 **Monthly check-in.** Post your campus update this week: events run, plans, blockers. Log events with \`/ambassador report-event\`. Two silent months = tier review.` }).catch(() => {});
}

export async function onInteraction(i, ctx) {
  const { cfg, client } = ctx;

  // ── application modal submit
  if (i.isModalSubmit() && i.customId === 'camb_app') {
    const [college, city, why, event] = ['college', 'city', 'why', 'event'].map(k => i.fields.getTextInputValue(k));
    data.amb[i.user.id] = {
      college, city, why, event, approved: false, tier: 0,
      code: null, recruits: [], events: [], appliedAt: Date.now(),
    };
    save();
    const hq = await client.channels.fetch(cfg.channels.ambassadorHq).catch(() => null);
    if (hq) await hq.send({
      embeds: [new EmbedBuilder().setTitle('🏛 Ambassador Application').setColor(0xD4AF37)
        .setAuthor({ name: i.user.tag, iconURL: i.user.displayAvatarURL() })
        .addFields(
          { name: 'College', value: college, inline: true },
          { name: 'City', value: city, inline: true },
          { name: 'Why them', value: why },
          { name: 'First event idea', value: event },
          { name: 'Server standing', value: `${ctx.user(i.user.id).xp.toLocaleString()} XP` },
        )],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`camb_ok_${i.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`camb_no_${i.user.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger))],
    }).catch(() => {});
    return i.reply({ content: '🏛 Application in. Staff reviews within a few days — you\'ll get a DM either way.', flags: MessageFlags.Ephemeral }), true;
  }

  // ── event report modal submit
  if (i.isModalSubmit() && i.customId === 'camb_evm') {
    const a = data.amb[i.user.id];
    if (!a?.approved) return i.reply({ content: 'Ambassadors only.', flags: MessageFlags.Ephemeral }), true;
    const ev = {
      title: i.fields.getTextInputValue('title'),
      date: i.fields.getTextInputValue('date'),
      attendees: i.fields.getTextInputValue('attendees'),
      proof: i.fields.getTextInputValue('proof'),
      ok: false,
    };
    a.events.push(ev); save();
    const idx = a.events.length - 1;
    const hq = await client.channels.fetch(cfg.channels.ambassadorHq).catch(() => null);
    if (hq) await hq.send({
      embeds: [new EmbedBuilder().setTitle(`📋 Event report · ${a.college}`).setColor(0x38B6FF)
        .setAuthor({ name: i.user.tag, iconURL: i.user.displayAvatarURL() })
        .addFields(
          { name: 'Event', value: ev.title, inline: true },
          { name: 'Date', value: ev.date, inline: true },
          { name: 'Attendees', value: ev.attendees, inline: true },
          { name: 'Proof', value: ev.proof })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`camb_ev_${i.user.id}_${idx}`).setLabel('Verify Event').setStyle(ButtonStyle.Success))],
    }).catch(() => {});
    return i.reply({ content: '📋 Logged. Staff verifies the proof, then it counts toward your tier.', flags: MessageFlags.Ephemeral }), true;
  }

  // ── staff buttons
  if (i.isButton() && /^camb_(ok|no|ev)_/.test(i.customId)) {
    if (!isStaff(cfg, i.member))
      return i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral }), true;
    const [, kind, uid, idx] = i.customId.match(/^camb_(ok|no|ev)_(\d+)(?:_(\d+))?$/) ?? [];
    const a = data.amb[uid];
    if (!a) return i.reply({ content: 'Record missing.', flags: MessageFlags.Ephemeral }), true;
    const member = await i.guild.members.fetch(uid).catch(() => null);

    if (kind === 'ev') {
      const ev = a.events[Number(idx)];
      if (!ev) return i.reply({ content: 'Event missing.', flags: MessageFlags.Ephemeral }), true;
      if (ev.ok) return i.reply({ content: 'Already verified.', flags: MessageFlags.Ephemeral }), true;
      ev.ok = true; save();
      await evalTier(ctx, uid);
      await i.update({ components: [] }).catch(() => {});
      return i.followUp({ content: `✓ Verified **${ev.title}** for <@${uid}>.`, flags: MessageFlags.Ephemeral }), true;
    }

    if (kind === 'no') {
      delete data.amb[uid]; save();
      await i.update({ components: [] }).catch(() => {});
      if (member) member.send('Your CyArt Studio ambassador application wasn\'t accepted this round. Stay active — reapply next cycle.').catch(() => {});
      return i.followUp({ content: `Rejected <@${uid}>.`, flags: MessageFlags.Ephemeral }), true;
    }

    // approve: role + personal tracked invite + kit DM
    if (a.approved) return i.reply({ content: 'Already approved.', flags: MessageFlags.Ephemeral }), true;
    const welcome = await client.channels.fetch(cfg.channels.welcome).catch(() => null);
    const invite = welcome && await welcome.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `ambassador:${uid}` }).catch(() => null);
    if (!invite) return i.reply({ content: 'Invite creation failed — check bot perms on welcome channel.', flags: MessageFlags.Ephemeral }), true;
    a.approved = true; a.code = invite.code; a.since = Date.now(); save();
    if (member) {
      await member.roles.add(cfg.campus.tiers[0].role).catch(() => {});
      await member.send({ embeds: [new EmbedBuilder().setTitle('🏛 Welcome, Ambassador').setColor(0xD4AF37)
        .setDescription([
          `You now represent **CyArt Studio** at **${a.college}**.`,
          '',
          `**Your personal invite:** https://discord.gg/${invite.code}`,
          'Every join through it counts toward your tier. Use it on posters, group chats, everywhere.',
          '',
          '**Tier ladder**',
          `T1 · ${cfg.campus.tiers[0].name} — ${cfg.campus.tiers[0].invites} recruits + ${cfg.campus.tiers[0].events} verified event → certificate + swag`,
          `T2 · ${cfg.campus.tiers[1].name} — ${cfg.campus.tiers[1].invites} recruits + ${cfg.campus.tiers[1].events} verified events → LoR + internship interview fast-track`,
          '',
          '**Duties:** host ≥1 campus event/semester · monthly check-in in ambassador HQ · log events with `/ambassador report-event`.',
          'Event kit (slides, posters, 2 workshop scripts) is pinned in the HQ channel.',
        ].join('\n'))] }).catch(() => {});
    }
    await i.update({ components: [] }).catch(() => {});
    return i.followUp({ content: `✓ Approved <@${uid}> · invite \`${invite.code}\``, flags: MessageFlags.Ephemeral }), true;
  }

  if (!i.isChatInputCommand() || i.commandName !== 'ambassador') return false;
  const sub = i.options.getSubcommand();

  if (sub === 'apply') {
    if (!ctx.phase('campus'))
      return i.reply({ content: 'Ambassador program opens soon — watch announcements.', flags: MessageFlags.Ephemeral }), true;
    if (ctx.user(i.user.id).xp < cfg.campus.minXp)
      return i.reply({ content: `Ambassadors are chosen from active members — you need **${cfg.campus.minXp} XP** first (you have ${ctx.user(i.user.id).xp}). Solve quests, join discussions, come back.`, flags: MessageFlags.Ephemeral }), true;
    if (data.amb[i.user.id])
      return i.reply({ content: data.amb[i.user.id].approved ? 'You\'re already an ambassador.' : 'Application already pending.', flags: MessageFlags.Ephemeral }), true;
    await i.showModal(new ModalBuilder().setCustomId('camb_app').setTitle('Campus Ambassador Application')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('college').setLabel('College / University').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('city').setLabel('City').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('why').setLabel('Why you? Clubs run, events hosted, reach').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event').setLabel('First event you would host').setStyle(TextInputStyle.Paragraph).setRequired(true))));
    return true;
  }

  if (sub === 'report-event') {
    if (!data.amb[i.user.id]?.approved)
      return i.reply({ content: 'Ambassadors only — `/ambassador apply` first.', flags: MessageFlags.Ephemeral }), true;
    await i.showModal(new ModalBuilder().setCustomId('camb_evm').setTitle('Log Campus Event')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Event title').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('date').setLabel('Date (YYYY-MM-DD)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('attendees').setLabel('Attendee count').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof').setLabel('Proof link (photos / registration sheet)').setStyle(TextInputStyle.Short).setRequired(true))));
    return true;
  }

  if (sub === 'stats') {
    const a = data.amb[i.user.id];
    if (!a?.approved)
      return i.reply({ content: 'Not an ambassador yet — `/ambassador apply`.', flags: MessageFlags.Ephemeral }), true;
    const t = a.tier ?? 0;
    const next = cfg.campus.tiers[t]; // next tier config, undefined if maxed
    const events = a.events.filter(e => e.ok).length;
    return i.reply({ embeds: [new EmbedBuilder().setTitle(`🏛 ${a.college}`).setColor(0xD4AF37)
      .setAuthor({ name: i.member.displayName, iconURL: i.user.displayAvatarURL() })
      .setDescription([
        `**Tier:** ${t ? cfg.campus.tiers[t - 1].name : 'Ambassador (probation)'}`,
        `**Recruits:** ${a.recruits.length}${next ? ` / ${next.invites}` : ''}`,
        `**Verified events:** ${events}${next ? ` / ${next.events}` : ''} (${a.events.length - events} pending)`,
        `**Your invite:** https://discord.gg/${a.code}`,
        next ? `\nNext: **${next.name}** at ${next.invites} recruits + ${next.events} events.` : '\nMax tier. Legend.',
      ].join('\n'))], flags: MessageFlags.Ephemeral }), true;
  }

  if (sub === 'roster') {
    if (!isStaff(cfg, i.member))
      return i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral }), true;
    const rows = Object.entries(data.amb).filter(([, a]) => a.approved)
      .sort((a, b) => b[1].recruits.length - a[1].recruits.length)
      .slice(0, 20)
      .map(([uid, a]) => `T${a.tier ?? 0} · <@${uid}> · **${a.college}** · ${a.recruits.length} recruits · ${a.events.filter(e => e.ok).length} events`);
    return i.reply({ embeds: [new EmbedBuilder().setTitle('🏛 Ambassador Roster').setColor(0xD4AF37)
      .setDescription(rows.join('\n') || 'No ambassadors yet.')
      .setFooter({ text: 'Social comparison drives output — consider posting this monthly in HQ' })], flags: MessageFlags.Ephemeral }), true;
  }
  return true;
}
