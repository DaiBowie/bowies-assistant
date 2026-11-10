// Security: nightly watch for risky changes, audit-log review, and a one-step lockdown that can be undone exactly.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { api, theGuild } from './discord.mjs';
import { PERMS } from './perms.mjs';

const RISKY = ['Administrator', 'Manage server', 'Manage roles', 'Manage channels', 'Manage webhooks', 'Ban', 'Kick', 'Manage messages', 'Timeout members'];
const has = (perms, name) => !!(BigInt(perms) & (1n << BigInt(PERMS.indexOf(name))));
const channelByName = async (gid, name) => (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === name);
const post = async (ch, title, lines, color = 0xd9534f) => ch && api('POST', `/channels/${ch.id}/messages`, { embeds: [{ title, description: lines.join('\n').slice(0, 4000), color, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });

async function picture(gid) {
  const roles = await api('GET', `/guilds/${gid}/roles`);
  const members = [];
  for (let after = '0'; ;) {
    const page = await api('GET', `/guilds/${gid}/members?limit=1000&after=${after}`);
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  const webhooks = await api('GET', `/guilds/${gid}/webhooks`).catch(() => []);
  const invites = await api('GET', `/guilds/${gid}/invites`).catch(() => []);
  const automod = await api('GET', `/guilds/${gid}/auto-moderation/rules`).catch(() => []);
  const guild = await api('GET', `/guilds/${gid}`);
  return {
    risky_roles: Object.fromEntries(roles.filter((r) => !r.managed && RISKY.some((p) => has(r.permissions, p))).map((r) => [r.name, RISKY.filter((p) => has(r.permissions, p))])),
    admins_count: Object.fromEntries(roles.filter((r) => has(r.permissions, 'Administrator')).map((r) => [r.name, members.filter((m) => m.roles.includes(r.id)).length])),
    bots: members.filter((m) => m.user.bot).map((m) => m.user.username).sort(),
    webhooks: webhooks.map((w) => w.name).sort(),
    never_expiring_invites: invites.filter((i) => !i.max_age).length,
    automod_on: automod.filter((r) => r.enabled).map((r) => r.name).sort(),
    verification_level: guild.verification_level,
    explicit_filter: guild.explicit_content_filter,
    mod_2fa: guild.mfa_level === 1,
  };
}

const AUDIT = { 1: 'server settings changed', 12: 'channel deleted', 20: 'member kicked', 21: 'members pruned', 22: 'member banned', 23: 'ban lifted', 25: 'member roles changed', 28: 'bot added', 30: 'role created', 31: 'role changed', 32: 'role deleted', 50: 'webhook created', 51: 'webhook changed', 72: 'messages bulk deleted', 140: 'AutoMod rule created', 141: 'AutoMod rule changed', 142: 'AutoMod rule deleted', 143: 'AutoMod blocked a message', 145: 'AutoMod timed someone out' };

export async function securityWatch() {
  const gid = await theGuild();
  const now = await picture(gid);
  const before = JSON.parse(await readFile('state/security.json', 'utf8').catch(() => 'null'));
  const alerts = [];
  if (before) {
    for (const [role, perms] of Object.entries(now.risky_roles)) {
      const was = before.risky_roles[role] || [];
      const added = perms.filter((p) => !was.includes(p));
      if (added.length) alerts.push(`⚠️ **${role}** gained: ${added.join(', ')}`);
    }
    for (const b of now.bots) if (!before.bots.includes(b)) alerts.push(`🤖 New bot in the server: **${b}**`);
    for (const w of now.webhooks) if (!before.webhooks.includes(w)) alerts.push(`🪝 New webhook: **${w}**`);
    for (const r of before.automod_on) if (!now.automod_on.includes(r)) alerts.push(`🛡 AutoMod rule switched off or removed: **${r}**`);
    if (now.verification_level < before.verification_level) alerts.push('🔓 Verification level was lowered');
    if (now.explicit_filter < before.explicit_filter) alerts.push('🔓 Explicit media filter was lowered');
    for (const [role, n] of Object.entries(now.admins_count)) if (n > (before.admins_count[role] ?? 0)) alerts.push(`👑 More people have **${role}** (full admin): ${before.admins_count[role] ?? 0} → ${n}`);
  }
  // Audit log: what happened in the last 24 hours.
  const since = Date.now() - 86400000;
  const log = await api('GET', `/guilds/${gid}/audit-logs?limit=100`).catch(() => ({ audit_log_entries: [] }));
  const counts = {};
  for (const e of log.audit_log_entries || []) {
    const t = Number((BigInt(e.id) >> 22n) + 1420070400000n);
    if (t < since || !AUDIT[e.action_type]) continue;
    counts[AUDIT[e.action_type]] = (counts[AUDIT[e.action_type]] || 0) + 1;
  }
  // Keep the member counter in Welcome up to date.
  const counter = (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name.startsWith('👥 Members'));
  const humans = (await api('GET', `/guilds/${gid}?with_counts=true`)).approximate_member_count;
  if (counter && counter.name !== `👥 Members: ${humans}`) await api('PATCH', `/channels/${counter.id}`, { name: `👥 Members: ${humans}` }).catch(() => {});
  await mkdir('state', { recursive: true });
  await writeFile('state/security.json', JSON.stringify(now, null, 2) + '\n');
  if (alerts.length) await post(await channelByName(gid, '🚨・safety-alerts'), '🚨 Security watch: something changed', [...alerts, '', 'If Dai or Wolf did this on purpose, nothing needs doing.']);
  const summary = Object.entries(counts).map(([k, v]) => `• ${k}: ${v}`);
  if (summary.length) await post(await channelByName(gid, '📋・assistant-log'), '🛡 Last 24 hours', summary, 0x2a4f8f);
  return `Security watch: ${alerts.length} alert(s), ${summary.length} kinds of activity${before ? '' : ' (first run: baseline saved)'}`;
}

const QUIET = ['Send messages', 'Send in threads', 'Public threads', 'Private threads', 'Add reactions', 'Speak'];
export async function lockdown(gid, why, s = {}) {
  const roles = await api('GET', `/guilds/${gid}/roles`);
  const staff = new Set(roles.filter((r) => ['Owner', 'Co-owner', 'Administrators', 'Developers', "Bowie's Assistant"].includes(r.name)).map((r) => r.id));
  const channels = await api('GET', `/guilds/${gid}/channels`);
  const skip = new Set(channels.filter((c) => c.type === 4 && /STAFF|PERSONAL/.test(c.name)).map((c) => c.id));
  const saved = {};
  let quiet = 0n; for (const q of QUIET) quiet |= 1n << BigInt(PERMS.indexOf(q));
  for (const c of channels) {
    if (c.type === 4 || skip.has(c.parent_id)) continue;
    saved[c.id] = c.permission_overwrites;
    const ow = (c.permission_overwrites || []).map((o) => (o.type === 0 && !staff.has(o.id) ? { ...o, allow: (BigInt(o.allow) & ~quiet).toString(), deny: (BigInt(o.deny) | quiet).toString() } : o));
    if (!ow.some((o) => o.id === gid)) ow.push({ id: gid, type: 0, allow: '0', deny: quiet.toString() });
    await api('PATCH', `/channels/${c.id}`, { permission_overwrites: ow }, { reason: why });
  }
  await mkdir('state', { recursive: true });
  await writeFile('state/lockdown.json', JSON.stringify({ at: new Date().toISOString(), saved }, null, 2));
  const hours = Math.min(24, s.pause_invites_hours || 24);
  await api('PUT', `/guilds/${gid}/incident-actions`, { invites_disabled_until: new Date(Date.now() + hours * 3600000).toISOString(), dms_disabled_until: new Date(Date.now() + hours * 3600000).toISOString() }, { reason: why }).catch(() => {});
  const a = (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === '📢・announcements');
  if (a && s.notice !== false) await api('POST', `/channels/${a.id}/messages`, { embeds: [{ title: '📛 The server is paused', description: s.notice_text || 'Chat is paused for a little while to keep everyone safe. Dai and Wolf are on it. Thanks for your patience. 💙', color: 0xd9534f }], allowed_mentions: { parse: [] } });
  return `locked down ${Object.keys(saved).length} channels and paused invites and DMs from non-friends for ${hours} hours`;
}

export async function unlock(gid, why) {
  const st = JSON.parse(await readFile('state/lockdown.json', 'utf8').catch(() => 'null'));
  if (!st) return 'nothing to unlock';
  for (const [id, ow] of Object.entries(st.saved)) await api('PATCH', `/channels/${id}`, { permission_overwrites: ow }, { reason: why }).catch(() => {});
  await api('PUT', `/guilds/${gid}/incident-actions`, { invites_disabled_until: null, dms_disabled_until: null }, { reason: why }).catch(() => {});
  await writeFile('state/lockdown.json', 'null\n');
  const a = (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === '📢・announcements');
  if (a) await api('POST', `/channels/${a.id}/messages`, { embeds: [{ title: '✅ The server is back', description: 'Everything is open again. Thanks for waiting. 💙', color: 0x2f7a44 }], allowed_mentions: { parse: [] } });
  return `unlocked ${Object.keys(st.saved).length} channels exactly as they were`;
}
