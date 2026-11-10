// Nightly backup of how the server is built: categories, channels, permissions, roles, onboarding, rules and AutoMod.
// No members, no messages. Saved in a stable order so the history shows exactly what changed and when,
// and so anything can be rebuilt if it's ever deleted by mistake.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { api, theGuild, TYPES } from './discord.mjs';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));

export async function backup() {
  const gid = await theGuild();
  const opt = (p) => api('GET', p).catch(() => null);
  const [guild, roles, channels, onboarding, verification, automod, welcome] = await Promise.all([
    api('GET', `/guilds/${gid}`), api('GET', `/guilds/${gid}/roles`), api('GET', `/guilds/${gid}/channels`),
    opt(`/guilds/${gid}/onboarding`), opt(`/guilds/${gid}/member-verification?with_guild=false`),
    opt(`/guilds/${gid}/auto-moderation/rules`), opt(`/guilds/${gid}/welcome-screen`),
  ]);
  const roleName = Object.fromEntries(roles.map((r) => [r.id, r.id === gid ? '@everyone' : r.name]));
  const chName = Object.fromEntries(channels.map((c) => [c.id, c.name]));
  const data = {
    server: pick(guild, ['name', 'description', 'verification_level', 'default_message_notifications', 'explicit_content_filter', 'preferred_locale', 'features']),
    roles: roles.sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, ...pick(r, ['name', 'color', 'hoist', 'mentionable', 'managed', 'permissions', 'position', 'unicode_emoji']) })),
    channels: channels.sort((a, b) => (a.parent_id || '').localeCompare(b.parent_id || '') || a.position - b.position).map((c) => ({
      id: c.id, type: TYPES[c.type] || c.type, category: c.parent_id ? chName[c.parent_id] : null,
      ...pick(c, ['name', 'position', 'topic', 'nsfw', 'rate_limit_per_user', 'bitrate', 'user_limit', 'default_auto_archive_duration']),
      permissions: (c.permission_overwrites || []).map((o) => ({ for: o.type === 0 ? roleName[o.id] || o.id : 'a member (id kept private)', allow: o.allow, deny: o.deny })),
    })),
    onboarding: onboarding && { enabled: onboarding.enabled, mode: onboarding.mode, default_channels: (onboarding.default_channel_ids || []).map((id) => chName[id] || id), prompts: onboarding.prompts?.map((p) => ({ title: p.title, single_select: p.single_select, required: p.required, options: p.options.map((o) => ({ title: o.title, description: o.description, roles: (o.role_ids || []).map((r) => roleName[r] || r), channels: (o.channel_ids || []).map((id) => chName[id] || id) })) })) },
    rules_screening: verification && verification.form_fields,
    welcome_screen: welcome,
    automod: automod && automod.map((r) => pick(r, ['name', 'enabled', 'event_type', 'trigger_type', 'trigger_metadata', 'actions', 'exempt_roles', 'exempt_channels'])),
  };
  await mkdir('backups', { recursive: true });
  const file = 'backups/server.json';
  const before = await readFile(file, 'utf8').catch(() => '');
  const after = JSON.stringify(data, null, 2) + '\n';
  await writeFile(file, after);
  return before === after ? 'Backup checked: nothing in the server structure changed.' : `Backup saved: ${channels.length} channels, ${roles.length} roles${before ? ' (changes since the last backup are in this commit)' : ''}.`;
}
