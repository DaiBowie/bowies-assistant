// Read-only look round the server. Changes nothing in Discord.
// Privacy: no member names are stored (only counts), no chat messages are stored.
// Only Dai's own PDFs and pinned posts by Dai or by bots are kept, as setup context.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { api, theGuild, TYPES, VIEW_CHANNEL } from './discord.mjs';

const FIVEM = /five\s?-?m|gta|role\s?play|\brp\b|lspd|bcso|sast|\bems\b|\bfire\s?dept|\bcad\b|\bmdt\b|whitelist|civilian|dispatch/i;
const safe = (s) => String(s).normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'file';

export async function snapshot() {
  const gid = await theGuild();
  const guild = await api('GET', `/guilds/${gid}?with_counts=true`);
  const [channels, roles, emojis, stickers] = await Promise.all([
    api('GET', `/guilds/${gid}/channels`),
    api('GET', `/guilds/${gid}/roles`),
    api('GET', `/guilds/${gid}/emojis`),
    api('GET', `/guilds/${gid}/stickers`).catch(() => []),
  ]);
  const me = await api('GET', '/users/@me');
  const opt = (path) => api('GET', path).catch((e) => ({ unavailable: String(e.status || e.message) }));
  const [onboarding, welcome, verification, automod, webhooks, invites, integrations, events, threads, soundboard] = await Promise.all([
    opt(`/guilds/${gid}/onboarding`), opt(`/guilds/${gid}/welcome-screen`), opt(`/guilds/${gid}/member-verification?with_guild=false`),
    opt(`/guilds/${gid}/auto-moderation/rules`), opt(`/guilds/${gid}/webhooks`), opt(`/guilds/${gid}/invites`),
    opt(`/guilds/${gid}/integrations`), opt(`/guilds/${gid}/scheduled-events`), opt(`/guilds/${gid}/threads/active`), opt(`/guilds/${gid}/soundboard-sounds`),
  ]);

  // Members: counts only.
  const roleCount = {}; let humans = 0; const bots = []; let membersNote = null;
  for (let after = '0'; ;) {
    let page;
    try { page = await api('GET', `/guilds/${gid}/members?limit=1000&after=${after}`); }
    catch (e) {
      if (e.status !== 403) throw e;
      membersNote = 'Member list not available: the Server Members Intent looks switched off in the Developer Portal (Bot page). Counts below are Discord\'s approximate totals.';
      humans = guild.approximate_member_count ?? 0; break;
    }
    for (const m of page) {
      if (m.user.bot) bots.push({ name: m.user.username, id: m.user.id, roles: m.roles });
      else humans++;
      for (const r of m.roles) roleCount[r] = (roleCount[r] || 0) + 1;
    }
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }

  const hidden = (c) => (c.permission_overwrites || []).some((o) => o.id === gid && (BigInt(o.deny) & VIEW_CHANNEL));
  const byParent = {};
  for (const c of channels) {
    const key = c.parent_id || 'none';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(c);
  }
  for (const k in byParent) byParent[k].sort((a, b) => a.position - b.position);

  // Context: Dai's PDFs and pinned posts by Dai or bots, from text channels only (most recent 100 messages per channel).
  const pdfs = []; const pins = []; const unreadable = []; const counts = {};
  for (const c of channels.filter((c) => [0, 5].includes(c.type))) {
    const msgs = [];
    const deep = hidden(c) && /setup|blueprint|pdf|log|personal|core|memory|admin/i.test(`${c.name} ${channels.find((p) => p.id === c.parent_id)?.name || ''}`);
    try {
      for (let before = null, pages = 0; pages < (deep ? 20 : 1); pages++) {
        const page = await api('GET', `/channels/${c.id}/messages?limit=100${before ? `&before=${before}` : ''}`);
        msgs.push(...page); if (page.length < 100) break; before = page[page.length - 1].id;
      }
    } catch { if (!msgs.length) { unreadable.push(c.name); continue; } }
    counts[c.name] = { scanned: msgs.length, from_dai: msgs.filter((m) => m.author.id === guild.owner_id).length, with_attachments: msgs.filter((m) => m.attachments?.length).length, empty_content: msgs.filter((m) => !m.content && !m.attachments?.length && !m.embeds?.length).length };
    let pinned = [];
    try { pinned = await api('GET', `/channels/${c.id}/pins`); } catch {}
    for (const m of [...msgs, ...pinned]) {
      if (m.author.id !== guild.owner_id) continue;
      for (const a of m.attachments || []) {
        if (!(a.content_type?.includes('pdf') || /\.pdf$/i.test(a.filename))) continue;
        if (pdfs.some((p) => p.id === a.id)) continue;
        // Listed only. PDFs are never saved in GitHub (Dai, 10 Nov 2026: they live in his Drive).
        pdfs.push({ id: a.id, channel: c.name, file: a.filename, posted: m.timestamp });
      }
    }
    for (const m of pinned) {
      if (m.author.id !== guild.owner_id && !m.author.bot) continue;
      const embeds = (m.embeds || []).map((e) => [e.title, e.description, ...(e.fields || []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join('\n'));
      pins.push({ channel: c.name, by: m.author.id === guild.owner_id ? 'Dai' : `bot ${m.author.username}`, date: m.timestamp.slice(0, 10), text: [m.content, ...embeds].filter(Boolean).join('\n') });
    }
  }

  const roleName = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const data = {
    taken: new Date().toISOString(),
    server: { id: gid, name: guild.name, description: guild.description, members: humans, bots: bots.length, boosts: guild.premium_subscription_count, boost_tier: guild.premium_tier, verification_level: guild.verification_level, features: guild.features, has_icon: !!guild.icon, has_banner: !!guild.banner, rules_channel: guild.rules_channel_id, system_channel: guild.system_channel_id },
    me: { id: me.id, name: me.username },
    roles: roles.sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, colour: r.color ? '#' + r.color.toString(16).padStart(6, '0').toUpperCase() : null, position: r.position, hoist: r.hoist, mentionable: r.mentionable, managed: r.managed, admin: !!(BigInt(r.permissions) & 8n), permissions: r.permissions, members: r.id === gid ? humans + bots.length : roleCount[r.id] || 0 })),
    channels: channels.map((c) => ({ id: c.id, name: c.name, type: TYPES[c.type] || c.type, parent: c.parent_id, position: c.position, topic: c.topic || null, nsfw: !!c.nsfw, slowmode: c.rate_limit_per_user || 0, hidden_from_everyone: hidden(c), overwrites: (c.permission_overwrites || []).map((o) => ({ who: o.type === 0 ? `role:${roleName[o.id] || o.id}` : `member:${o.id}`, allow: o.allow, deny: o.deny })), possibly_fivem: FIVEM.test(`${c.name} ${c.topic || ''}`) })),
    bots: bots.map((b) => ({ name: b.name, id: b.id, roles: b.roles.map((r) => roleName[r] || r) })),
    emojis: emojis.map((e) => e.name), stickers: stickers.map((s) => s.name),
    unreadable_channels: unreadable, pdfs, pins_kept: pins.length, members_note: membersNote, message_counts: counts,
    settings: {
      onboarding: onboarding.unavailable ? onboarding : { enabled: onboarding.enabled, mode: onboarding.mode, default_channels: (onboarding.default_channel_ids || []).map((id) => channels.find((c) => c.id === id)?.name || id), prompts: (onboarding.prompts || []).map((p) => ({ title: p.title, options: p.options.map((o) => ({ title: o.title, description: o.description, roles: (o.role_ids || []).map((r) => roleName[r] || r), channels: (o.channel_ids || []).map((id) => channels.find((c) => c.id === id)?.name || id) })) })) },
      welcome_screen: welcome.unavailable ? welcome : { description: welcome.description, channels: (welcome.welcome_channels || []).map((w) => ({ channel: channels.find((c) => c.id === w.channel_id)?.name, description: w.description })) },
      rules_screening: verification.unavailable ? verification : { description: verification.description, fields: (verification.form_fields || []).map((f) => ({ type: f.field_type, label: f.label, values: f.values })) },
      automod: Array.isArray(automod) ? automod.map((r) => ({ name: r.name, enabled: r.enabled, trigger: r.trigger_type, keywords: (r.trigger_metadata?.keyword_filter || []).length, presets: r.trigger_metadata?.presets, actions: r.actions.map((a) => a.type) })) : automod,
      webhooks: Array.isArray(webhooks) ? webhooks.map((w) => ({ name: w.name, channel: channels.find((c) => c.id === w.channel_id)?.name, type: w.type })) : webhooks,
      invites: Array.isArray(invites) ? invites.map((i) => ({ channel: i.channel?.name, uses: i.uses, max_uses: i.max_uses, expires: i.expires_at, temporary: i.temporary })) : invites,
      integrations: Array.isArray(integrations) ? integrations.map((i) => ({ name: i.name, type: i.type, enabled: i.enabled })) : integrations,
      scheduled_events: Array.isArray(events) ? events.map((e) => ({ name: e.name, start: e.scheduled_start_time })) : events,
      active_threads: threads.threads ? threads.threads.map((t) => ({ name: t.name, parent: channels.find((c) => c.id === t.parent_id)?.name })) : threads,
      soundboard: soundboard.items ? soundboard.items.map((x) => x.name) : soundboard,
    },
  };

  // Current look: server icon, emojis and stickers (public artwork only).
  await rm('context/look', { recursive: true, force: true }); await mkdir('context/look', { recursive: true });
  const grab = async (url, file) => { const r = await fetch(url); if (r.ok) await writeFile(`context/look/${file}`, Buffer.from(await r.arrayBuffer())); };
  if (guild.icon) await grab(`https://cdn.discordapp.com/icons/${gid}/${guild.icon}.png?size=1024`, 'server-icon.png');
  if (guild.splash) await grab(`https://cdn.discordapp.com/splashes/${gid}/${guild.splash}.png?size=1024`, 'invite-splash.png');
  for (const e of emojis) await grab(`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=256`, `emoji-${safe(e.name)}.${e.animated ? 'gif' : 'png'}`);
  for (const st of stickers) if (st.format_type !== 3) await grab(`https://media.discordapp.net/stickers/${st.id}.png?size=320`, `sticker-${safe(st.name)}.png`);

  // Readable version.
  const L = [];
  L.push(`# ${guild.name} – snapshot`, '', `Taken ${data.taken.slice(0, 16).replace('T', ' ')} UTC. Read-only: nothing in Discord was changed.`, '');
  L.push(`**Members:** ${humans} people, ${bots.length} bots · **Boosts:** ${guild.premium_subscription_count ?? 0} (tier ${guild.premium_tier}) · **Roles:** ${roles.length} · **Channels:** ${channels.length} · **Emojis:** ${emojis.length}`, '');
  if (membersNote) L.push(`> ${membersNote}`, '');
  L.push('## Channels', '');
  const line = (c) => `${c.type === 4 ? '###' : '-'} ${c.type === 4 ? '' : `[${TYPES[c.type] || c.type}] `}${c.name}${hidden(c) ? ' 🔒' : ''}${FIVEM.test(`${c.name} ${c.topic || ''}`) ? ' ⚠️ possibly FiveM' : ''}${c.topic ? ` – _${c.topic.replace(/\n/g, ' ').slice(0, 140)}_` : ''}`;
  for (const c of byParent.none || []) {
    if (c.type === 4) { L.push('', line(c)); for (const k of byParent[c.id] || []) L.push(line(k)); }
    else L.push(line(c));
  }
  L.push('', '## Roles (top to bottom)', '');
  for (const r of data.roles) L.push(`- ${r.name}${r.colour ? ` (${r.colour})` : ''} – ${r.members}${r.admin ? ' · admin' : ''}${r.managed ? ' · bot-managed' : ''}${r.hoist ? ' · shown separately' : ''}${FIVEM.test(r.name) ? ' ⚠️ possibly FiveM' : ''}`);
  L.push('', '## Other bots', '', ...(data.bots.length ? data.bots.map((b) => `- ${b.name}`) : ['- none']));
  L.push('', '## Setup context found', '', `- PDFs posted by Dai: ${pdfs.length}`, ...pdfs.map((p) => `  - #${p.channel}: ${p.file.split('/').pop()}`), `- Pinned posts by Dai or bots kept: ${pins.length}`);
  if (unreadable.length) L.push(`- Channels the assistant can't read: ${unreadable.join(', ')}`);
  L.push('', '⚠️ marks are a keyword guess only. Nothing has been deleted or changed.');

  await mkdir('reports', { recursive: true });
  await writeFile('reports/snapshot.json', JSON.stringify(data, null, 2));
  await writeFile('reports/snapshot.md', L.join('\n') + '\n');
  await mkdir('context', { recursive: true });
  await writeFile('context/pins.md', pins.map((p) => `## #${p.channel} · ${p.by} · ${p.date}\n\n${p.text}\n`).join('\n') || 'No pinned posts by Dai or bots.\n');
  return `Snapshot taken: ${channels.length} channels, ${roles.length} roles, ${pdfs.length} PDFs.`;
}
