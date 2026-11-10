// Scheduled posts: a daily prompt, a song of the day, and a weekly check-up for staff.
import { readFile } from 'node:fs/promises';
import { api, theGuild } from './discord.mjs';

const dayOfYear = () => Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
const channel = async (gid, name) => (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === name);

export async function daily() {
  const gid = await theGuild();
  const prompts = JSON.parse(await readFile('content/prompts.json', 'utf8'));
  const songs = JSON.parse(await readFile('content/songs.json', 'utf8'));
  const n = dayOfYear();
  const out = [];
  const p = await channel(gid, '📅・daily-prompts');
  if (p) {
    await api('POST', `/channels/${p.id}/messages`, { embeds: [{ title: '📅 Today\'s prompt', description: prompts[n % prompts.length], color: 0x7e9bd6 }], allowed_mentions: { parse: [] } });
    out.push('daily prompt');
  }
  const m = await channel(gid, '🎶・music');
  if (m) {
    const s = songs[n % songs.length];
    await api('POST', `/channels/${m.id}/messages`, { embeds: [{ title: '🎶 Song of the day', description: `**${s.title}** · ${s.artist}\n\nWhat's yours today? Drop it below ✨`, color: 0xae98dd }], allowed_mentions: { parse: [] } });
    out.push('song of the day');
  }
  return `Posted: ${out.join(', ') || 'nothing'}`;
}

export async function checkup() {
  const gid = await theGuild();
  const guild = await api('GET', `/guilds/${gid}?with_counts=true`);
  const roles = await api('GET', `/guilds/${gid}/roles`);
  const automod = await api('GET', `/guilds/${gid}/auto-moderation/rules`).catch(() => []);
  const admins = roles.filter((r) => (BigInt(r.permissions) & 8n) && !r.managed).map((r) => r.name);
  const lines = [
    `**Members:** ${guild.approximate_member_count} (${guild.approximate_presence_count} online now)`,
    `**Roles with full admin power:** ${admins.join(', ') || 'none'}`,
    `**AutoMod rules on:** ${automod.filter((r) => r.enabled).length}`,
    `**Backups:** saved nightly at 03:17 (see GitHub for history)`,
  ];
  const log = await channel(gid, '📋・assistant-log');
  if (log) await api('POST', `/channels/${log.id}/messages`, { embeds: [{ title: '🛡 Weekly check-up', description: lines.join('\n'), color: 0x2a4f8f, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
  return 'Weekly check-up posted';
}

export async function albumOfTheWeek() {
  const gid = await theGuild();
  const albums = JSON.parse(await readFile('content/bowie-albums.json', 'utf8'));
  const week = Math.floor(Date.now() / (7 * 86400000));
  const a = albums[week % albums.length];
  const ch = await channel(gid, '⚡・bowie-corner');
  if (!ch) return 'No Bowie corner';
  await api('POST', `/channels/${ch.id}/messages`, { embeds: [{ title: '⚡ Album of the week', description: `**${a.title}** (${a.year})\n\nFavourite track? First time you heard it? A memory it brings back? Share below ✨`, color: 0x16336b }], allowed_mentions: { parse: [] } });
  return `Album of the week: ${a.title}`;
}

export async function weeklyPoll() {
  const gid = await theGuild();
  const polls = JSON.parse(await readFile('content/polls.json', 'utf8'));
  const [a, b] = polls[Math.floor(Date.now() / (7 * 86400000)) % polls.length];
  const ch = await channel(gid, '💬・general');
  if (!ch) return 'No general channel';
  await api('POST', `/channels/${ch.id}/messages`, { poll: { question: { text: `This or that? ${a} or ${b}` }, answers: [{ poll_media: { text: a } }, { poll_media: { text: b } }], duration: 48, allow_multiselect: false }, allowed_mentions: { parse: [] } });
  return `Weekly poll: ${a} or ${b}`;
}
