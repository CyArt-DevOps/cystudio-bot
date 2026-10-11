# Studio Bot — CyArt Studio community (studio.cyart.io)

Gamified startup-support community for builders in **⌖ Cybersecurity · ⏣ AI · ⬡ Web3**.

## Files
- `index.mjs` — the bot: verification, tickets, domain paths, XP rank engine, leaderboard. **Must stay running** (`npm start`; host 24/7 with pm2/VPS/Railway).
- `setup2.mjs` — gamified server rebuild (already executed). `setup.mjs`/`cleanup-roles.mjs` are v1 history.
- `config.json` — live role/channel IDs + rank thresholds. Bot reads this.
- `data/xp.json` — XP database. **Back this up**; deleting it resets all progression.
- `.env` — token. Never commit.

## Progression system
| Rank | XP | Unlocks |
|---|---|---|
| ✧ Newcomer | 0 | chat, voice, domains |
| ◈ Amateur | 300 | post in ⌘·showcase & ✍·founder-diaries |
| ★ Pro | 2,500 | publish in ⌗·resources |
| ✦ Advisor | 10,000 | ✦·advisor-lounge, mentor status (hoisted + pingable), speak in ◉·office-hours |

**XP sources:** 15–25 per message (60s cooldown) · 8 per 5 min voice (needs ≥2 humans) · +40 bonus for ⚡·wins or showcase posts (1h cooldown). Rank-ups announced in ⇮·rank-ups. Rank roles swap automatically.

**Commands:** `/rank [user]` · `/leaderboard` · `/invites [user]` · `/grant-xp user amount` (staff; negative = penalty/farming reset). Leaderboard channel auto-refreshes hourly.

## Link rights
Links unlock at **120 XP** — bot auto-grants ⟢ Trusted (exempt from the link AutoMod rule, embed previews enabled). NSFW rules stay active for everyone. Until then all links auto-delete.

## Boost rewards
Boosting grants **+500 XP instantly**, a **1.5× XP multiplier** while boosting, and embed + image rights in the Lounge and zones. Announced in △·rank-ups.

## Progressive onboarding
New members are never info-dumped. Welcome shows 3 steps only; verify reply gives 2 actions; ✧·start-here has on-demand button guides (XP & Ranks / Domain Zones / Link Rights / Invites / Boosts — all ephemeral). Drip DMs: at 50 XP (how XP works), at 120 XP (Trusted unlocked).

## Domain zones
Each domain role gates its own private zone (text + VC): ⌖ CYBERSEC ZONE (cyber-talk, vuln-research, sec-startups, War Room) · ◎ AI ZONE (ai-talk, model-lab, ai-startups, Neural Lounge) · ⬡ WEB3 ZONE (web3-talk, protocol-lab, web3-startups, Block Space). Join/leave via ⟡·choose-your-path buttons.

## Invite rewards
+75 XP per invite. Milestones: **⟐ Scout** (3 invites → +300 XP, image rights in Lounge) · **◇ Ambassador** (10 invites → +1,000 XP, hoisted badge, embeds+images in Lounge). Tracked automatically by diffing invite uses on member join; rejoins never double-count. Program explained in ⟐·invite-rewards.

## Structure
GATEWAY (welcome/rules/verify/choose-your-path) → HEADQUARTERS (announcements, events, hall-of-fame, leaderboard, rank-ups) → LOUNGE → DOMAINS (cybersecurity, ai-lab, web3-forge, tooling) → BUILD ZONE (startup-ideas, feedback-exchange forum, showcase, resources, founder-diaries) → MENTORSHIP (ask-an-advisor, office-hours, advisor-lounge) → SUPPORT (tickets) → VOICE (Commons, War Room, Neural Lounge, Block Space, Pitch Deck, Deep Focus) → STAFF.

## Moderation
- AutoMod: blocks all links (staff exempt), NSFW/slur presets, spam, mention raids → alerts in ⌗·mod-logs.
- Members lack Embed Links/Attach Files except where earned (showcase, wins).
- Unverified see only GATEWAY. Verify button gates everything.

## v5 — The Five Pillars (phase-gated modules)

Run `node update5.mjs` once (creates roles/channels, writes config, **all phases OFF**), restart the bot, then roll out one phase per week with `/phase set`. Never launch all at once — each phase needs its predecessor's activity as fuel.

### Rollout plan
| Week | Action | Why this order |
|---|---|---|
| 0 | `update5.mjs`, `update6.mjs`, then `node quest-bank.mjs` (seeds 156 quests) + restart | Content before audience |
| 1 | `/phase set quests on` + first intern `/wave create W1 size:70` | Interns land into a *live* game, not an empty room |
| 2 | `/phase set interns on` (before first wave) + `/phase set engage on` | Wave joins need the hook active; Rumble + reminders keep week-1 joiners warm |
| 2–5 | One `/wave create` per week (5 waves ≈ 350) + a weekly `/rumble start` | Steady visible growth; Rumble gives every wave a shared event |
| 3 | `/phase set campus on`, announce ambassador applications | Applicants now have XP history to be judged by |
| 5–6 | `/phase set modpipeline on`, run `/mod-candidates` | Telemetry needs ~4 weeks of messages to mean anything |

