// Intern wave onboarding — 350 interns land in controlled batches, not one spike.
// Each wave = a capped invite link; joins through it auto-get 🛰 Intern role + a
// quest-first welcome DM. Friend-invites stay organic: interns use the normal
// personal-invite system (XP + Scout/Ambassador/Talent Magnet milestones already
// reward it) — nobody is ever told to recruit.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits as PF } from 'discord.js';

const IF = 'data/interns.json';
const data = existsSync(IF) ? JSON.parse(readFileSync(IF)) : { waves: {} }; // waves[name] = { code, size, joined: [] }
const save = () => writeFileSync(IF, JSON.stringify(data, null, 2));

export function init(ctx) {
  ctx.hooks.inviteUsed.push(async (member, code) => {
    if (!code) return;
    const entry = Object.entries(data.waves).find(([, w]) => w.code === code);
    if (!entry) return;
    const [name, w] = entry;
    if (w.joined.includes(member.id)) return;
    w.joined.push(member.id); save();
    await member.roles.add(ctx.cfg.interns.role).catch(() => {});
    // activation within first minutes = retention. Point them at one concrete action.
    await member.send({ embeds: [new EmbedBuilder().setColor(0x6FCF97)
      .setTitle('🛰 Welcome aboard, intern')
      .setDescription([
        `You're in **CyArt Studio** with wave **${name}**.`,
        '',
        `**Do one thing right now:** open <#${ctx.cfg.channels.quests}> and take a shot at the live quest. First solve feels good.`,
        `Then grab your domain in the choose-your-path channel — it unlocks your zone.`,
        '',
        `Hackathon and project squads form in <#${ctx.cfg.channels.teamup}> — anyone you know who builds is welcome here. Your invite link earns you XP and ranks (see ⟐ invite-rewards).`,
      ].join('\n'))] }).catch(() => {});
  });
}

export function commands() {
  return [
    new SlashCommandBuilder().setName('wave').setDescription('Staff: intern wave onboarding')
      .setDefaultMemberPermissions(String(PF.ManageGuild))
      .addSubcommand(s => s.setName('create').setDescription('Create a capped intern wave invite')
        .addStringOption(o => o.setName('name').setDescription('Wave label, e.g. W1-jul').setRequired(true))
        .addIntegerOption(o => o.setName('size').setDescription('Max joins (default 70)')))
      .addSubcommand(s => s.setName('stats').setDescription('Join counts per wave'))
      .toJSON(),
  ];
}

export async function onInteraction(i, ctx) {
  if (!i.isChatInputCommand() || i.commandName !== 'wave') return false;
  const { cfg } = ctx;
  const sub = i.options.getSubcommand();

  if (sub === 'create') {
    if (!ctx.phase('interns'))
      return i.reply({ content: 'Interns phase is off — enable with `/phase set name:interns state:on`.', flags: MessageFlags.Ephemeral }), true;
    const name = i.options.getString('name', true);
    if (data.waves[name])
      return i.reply({ content: `Wave **${name}** already exists (\`${data.waves[name].code}\`).`, flags: MessageFlags.Ephemeral }), true;
    const size = i.options.getInteger('size') ?? cfg.interns.defaultWaveSize;
    const welcome = await ctx.client.channels.fetch(cfg.channels.welcome).catch(() => null);
    const invite = welcome && await welcome.createInvite({
      maxAge: 14 * 86_400, maxUses: size, unique: true, reason: `intern wave ${name}`,
    }).catch(() => null);
    if (!invite)
      return i.reply({ content: 'Invite creation failed — check bot perms on welcome channel.', flags: MessageFlags.Ephemeral }), true;
    data.waves[name] = { code: invite.code, size, joined: [], createdAt: Date.now() };
    save();
    return i.reply({ content: [
      `🛰 Wave **${name}** live: https://discord.gg/${invite.code}`,
      `Cap ${size} · expires in 14 days · joiners auto-get <@&${cfg.interns.role}> + quest-first welcome DM.`,
      'Send this link to the batch via internal mail. Next wave next week — steady visible growth beats one spike.',
    ].join('\n'), flags: MessageFlags.Ephemeral }), true;
  }

  if (sub === 'stats') {
    const rows = Object.entries(data.waves)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .map(([name, w]) => `**${name}** · ${w.joined.length}/${w.size} joined · \`${w.code}\``);
    const total = Object.values(data.waves).reduce((n, w) => n + w.joined.length, 0);
    return i.reply({ embeds: [new EmbedBuilder().setTitle('🛰 Intern Waves').setColor(0x6FCF97)
      .setDescription(rows.join('\n') || 'No waves yet — `/wave create`.')
      .setFooter({ text: `${total} interns onboarded total` })], flags: MessageFlags.Ephemeral }), true;
  }
  return true;
}
