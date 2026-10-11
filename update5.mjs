// v5: the five pillars — quest engine, campus ambassadors, intern waves,
// organic-invite extension, mod pipeline. Creates roles/channels, writes config
// with ALL PHASES OFF; staff rolls out week by week via /phase.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const cfg = JSON.parse(readFileSync('./config.json'));

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
  ADD_REACT: 1n << 6n, SEND_THREADS: 1n << 38n, MANAGE_MSG: 1n << 13n, MODERATE: 1n << 40n,
};
const s = v => v.toString();
const ow = (id, allow = 0n, deny = 0n) => ({ id, type: 0, allow: s(allow), deny: s(deny) });
const STAFF = [cfg.roles.founder, cfg.roles.core, cfg.roles.mod];
const staffAllow = STAFF.map(id => ow(id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.ADD_REACT | P.SEND_THREADS));

console.log('== 1. Roles ==');
const existing = await api(`/guilds/${G}/roles`);
async function role(name, opts) {
  const old = existing.find(r => r.name === name);
  if (old) { console.log(` ${name} exists, reusing`); return old; }
  const r = await api(`/guilds/${G}/roles`, 'POST', { name, permissions: '0', ...opts });
  console.log(` + ${name}`);
  return r;
}
const questChampion = await role('⚔ Quest Champion', { color: 0xE8C547, hoist: true });
const streak        = await role('🜂 Streak Certified', { color: 0xE67E22 });
const campusAmb     = await role('🏛 Campus Ambassador', { color: 0xD4AF37 });
const leadAmb       = await role('🏛 Lead Ambassador', { color: 0xD4AF37, hoist: true });
const intern        = await role('🛰 Intern', { color: 0x6FCF97 });
const talentMagnet  = await role('🧲 Talent Magnet', { color: 0x38B6FF, hoist: true });
const trialMod      = await role('🧭 Trial Mod', {
  color: 0x4A78C4, permissions: s(P.MODERATE | P.MANAGE_MSG), // timeout + delete only; no ban
});

console.log('== 2. Channels ==');
const chans = await api(`/guilds/${G}/channels`);
const catBy = k => chans.find(c => c.type === 4 && c.name.includes(k));
const mkCh = (name, parent_id, permission_overwrites, extra = {}) =>
  api(`/guilds/${G}/channels`, 'POST', { name, type: 0, parent_id, permission_overwrites, ...extra });
const chBy = n => chans.find(c => c.name === n);

// ⚔・quests — read + react only; answers go through the modal, never chat (no spoilers)
let questsCh = chBy('⚔・quests');
if (!questsCh) questsCh = await mkCh('⚔・quests', catBy('HEADQUARTERS').id, [
  ow(G, 0n, P.VIEW),
  ow(cfg.roles.verified, P.VIEW | P.ADD_REACT, P.SEND),
  ...staffAllow,
], { topic: 'Alternate-day challenge drops · cyber → ai → web3 · answer via the button, first 3 solvers get bonus QP' });

// 🤝・find-a-teammate — squad formation for team quests + hackathons
let teamup = chBy('🤝・find-a-teammate');
if (!teamup) teamup = await mkCh('🤝・find-a-teammate', catBy('BUILD ZONE').id, [
  ow(G, 0n, P.VIEW),
  ow(cfg.roles.verified, P.VIEW | P.SEND | P.ADD_REACT | P.SEND_THREADS),
  ...staffAllow,
], { topic: 'Recruit squadmates for team quests and hackathons · format: [what you build] [what you need] [timezone]' });

// 🏛・ambassador-hq — private: ambassadors + staff
let hq = chBy('🏛・ambassador-hq');
if (!hq) hq = await mkCh('🏛・ambassador-hq', catBy('MENTORSHIP').id, [
  ow(G, 0n, P.VIEW),
  ow(campusAmb.id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.ADD_REACT | P.SEND_THREADS),
  ow(leadAmb.id, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.ADD_REACT | P.SEND_THREADS),
  ...staffAllow,
], { topic: 'Ambassador ops · monthly check-ins · event kit pinned · /ambassador report-event to log events' });

