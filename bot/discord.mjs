// Small Discord REST (v10) helper. No libraries, no gateway: every run starts, does its job and stops.
// The token only ever comes from the DISCORD_TOKEN secret and is never printed or written anywhere.

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_TOKEN;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @param {{ reason?: string, raw?: boolean }} [options]
 */
export async function api(method, path, body, { reason, raw } = {}) {
  if (!TOKEN) throw new Error('DISCORD_TOKEN is missing (add it under Settings > Secrets and variables > Actions)');
  for (let attempt = 0; attempt < 8; attempt++) {
    const headers = {
      Authorization: `Bot ${TOKEN}`,
      'User-Agent': 'BowiesAssistant (https://github.com/DaiBowie/bowies-assistant, 1.0)',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason).slice(0, 512);
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 150);
      continue;
    }
    if (res.status >= 500 && attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetAfter = res.headers.get('x-ratelimit-reset-after');
    if (remaining === '0' && resetAfter) await sleep(Math.ceil(parseFloat(resetAfter) * 1000) + 50);
    if (raw) return res;
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`), { status: res.status });
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path} -> still rate limited after several tries`);
}

// The bot lives in exactly one server: Bowie's Workspace.
export async function theGuild() {
  const guilds = await api('GET', '/users/@me/guilds');
  if (guilds.length !== 1) throw new Error(`Expected to be in exactly one server, found ${guilds.length}`);
  return guilds[0].id;
}

export const TYPES = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum', 16: 'media' };
export const VIEW_CHANNEL = 1n << 10n;

/**
 * Posts a message with image files (from this repository) attached.
 * @param {string} channelId
 * @param {Record<string, unknown>} payload
 * @param {string[]} paths
 */
export async function postWithFiles(channelId, payload, paths, messageId = null) {
  if (!TOKEN) throw new Error('DISCORD_TOKEN is missing');
  const { readFile } = await import('node:fs/promises');
  const form = new FormData();
  const attachments = paths.map((p, id) => ({ id, filename: p.split('/').pop(), description: altText(p) }));
  form.append('payload_json', JSON.stringify({ ...payload, attachments }));
  const types = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', mp4: 'video/mp4', pdf: 'application/pdf' };
  for (const [id, p] of paths.entries()) {
    const data = p.startsWith('https://') ? Buffer.from(await (await fetch(p)).arrayBuffer()) : await readFile(p);
    form.append(`files[${id}]`, new Blob([data], { type: types[p.split('.').pop()] || 'application/octet-stream' }), p.split('/').pop());
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}/channels/${channelId}/messages${messageId ? `/${messageId}` : ''}`, { method: messageId ? 'PATCH' : 'POST', headers: { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'BowiesAssistant (https://github.com/DaiBowie/bowies-assistant, 1.0)' }, body: form });
    if (res.status === 429) { const j = await res.json().catch(() => ({})); await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 150); continue; }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`POST message with files -> ${res.status} ${text.slice(0, 300)}`), { status: res.status });
    return JSON.parse(text);
  }
  throw new Error('still rate limited after several tries');
}

// Alt text, so screen readers describe every image the bot posts.
const ALT = {
  welcome: 'Banner: Welcome to Bowie\'s Workspace & Dev Server, on a twilight galaxy sky with a Leafvella twig',
  rules: 'Banner: The rules. Kind, safe and fun for everyone',
  announcements: 'Banner: Announcements, news from Dai and the server',
  staff: 'Banner: Staff, keeping the workspace safe',
  personal: 'Banner: Personal, just for Dai and Wolf',
  community: 'Banner: Community, chat, share and hang out',
  bowie: 'Banner: Bowie, for the love of Bowie, with lightning bolts and stars',
  workspace: 'Banner: Dai\'s Workspace, what I\'m building',
  assistant: 'Banner: Bowie\'s Assistant, ask me anything about the server',
  daily: 'Banner: Daily prompts, something new to think about every day',
  resources: 'Banner: Resources, useful links in one place',
  streaming: 'Banner: Streaming, go live, share clips, cheer each other on',
  'lv-start': 'Leafvella banner: the Leafvella app icon and the words Leafvella, a calm, private space for your day',
  'lv-updates': 'Leafvella banner: Updates, new versions and Leafvella news',
  'lv-showcase': 'Leafvella banner: Showcase, screens, clips and films',
  'lv-ideas': 'Leafvella banner: Ideas, your ideas and feedback, all welcome',
  'lv-testing': 'Leafvella banner: Testing, thank you for helping make Leafvella better',
  'lv-guide': 'Leafvella banner: Tester guide, everything you need to test Leafvella',
  'lv-reports': 'Leafvella banner: Tester reports',
};
export function altText(p) {
  const name = p.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  if (ALT[name]) return ALT[name];
  if (/^(light|dark)-/.test(name)) return `Leafvella demo app screen: ${name.replace(/^(light|dark)-/, '').replace(/-/g, ' ')}, ${name.startsWith('dark') ? 'dark' : 'light'} mode, made-up example data`;
  if (name.endsWith('.gif') || /leafvella-(welcome|tour)/.test(name)) return 'Short looping clip from a Leafvella film showing the demo app';
  if (/film|tour/.test(name)) return 'Leafvella film showing the demo app, with captions on the films page';
  if (/progress|update/i.test(name)) return 'Leafvella progress card: where things are and what is coming next';
  return name.replace(/[-_]/g, ' ');
}

/** Uploads a server sticker (PNG, 320x320). */
export async function createSticker(gid, { name, description, tags, file }) {
  const { readFile } = await import('node:fs/promises');
  const form = new FormData();
  form.append('name', name); form.append('description', description || ''); form.append('tags', tags);
  form.append('file', new Blob([await readFile(file)], { type: 'image/png' }), file.split('/').pop());
  const res = await fetch(`${API}/guilds/${gid}/stickers`, { method: 'POST', headers: { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'BowiesAssistant (https://github.com/DaiBowie/bowies-assistant, 1.0)' }, body: form });
  if (!res.ok) throw Object.assign(new Error(`sticker ${name} -> ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return res.json();
}
