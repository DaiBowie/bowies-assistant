// Leafvella news: checks the public Leafvella news feed and posts anything new in 📢・updates, in Leafvella's own look.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { api, theGuild } from './discord.mjs';

const FEED = 'https://leafvella.daibowie.workers.dev/feed.xml';
const ICON = 'https://leafvella.daibowie.workers.dev/assets/brand/icon-512.png';
const STATE = 'state/leafvella-feed.json';

const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || '';
const decodeXml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export async function leafvellaNews() {
  const res = await fetch(FEED);
  if (!res.ok) return `Leafvella feed not reachable (${res.status})`;
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({
    id: tag(m[1], 'id'), title: decodeXml(tag(m[1], 'title')), summary: decodeXml(tag(m[1], 'summary')),
    link: (m[1].match(/<link[^>]*href="([^"]+)"/) || [])[1], updated: tag(m[1], 'updated'),
  })).sort((a, b) => a.updated.localeCompare(b.updated));
  const seen = JSON.parse(await readFile(STATE, 'utf8').catch(() => '[]'));
  const fresh = entries.filter((e) => !seen.includes(e.id));
  if (!fresh.length) return 'Leafvella news: nothing new';
  const gid = await theGuild();
  const ch = (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === '📢・updates');
  if (!ch) return 'Leafvella news: no updates channel';
  for (const e of fresh) {
    await api('POST', `/channels/${ch.id}/messages`, {
      embeds: [{ title: `🌿 ${e.title}`, description: `${e.summary}\n\n[Read more](${e.link})`, url: e.link, color: 0x247b47, thumbnail: { url: ICON }, footer: { text: 'Leafvella news' }, timestamp: e.updated || undefined }],
      allowed_mentions: { parse: [] },
    });
    seen.push(e.id);
  }
  await mkdir('state', { recursive: true });
  await writeFile(STATE, JSON.stringify(seen, null, 2) + '\n');
  return `Leafvella news: posted ${fresh.length}`;
}
