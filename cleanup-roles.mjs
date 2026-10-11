// Run AFTER dragging "Studio Bot" role to the TOP of Server Settings -> Roles.
// Renames FAM -> 🌱 Newcomer (keeps member assignments) and deletes leftover junk roles.
import 'dotenv/config';

const T = process.env.DISCORD_TOKEN, G = process.env.GUILD_ID;
const api = async (p, method = 'GET', body) => {
  const r = await fetch(`https://discord.com/api/v10${p}`, {
    method, headers: { Authorization: `Bot ${T}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};

const FAM = '932346888487858176';
const DELETE = ['931653427510013994' /* COMMUNITY HELPER */, '932033093756420117' /* Degen Mod */, '955699571659513896' /* BOTS */];

await api(`/guilds/${G}/roles/${FAM}`, 'PATCH', {
  name: '🌱 Newcomer', color: 0x95A5A6, hoist: false, mentionable: false,
  permissions: '65536', // read message history only; overwrites control the rest
}).then(() => console.log('FAM renamed to 🌱 Newcomer'))
  .catch(e => console.log('FAM rename FAILED (drag Studio Bot role to top first):', e.message));

for (const id of DELETE) {
  await api(`/guilds/${G}/roles/${id}`, 'DELETE')
    .then(() => console.log(`deleted role ${id}`))
    .catch(e => console.log(`delete ${id} failed:`, e.message.slice(0, 100)));
}

// old bot roles (managed) vanish only when those bots are kicked
const roles = await api(`/guilds/${G}/roles`);
const junkBots = roles.filter(r => r.managed && !['Studio Bot', 'Server Booster'].includes(r.name));
if (junkBots.length) console.log('\nManaged roles remain (kick these bots to remove):', junkBots.map(r => r.name).join(', '));
console.log('Done.');