console.log('== 3. Seed panels ==');
await api(`/channels/${questsCh.id}/messages`, 'POST', { embeds: [{
  title: '⚔ How Quests Work', color: 0xE8C547,
  description: [
    'Every **other day** a challenge drops here, rotating **⌖ cyber → ◎ AI → ⬡ web3**. Usually two tiers: ✧ Easy and ★ Hard.',
    '',
    '**Answering** · hit *Submit Answer* on the drop — it\'s a private form, nobody sees your attempts. 5 tries per day per quest.',
    '**Scoring** · QP (quest points) — separate from XP. Easy 10 QP · Hard 25 QP · first three solvers +15/+10/+5.',
    '**Monthly race** · `/quest lb` — board resets every month, #1 takes the hoisted **⚔ Quest Champion** role.',
    '**Streaks** · solve consecutive drops → **🜂 Streak Certified** at 15 straight (≈one month). Announced in hall-of-fame, made to be screenshotted.',
    '',
    'Podium solves auto-post to ⚡・wins. `/quest me` for your stats.',
  ].join('\n'),
}]});
const kit = await api(`/channels/${hq.id}/messages`, 'POST', { embeds: [{
  title: '🏛 Ambassador Event Kit', color: 0xD4AF37,
  description: [
    '**Ready-to-run formats** (30–60 min, zero budget):',
    '**1 · Intro to CTF** — walk the room through 3 easy challenges from our quest archive; end with live server quest.',
    '**2 · Build your first AI agent** — one API key, 40 lines of code, working agent before the session ends.',
    '',
    '**Poster/slide templates:** ask staff here — drop your college name, we return branded assets within 48h.',
    '**Golden rule:** every event ends with your personal invite QR on screen. Your link = your tier credit.',
    '',
    '**Duties recap** · ≥1 event/semester · monthly check-in here · `/ambassador report-event` after each event (photos or registration sheet as proof).',
  ].join('\n'),
}]});
await api(`/channels/${hq.id}/pins/${kit.id}`, 'PUT').catch(() => {});
console.log(' panels posted');

console.log('== 4. Config ==');
cfg.roles.questChampion = questChampion.id;
cfg.roles.streak = streak.id;
cfg.roles.campusAmb = campusAmb.id;
cfg.roles.leadAmb = leadAmb.id;
cfg.roles.talentMagnet = talentMagnet.id;
cfg.channels.quests = questsCh.id;
cfg.channels.teamup = teamup.id;
cfg.channels.ambassadorHq = hq.id;
cfg.phases = { quests: false, campus: false, interns: false, modpipeline: false };
cfg.quests = {
  postHour: 17,                    // host-local time; drops land at 5pm
  solveXp: { easy: 60, hard: 150 },
  firstSolverQp: [15, 10, 5],
  streakCertSolves: 15,            // 15 consecutive alternate-day drops ≈ 30 days
  maxAttemptsPerDay: 5,
};
cfg.campus = {
  minXp: 300,                      // ◈ Amateur — skin in the game before applying
  tiers: [
    { name: 'Campus Ambassador', role: campusAmb.id, invites: 20, events: 1 },
    { name: 'Lead Ambassador',   role: leadAmb.id,   invites: 75, events: 3 },
  ],
};
cfg.interns = { role: intern.id, defaultWaveSize: 70 };
cfg.modpipe = { trialRole: trialMod.id, probationDays: 21, windowDays: 30, minActiveDays: 15 };
if (!cfg.invites.milestones.some(m => m.count === 30))
  cfg.invites.milestones.push({ count: 30, role: talentMagnet.id, name: '🧲 Talent Magnet', bonus: 3000 });
writeFileSync('config.json', JSON.stringify(cfg, null, 2));
console.log('DONE — config v5. All phases OFF. Roll out with /phase set (see README rollout plan).');