### Pillar 1 — Quest engine (`modules/quests.mjs`)
Alternate-day drops in ⚔・quests cycling **cyber → ai → web3** at `quests.postHour` (17:00 host time). Easy + Hard tier per drop. Answers via private modal (sha256-hashed in `data/quests.json` — bank file never leaks solutions), 5 attempts/day, closes after 48h. Rewards: QP (10/25 + first-3 bonus 15/10/5) **separate from XP** (60/150). QP resets monthly; #1 takes hoisted **⚔ Quest Champion**; top-3 announced in hall-of-fame. 15 consecutive drops (≈30 days) = **🜂 Streak Certified** + public certificate embed. Podium solves auto-post win cards to ⚡・wins (shareable artifact = organic growth). Staff: `/quest add|post|list`. Members: `/quest me|lb`. Bank-empty alerts → mod-logs.

### Pillar 2 — Student participation
Quests supply skill-proof (certificates, champion role, fame posts — all screenshot-able for LinkedIn). 🤝・find-a-teammate covers hackathon/squad networking. Opportunity magnet = existing internships pipeline + ambassador fast-track perks.

### Pillar 3 — Campus Ambassadors (`modules/campus.mjs`)
`/ambassador apply` (gated at 300 XP — skin in the game) → modal → staff Approve/Reject buttons in 🏛・ambassador-hq. Approval mints a **personal permanent invite** (joins through it = recruit credit, tracked via invite hook). Tier ladder auto-evaluates: **T1** 20 recruits + 1 verified event → certificate + swag; **T2 Lead** 75 + 3 → LoR + interview fast-track (hoisted role, fame announcement). `/ambassador report-event` → staff Verify button. Monthly check-in reminder posts in HQ on the 1st. `/ambassador stats|roster`. Event kit pinned in HQ.

### Pillar 4 — Intern waves (`modules/interns.mjs`)
`/wave create name size` → capped 14-day invite; joins auto-get 🛰 Intern + activation DM pointing at the live quest (first action in 5 min = retention). `/wave stats` per-wave counts. Friend-invites stay **organic**: interns are never told to recruit — the existing invite-XP economy (+ new 🧲 Talent Magnet at 30 invites, +3000 XP, hoisted) plus shareable win cards do the pulling.

### Pillar 5 — Mod pipeline (`modules/modpipeline.mjs`)
Passive telemetry per member: active days + hour-of-day spread (timezone coverage), pruned at 45d. `/mod-candidates` scores everyone (consistency×3 + coverage×2 + capped XP; requires 15+ active days/30, 30d tenure, no warn in 90d; staff excluded). Then: DM top picks 3 scenario questions → `/trial-mod start` (🧭 role = timeout+delete only, **no ban**) → auto-reminder in mod-logs at day 21 → `/trial-mod end verdict:promote|revoke`. `/warn user reason` logs, DMs, kills any active probation and disqualifies from pipeline for 90d. `/warns user` shows record.

### Quest bank (6 months of content)
`quest-bank.mjs` holds a curated, current-trend (2025–26) question set — **156 quests, 26 easy + 26 hard per domain (cyber/ai/web3)** ≈ 5+ months of alternate-day drops; the weekly Rumble replaces some drop-days and staff add breaking-news quests via `/quest add`, filling a full 6 months. Every quest ships an **answer, a hint** (unlocks after 2 misses — teaches direction, never spoils), a one-line **explanation**, and a **reference link** (both posted publicly when the quest closes, so non-solvers still learn). Ordered fundamentals → applied, so the six months read as a curriculum, not trivia. Many are hands-on: *decode this base64, solve this Caesar cipher, look up this CVE number, compute the token headroom*.
- Seed: `node quest-bank.mjs` (idempotent — skips quests already present by text). `--wipe` clears only queued first; `--dry` prints counts, writes nothing.
- Answer matching ignores case, spaces, commas, and hyphens (`zero-day` == `zero day`, `1,000` == `1000`). Keep this file private — it contains solutions.
- Staff rule: every manual `/quest add` should include `hint:`, `explain:`, and `ref:` — the learning loop is only as good as those fields.

### Engagement engine (`modules/engagement.mjs`, phase `engage`)
Two dopamine loops layered on the quest system:
- **Quest Rumble** — `/rumble start [domain] [qp]` opens a 60-second join window (click *Enter the Arena*); the bot then simulates a themed battle-royale where **every elimination line names a real participant**, editing one message round-by-round for suspense, and crowns a winner (+QP). **Roster is drawn only from active, domain-specific members**: the join button is gated to members who posted in the last 7 days and (if a domain is set) hold that domain role; if fewer than 12 opt in, the arena is auto-drafted from active members of that domain (up to 16). Auto-drafted winners get a name shout-out but no surprise ping — only opt-in winners are @mentioned. It's a coin-flip dressed as a saga — people love it because their own name is in the story.
- **Personalized reminders** — instead of one nagging "come back" DM, the bot picks the single most-relevant nudge per member and **never repeats the same type twice in a row**: *almost-ranked-up · close to monthly top-10 · streak at risk · a drop in your domain is waiting · genuine comeback (5–12 days quiet)*. Respects a 3-day cooldown, a 40/day cap (rate-limit + spam safety), evening-only send, and a one-click opt-out (`/reminders off`). Variety makes it read as the server noticing you, not a mailing list.
- Config: `engage: { reminderHour, cooldownDays, dailyCap }`. Enable with `/phase set name:engage state:on`.

### v5 data files
`data/quests.json` (bank + rotation state) · `data/campus.json` (ambassadors) · `data/interns.json` (waves) · telemetry/QP live inside `data/xp.json` per-user (`u.q`, `u.md`). Back up all of `data/`.

## Remaining manual steps
- Reset the bot token (it was pasted in chat) and update `.env`.
- After `update5.mjs`: stock the quest bank before enabling the quests phase.
