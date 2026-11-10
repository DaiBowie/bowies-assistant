// Deep dive: reads the whole server so Claude can understand it fully.
// The result is sealed (encrypted) before it reaches GitHub, so only the one-off key in Claude's session can open it.
// Friends' privacy: for other people's messages only counts and dates are kept, never what they said or who said it.
// Dai's own posts and bot posts are kept in full, because they describe how the server was meant to work.

import { mkdir, writeFile } from 'node:fs/promises';
import { publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { api, theGuild, TYPES } from './discord.mjs';
import { PERMS } from './perms.mjs';


const names = (bits) => { const b = BigInt(bits || 0); return PERMS.filter((_, i) => b & (1n << BigInt(i))); };
const VIEW = 1n << 10n; const SEND = 1n << 11n; const CONNECT = 1n << 20n;

function text(m) {
  const parts = [m.content];
  for (const e of m.embeds || []) parts.push([e.title, e.description, ...(e.fields || []).map((f) => `${f.name}: ${f.value}`), e.footer?.text].filter(Boolean).join('\n'));
  for (const a of m.attachments || []) parts.push(`[file: ${a.filename}]`);
  if (m.poll) parts.push(`[poll: ${m.poll.question?.text}]`);
  if (m.components?.length) parts.push('[has buttons or components]');
  return parts.filter(Boolean).join('\n');
}

export async function deepdive(req = {}) {
  const gid = await theGuild();
  const opt = (p) => api('GET', p).catch((e) => ({ unavailable: String(e.status || e.message) }));
  const guild = await api('GET', `/guilds/${gid}?with_counts=true`);
  const [channels, roles, emojis, stickers, onboarding, verification, automod, webhooks, invites, integrations, events, threads, sounds, widget, vanity, audit] = await Promise.all([
    api('GET', `/guilds/${gid}/channels`), api('GET', `/guilds/${gid}/roles`), api('GET', `/guilds/${gid}/emojis`), opt(`/guilds/${gid}/stickers`),
    opt(`/guilds/${gid}/onboarding`), opt(`/guilds/${gid}/member-verification?with_guild=false`), opt(`/guilds/${gid}/auto-moderation/rules`),
    opt(`/guilds/${gid}/webhooks`), opt(`/guilds/${gid}/invites`), opt(`/guilds/${gid}/integrations`), opt(`/guilds/${gid}/scheduled-events`),
    opt(`/guilds/${gid}/threads/active`), opt(`/guilds/${gid}/soundboard-sounds`), opt(`/guilds/${gid}/widget`), opt(`/guilds/${gid}/vanity-url`),
    opt(`/guilds/${gid}/audit-logs?limit=100`),
  ]);
  const owner = guild.owner_id;
  const roleName = Object.fromEntries(roles.map((r) => [r.id, r.id === gid ? '@everyone' : r.name]));
  const chName = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  // Members: counts per role and joining dates by month only.
  const roleCount = {}; const joinedByMonth = {}; let humans = 0; const bots = [];
  for (let after = '0'; ;) {
    const page = await api('GET', `/guilds/${gid}/members?limit=1000&after=${after}`);
    for (const m of page) {
      if (m.user.bot) bots.push(m.user.username); else humans++;
      for (const r of m.roles) roleCount[r] = (roleCount[r] || 0) + 1;
      const mo = m.joined_at?.slice(0, 7); if (mo) joinedByMonth[mo] = (joinedByMonth[mo] || 0) + 1;
    }
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }

  // Who can see and post in each channel, worked out from the role settings.
  const everyone = roles.find((r) => r.id === gid);
  const access = (c) => {
    const base = (r) => BigInt(r.permissions) | BigInt(everyone.permissions);
    const ow = Object.fromEntries((c.permission_overwrites || []).map((o) => [o.id, o]));
    const parent = c.parent_id ? channels.find((p) => p.id === c.parent_id) : null;
    const out = { see: [], post: [] };
    for (const r of roles) {
      let p = base(r);
      if (p & 8n) { out.see.push(roleName[r.id]); out.post.push(roleName[r.id]); continue; }
      for (const id of [gid, r.id]) { const o = ow[id]; if (o) { p &= ~BigInt(o.deny); p |= BigInt(o.allow); } }
      if (p & VIEW) out.see.push(roleName[r.id]);
      if ((p & VIEW) && (p & (c.type === 2 || c.type === 13 ? CONNECT : SEND))) out.post.push(roleName[r.id]);
    }
    const members = (c.permission_overwrites || []).filter((o) => o.type === 1).map((o) => (o.id === owner ? 'Dai (member override)' : 'one member (override)'));
    return { ...out, member_overrides: members, synced_with_category: parent ? JSON.stringify(parent.permission_overwrites) === JSON.stringify(c.permission_overwrites) : null };
  };

  // Every text channel and thread: Dai's and bots' posts in full, everyone else only counted.
  const archived = [];
  for (const c of channels.filter((c) => [0, 5, 15, 16].includes(c.type))) {
    for (const kind of ['public', 'private']) {
      const r = await api('GET', `/channels/${c.id}/threads/archived/${kind}?limit=100`).catch(() => null);
      if (r?.threads) archived.push(...r.threads);
    }
  }
  const allThreads = [...(threads.threads || []), ...archived];
  const readable = [...channels.filter((c) => [0, 2, 5, 13].includes(c.type)), ...allThreads];
  const channelReports = [];
  for (const c of readable) {
    const msgs = [];
    try {
      for (let before = null, pages = 0; pages < 30; pages++) {
        const page = await api('GET', `/channels/${c.id}/messages?limit=100${before ? `&before=${before}` : ''}`);
        msgs.push(...page); if (page.length < 100) break; before = page[page.length - 1].id;
      }
    } catch { /* voice channels without chat, or no access */ }
    const pins = await api('GET', `/channels/${c.id}/pins`).catch(() => []);
    const mine = msgs.filter((m) => m.author.id === owner || m.author.bot).reverse();
    const others = msgs.filter((m) => m.author.id !== owner && !m.author.bot);
    channelReports.push({
      name: c.name, id: c.id, thread_of: c.parent_id && allThreads.includes(c) ? chName[c.parent_id] : undefined,
      total_messages: msgs.length, from_dai: msgs.filter((m) => m.author.id === owner).length, from_bots: msgs.filter((m) => m.author.bot).length,
      from_others: others.length, other_people: new Set(others.map((m) => m.author.id)).size,
      first: msgs.at(-1)?.timestamp?.slice(0, 10) || null, last: msgs[0]?.timestamp?.slice(0, 10) || null,
      pinned: pins.length,
      dai_and_bot_posts: mine.map((m) => ({ date: m.timestamp.slice(0, 16).replace('T', ' '), by: m.author.id === owner ? 'Dai' : `bot ${m.author.username}`, pinned: !!m.pinned, text: text(m) })),
    });
  }

  const data = {
    taken: new Date().toISOString(),
    server: {
      name: guild.name, description: guild.description, created: new Date(Number((BigInt(gid) >> 22n) + 1420070400000n)).toISOString().slice(0, 10),
      members: humans, bots, boosts: guild.premium_subscription_count, boost_tier: guild.premium_tier, verification_level: guild.verification_level,
      explicit_filter: guild.explicit_content_filter, notifications: guild.default_message_notifications, mfa_required_for_mods: guild.mfa_level === 1,
      nsfw_level: guild.nsfw_level, locale: guild.preferred_locale, features: guild.features, afk: guild.afk_channel_id && chName[guild.afk_channel_id],
      system_channel: chName[guild.system_channel_id], rules_channel: chName[guild.rules_channel_id], updates_channel: chName[guild.public_updates_channel_id],
      safety_alerts_channel: chName[guild.safety_alerts_channel_id], has_icon: !!guild.icon, has_banner: !!guild.banner, has_splash: !!guild.splash,
      widget_enabled: !widget.unavailable, vanity: vanity.code || null, joined_by_month: joinedByMonth,
    },
    roles: roles.sort((a, b) => b.position - a.position).map((r) => ({
      name: roleName[r.id], colour: r.color ? `#${r.color.toString(16).padStart(6, '0').toUpperCase()}` : null, members: r.id === gid ? humans + bots.length : roleCount[r.id] || 0,
      shown_separately: r.hoist, mentionable: r.mentionable, managed_by_app: r.managed, icon: !!(r.icon || r.unicode_emoji), permissions: names(r.permissions),
    })),
    channels: channels.sort((a, b) => a.position - b.position).map((c) => ({
      name: c.name, type: TYPES[c.type] || c.type, category: c.parent_id ? chName[c.parent_id] : null, position: c.position, topic: c.topic || null,
      slowmode: c.rate_limit_per_user || 0, nsfw: !!c.nsfw, user_limit: c.user_limit || null, ...access(c),
    })),
    content: channelReports,
    onboarding, rules_screening: verification, automod,
    webhooks: Array.isArray(webhooks) ? webhooks.map((w) => ({ name: w.name, channel: chName[w.channel_id], type: w.type, app: w.application_id || null })) : webhooks,
    invites: Array.isArray(invites) ? invites.map((i) => ({ channel: i.channel?.name, by_dai: i.inviter?.id === owner, uses: i.uses, max_uses: i.max_uses, expires: i.expires_at })) : invites,
    integrations: Array.isArray(integrations) ? integrations.map((i) => ({ name: i.name, type: i.type, enabled: i.enabled, syncing: i.syncing, role: roleName[i.role_id] })) : integrations,
    events: Array.isArray(events) ? events.map((e) => ({ name: e.name, start: e.scheduled_start_time, channel: chName[e.channel_id], description: e.description })) : events,
    emojis: emojis.map((e) => ({ name: e.name, animated: e.animated, roles_only: (e.roles || []).map((r) => roleName[r]) })),
    stickers: Array.isArray(stickers) ? stickers.map((s) => ({ name: s.name, description: s.description, tags: s.tags })) : stickers,
    soundboard: sounds.items ? sounds.items.map((s) => ({ name: s.name, emoji: s.emoji_name, volume: s.volume })) : sounds,
    audit_log_recent: Array.isArray(audit.audit_log_entries) ? audit.audit_log_entries.map((e) => ({ action: e.action_type, by: e.user_id === owner ? 'Dai' : 'someone else', date: new Date(Number((BigInt(e.id) >> 22n) + 1420070400000n)).toISOString().slice(0, 10), reason: e.reason || null })) : audit,
  };

  // Sealed so only Claude's one-off key for this session can open it. The readable version never touches GitHub.
  if (!req.seal_with) throw new Error('A deep dive needs a seal_with public key so the result stays private');
  const key = randomBytes(32); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  const sealed = {
    note: 'Private deep dive, sealed. Only the matching one-off key can open it. Delete when done.',
    key: publicEncrypt({ key: req.seal_with, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: body.toString('base64'),
  };
  await mkdir('reports/sealed', { recursive: true });
  await writeFile('reports/sealed/deep-dive.json', JSON.stringify(sealed));
  return `Deep dive done: ${channels.length} channels, ${allThreads.length} threads, ${roles.length} roles, ${channelReports.reduce((n, c) => n + c.total_messages, 0)} messages read (others' kept as counts only). Sealed so only Claude can open it.`;
}
