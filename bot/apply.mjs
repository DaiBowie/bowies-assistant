// Carries out a list of changes in Discord, one step at a time, and stops at the first problem.
// Request shape: { "action": "apply", "steps": [ { "op": "...", ... } ], "approved_by": "Dai" | "Wolf" }
// Anything that deletes needs approved_by on the request (Dai or Wolf said yes to that exact item).

import { api, theGuild, postWithFiles, createSticker } from './discord.mjs';
import { bits } from './perms.mjs';
import { lockdown, unlock } from './security.mjs';

const hex = (c) => (c ? parseInt(String(c).replace('#', ''), 16) : 0);

export async function status() {
  const gid = await theGuild();
  const app = await api('GET', '/applications/@me');
  const roles = await api('GET', `/guilds/${gid}/roles`);
  const me = await api('GET', `/guilds/${gid}/members/${app.bot?.id || app.id}`).catch(() => null);
  const flags = BigInt(app.flags || 0);
  const membersIntent = !!(flags & ((1n << 14n) | (1n << 15n)));
  const contentIntent = !!(flags & ((1n << 18n) | (1n << 19n)));
  const sorted = roles.sort((a, b) => b.position - a.position);
  const mine = me ? sorted.find((r) => me.roles.includes(r.id)) : null;
  const above = mine ? sorted.filter((r) => r.position > mine.position).map((r) => r.name) : [];
  return [
    `Server Members Intent: ${membersIntent ? 'on' : 'OFF'}`,
    `Message Content Intent: ${contentIntent ? 'on' : 'OFF'}`,
    `Public bot: ${app.bot_public ? 'yes' : 'no'}`,
    `My top role: ${mine ? `${mine.name} (${mine.color ? '#' + mine.color.toString(16).padStart(6, '0').toUpperCase() : 'no colour'}, shown separately: ${mine.hoist ? 'yes' : 'no'})` : 'none'}`,
    `Roles above mine: ${above.length ? above.join(', ') : 'none'}`,
  ].join(' · ');
}

export async function apply(req) {
  const gid = await theGuild();
  const done = [];
  try {
  for (const [i, s] of (req.steps || []).entries()) {
    const roles = await api('GET', `/guilds/${gid}/roles`);
    const role = (name) => {
      const r = roles.find((x) => x.name === name);
      if (!r) throw new Error(`step ${i + 1}: no role called "${name}"`);
      return r;
    };
    const why = `${req.asked_by || 'Dai'} asked: ${req.note || s.op}`;
    if (s.op === 'delete_role') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: deleting needs approved_by Dai or Wolf`);
      const r = role(s.name);
      if (r.managed) throw new Error(`step ${i + 1}: "${s.name}" belongs to an app and can't be deleted`);
      await api('DELETE', `/guilds/${gid}/roles/${r.id}`, undefined, { reason: why });
      done.push(`deleted role ${s.name}`);
    } else if (s.op === 'edit_role') {
      const r = role(s.name);
      const body = {};
      if (s.new_name) body.name = s.new_name;
      if (s.colour !== undefined) body.color = hex(s.colour);
      if (s.hoist !== undefined) body.hoist = s.hoist;
      if (s.mentionable !== undefined) body.mentionable = s.mentionable;
      if (s.permissions) body.permissions = bits(s.permissions);
      await api('PATCH', `/guilds/${gid}/roles/${r.id}`, body, { reason: why });
      done.push(`updated role ${s.name}`);
    } else if (s.op === 'create_role') {
      if (roles.some((x) => x.name === s.name)) { done.push(`role ${s.name} already there`); continue; }
      const r = await api('POST', `/guilds/${gid}/roles`, { name: s.name, color: hex(s.colour), hoist: !!s.hoist, mentionable: !!s.mentionable, permissions: bits(s.permissions) }, { reason: why });
      if (s.below) {
        const fresh = (await api('GET', `/guilds/${gid}/roles`)).sort((a, b) => b.position - a.position).filter((x) => x.id !== r.id && x.id !== gid);
        const at = fresh.findIndex((x) => x.name === s.below);
        if (at < 0) throw new Error(`step ${i + 1}: no role called "${s.below}" to go under`);
        fresh.splice(at + 1, 0, r);
        const order = fresh.slice().reverse().map((x, n) => ({ id: x.id, position: n + 1 }));
        await api('PATCH', `/guilds/${gid}/roles`, order, { reason: why });
      }
      done.push(`created role ${s.name}`);
    } else if (s.op === 'give_role') {
      const r = role(s.role);
      const m = await api('GET', `/guilds/${gid}/members/${s.user_id}`).catch(() => null);
      if (!m) throw new Error(`step ${i + 1}: that member isn't in the server`);
      await api('PUT', `/guilds/${gid}/members/${s.user_id}/roles/${r.id}`, undefined, { reason: why });
      done.push(`gave ${s.role} to ${s.who || 'the member'}`);
    } else if (s.op === 'give_role_by_name') {
      const r = (await api('GET', `/guilds/${gid}/roles`)).find((x) => x.name === s.role);
      if (!r) throw new Error(`step ${i + 1}: no role called "${s.role}"`);
      const norm = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const members = [];
      for (let after = '0'; ;) {
        const page = await api('GET', `/guilds/${gid}/members?limit=1000&after=${after}`);
        members.push(...page);
        if (page.length < 1000) break;
        after = page[page.length - 1].user.id;
      }
      const found = []; const missing = []; const unsure = [];
      // The repo is public, so requests carry SHA-256 hashes of the normalised names, never the names (name_hashes).
      const { createHash } = await import('node:crypto');
      const hash = (x) => createHash('sha256').update(norm(x)).digest('hex');
      const keys = [...(s.names || []).map((n) => ({ label: n, eq: (x) => norm(x) === norm(n), sw: (x) => norm(x).startsWith(norm(n)) })),
        ...(s.name_hashes || []).map((h, k) => ({ label: `person ${k + 1}`, eq: (x) => !!x && hash(x) === h, sw: () => false }))];
      for (const key of keys) {
        const fields = (m) => [m.user.username, m.user.global_name, m.nick];
        let hits = members.filter((m) => fields(m).some(key.eq));
        if (!hits.length) hits = members.filter((m) => fields(m).some(key.sw));
        if (hits.length === 1) { await api('PUT', `/guilds/${gid}/members/${hits[0].user.id}/roles/${r.id}`, undefined, { reason: why }); found.push(key.label); }
        else if (hits.length > 1) unsure.push(key.label);
        else missing.push(key.label);
      }
      done.push(`${s.role} given to ${found.length} of ${keys.length}${missing.length ? `; not found in the server: ${missing.join(', ')}` : ''}${unsure.length ? `; more than one match: ${unsure.join(', ')}` : ''}`);
    } else if (s.op === 'edit_channel_by_name') {
      const c = (await api('GET', `/guilds/${gid}/channels`)).find((x) => x.name === s.name);
      if (!c) throw new Error(`step ${i + 1}: no channel called "${s.name}"`);
      const fresh = await api('GET', `/guilds/${gid}/roles`);
      const body = {};
      if (s.overwrites) {
        body.permission_overwrites = s.overwrites.map((o) => ({ id: o.role === '@everyone' ? gid : fresh.find((x) => x.name === o.role)?.id, type: 0, allow: bits(o.allow), deny: bits(o.deny) }));
        if (body.permission_overwrites.some((o) => !o.id)) throw new Error(`step ${i + 1}: a role in the overwrites doesn't exist`);
      }
      if (s.position !== undefined) body.position = s.position;
      await api('PATCH', `/channels/${c.id}`, body, { reason: why });
      done.push(`updated ${s.name}`);
    } else if (s.op === 'edit_channel') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const c = channels.find((x) => x.id === s.id);
      if (!c) throw new Error(`step ${i + 1}: channel ${s.id} not found`);
      const body = {};
      if (s.new_name) body.name = s.new_name;
      if (s.topic !== undefined) body.topic = s.topic;
      if (s.parent_name) s.parent = channels.find((x) => x.type === 4 && x.name === s.parent_name)?.id;
      if (s.parent !== undefined) body.parent_id = s.parent;
      if (s.position !== undefined) body.position = s.position;
      if (s.bitrate) body.bitrate = s.bitrate;
      if (s.user_limit !== undefined) body.user_limit = s.user_limit;
      if (s.sync) {
        const parent = channels.find((x) => x.id === (s.parent ?? c.parent_id));
        if (!parent && s.parent_name) throw new Error(`step ${i + 1}: no zone called "${s.parent_name}"`);
        if (!parent) throw new Error(`step ${i + 1}: nothing to sync with`);
        body.permission_overwrites = parent.permission_overwrites;
      }
      if (s.overwrites) {
        body.permission_overwrites = s.overwrites.map((o) => {
          const r = o.role === '@everyone' ? { id: gid } : role(o.role);
          return { id: r.id, type: 0, allow: bits(o.allow), deny: bits(o.deny) };
        });
      }
      try {
        await api('PATCH', `/channels/${s.id}`, body, { reason: why });
        done.push(`updated ${s.new_name || c.name}`);
      } catch (e) {
        if (!s.soft) throw e;
        done.push(`left ${c.name} as it is (${String(e.message).match(/"message": "([^"]+)"/)?.[1] || 'Discord refused'})`);
      }
    } else if (s.op === 'create_channel') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const exists = channels.find((x) => x.name === s.name);
      if (exists) { done.push(`${s.name} already there`); continue; }
      const type = { text: 0, voice: 2, category: 4, announcement: 5, forum: 15 }[s.type || 'text'];
      const parentId = s.parent || (s.parent_name ? channels.find((x) => x.type === 4 && x.name === s.parent_name)?.id : null);
      const parent = channels.find((x) => x.id === parentId);
      const body = { name: s.name, type, parent_id: parentId || null, topic: s.topic, permission_overwrites: parent?.permission_overwrites || [] };
      if (s.slowmode) body.rate_limit_per_user = s.slowmode;
      if (s.tags) body.available_tags = s.tags.map((t) => ({ name: t.name, emoji_name: t.emoji || null, moderated: false }));
      if (s.guidelines && type === 15) body.topic = s.guidelines;
      if (s.overwrites) {
        body.permission_overwrites = s.overwrites.map((o) => {
          const r = o.role === '@everyone' ? { id: gid } : role(o.role);
          return { id: r.id, type: 0, allow: bits(o.allow), deny: bits(o.deny) };
        });
      }
      if (s.position !== undefined) body.position = s.position;
      await api('POST', `/guilds/${gid}/channels`, body, { reason: why });
      done.push(`created ${s.name}`);
    } else if (s.op === 'send_message') {
      if (!s.channel_id && s.channel) {
        const c = (await api('GET', `/guilds/${gid}/channels`)).find((x) => x.name === s.channel);
        if (!c) throw new Error(`step ${i + 1}: no channel called "${s.channel}"`);
        s.channel_id = c.id; s.channel_label = s.channel;
      }
      const all = await api('GET', `/guilds/${gid}/channels`);
      const link = (t) => t && t.replace(/\{#([^}]+)\}/g, (_, n) => { const c = all.find((x) => x.name === n); return c ? `<#${c.id}>` : n; });
      if (s.embed) { s.embed.description = link(s.embed.description); }
      s.content = link(s.content);
      /** @type {any} */
      const body = { content: s.content || undefined, allowed_mentions: { parse: s.ping_everyone ? ['everyone'] : [] } };
      if (s.ping_role) {
        const pr = (await api('GET', `/guilds/${gid}/roles`)).find((x) => x.name === s.ping_role);
        if (!pr) throw new Error(`step ${i + 1}: no role called "${s.ping_role}" to ping`);
        body.content = `<@&${pr.id}> ${body.content || ''}`.trim();
        body.allowed_mentions = { parse: [], roles: [pr.id] };
      }
      if (s.embed) body.embeds = [{ title: s.embed.title, description: s.embed.description, color: hex(s.embed.colour || '#2A4F8F'), footer: s.embed.footer ? { text: s.embed.footer } : undefined }];
      if (s.banner_only) { body.embeds = undefined; }
      if (s.embed?.image) body.embeds[0].image = { url: `attachment://${s.embed.image.split('/').pop()}` };
      const files = [...(s.files || []), ...(s.embed?.image ? [s.embed.image] : [])];
      const msg = files.length ? await postWithFiles(s.channel_id, body, files) : await api('POST', `/channels/${s.channel_id}/messages`, body);
      if (s.pin) await api('PUT', `/channels/${s.channel_id}/messages/pins/${msg.id}`, undefined, { reason: why }).catch(() => api('PUT', `/channels/${s.channel_id}/pins/${msg.id}`, undefined, { reason: why }));
      done.push(`posted in ${s.channel_label || s.channel_id}`);
    } else if (s.op === 'onboarding') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const ch = (name) => {
        const c = channels.find((x) => x.name === name);
        if (!c) throw new Error(`step ${i + 1}: no channel called "${name}"`);
        return c.id;
      };
      let seq = 0n;
      const fresh = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + seq++);
      const body = {
        enabled: s.enabled !== false,
        mode: s.mode ?? 0,
        default_channel_ids: s.default_channels.map(ch),
        prompts: (s.prompts || []).map((p) => ({
          id: fresh(), type: 0, title: p.title, single_select: !!p.single_select, required: !!p.required, in_onboarding: true,
          options: p.options.map((o) => ({ id: fresh(), title: o.title, description: o.description || '', emoji_name: o.emoji || undefined, channel_ids: (o.channels || []).map(ch), role_ids: (o.roles || []).map((n) => role(n).id) })),
        })),
      };
      await api('PUT', `/guilds/${gid}/onboarding`, body, { reason: why });
      done.push('updated onboarding');
    } else if (s.op === 'automod') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const alert = channels.find((x) => x.name === s.alert_channel);
      if (!alert) throw new Error(`step ${i + 1}: no channel called "${s.alert_channel}"`);
      const existing = await api('GET', `/guilds/${gid}/auto-moderation/rules`);
      for (const r of s.rules) {
        /** @type {{ type: number, metadata: Record<string, unknown> }[]} */
        const actions = [];
        if (r.trigger_type === 6) actions.push({ type: 4, metadata: {} });
        else if (!r.alert_only) actions.push({ type: 1, metadata: { custom_message: r.message || 'Bowie\'s Assistant blocked this to keep the server safe.' } });
        actions.push({ type: 2, metadata: { channel_id: alert.id } });
        if (r.timeout_seconds) actions.push({ type: 3, metadata: { duration_seconds: r.timeout_seconds } });
        const exemptChannels = (r.exempt_channels || []).map((n) => channels.find((x) => x.name === n)?.id).filter(Boolean);
        const body = { name: r.name, event_type: r.trigger_type === 6 ? 2 : 1, trigger_type: r.trigger_type, trigger_metadata: r.trigger_metadata || {}, actions, enabled: true, exempt_roles: (r.exempt_roles || []).map((n) => role(n).id), exempt_channels: exemptChannels };
        const same = existing.find((x) => x.name === r.name || (r.replaces && x.name === r.replaces) || (r.trigger_type !== 1 && x.trigger_type === r.trigger_type));
        try {
          if (same) { delete body.trigger_type; await api('PATCH', `/guilds/${gid}/auto-moderation/rules/${same.id}`, body, { reason: why }); }
          else await api('POST', `/guilds/${gid}/auto-moderation/rules`, body, { reason: why });
          done.push(`AutoMod: ${r.name}`);
        } catch (e) {
          done.push(`AutoMod: ${r.name} left as it is (${String(e.message).slice(0, 160)})`);
        }
      }
    } else if (s.op === 'delete_automod_rule') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: deleting needs approved_by Dai or Wolf`);
      const existing = await api('GET', `/guilds/${gid}/auto-moderation/rules`);
      const r = existing.find((x) => x.name === s.name);
      if (r) {
        try { await api('DELETE', `/guilds/${gid}/auto-moderation/rules/${r.id}`, undefined, { reason: why }); done.push(`removed AutoMod rule ${s.name}`); }
        catch (e) { done.push(`couldn't remove ${s.name} (${e.status}): Discord only lets the owner change it`); }
      }
      else done.push(`no AutoMod rule called ${s.name}`);
    } else if (s.op === 'lockdown' || s.op === 'unlock') {
      done.push(s.op === 'lockdown' ? await lockdown(gid, why, s) : await unlock(gid, why));
    } else if (s.op === 'delete_my_old_posts') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: deleting needs approved_by Dai or Wolf`);
      const guild = await api('GET', `/guilds/${gid}`);
      const c = (await api('GET', `/guilds/${gid}/channels`)).find((x) => x.name === s.channel);
      if (!c) throw new Error(`step ${i + 1}: no channel called "${s.channel}"`);
      const msgs = await api('GET', `/channels/${c.id}/messages?limit=100`);
      const match = (m) => m.author.id === guild.owner_id && (!s.containing || s.containing.some((t) => (m.content || '').includes(t) || (m.attachments || []).some((a) => a.filename.includes(t))));
      let n = 0;
      for (const m of msgs.filter(match)) { await api('DELETE', `/channels/${c.id}/messages/${m.id}`, undefined, { reason: why }); n++; }
      done.push(`deleted ${n} old post(s) by Dai in ${s.channel}`);
    } else if (s.op === 'delete_webhook') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: deleting needs approved_by Dai or Wolf`);
      const hooks = await api('GET', `/guilds/${gid}/webhooks`);
      const h = hooks.filter((x) => x.name === s.name);
      for (const x of h) await api('DELETE', `/webhooks/${x.id}`, undefined, { reason: why });
      done.push(`deleted ${h.length} webhook(s) called ${s.name}`);
    } else if (s.op === 'remove_member_overrides') {
      const c = (await api('GET', `/guilds/${gid}/channels`)).find((x) => x.name === s.channel);
      if (!c) throw new Error(`step ${i + 1}: no channel called "${s.channel}"`);
      const before = c.permission_overwrites.length;
      const ow = c.permission_overwrites.filter((o) => o.type !== 1);
      await api('PATCH', `/channels/${c.id}`, { permission_overwrites: ow }, { reason: why });
      done.push(`removed ${before - ow.length} personal access override(s) from ${s.channel}`);
    } else if (s.op === 'sticker') {
      const have = await api('GET', `/guilds/${gid}/stickers`);
      if (have.some((x) => x.name === s.name)) done.push(`sticker ${s.name} already there`);
      else { await createSticker(gid, s); done.push(`sticker ${s.name}`); }
    } else if (s.op === 'my_server_profile') {
      await api('PATCH', `/guilds/${gid}/members/@me`, { bio: s.bio, nick: s.nick || null }, { reason: why }).catch((e) => done.push(`profile not changed (${e.status})`));
      done.push('updated my server profile');
    } else if (s.op === 'stats_channel') {
      const chans = await api('GET', `/guilds/${gid}/channels`);
      if (!chans.some((x) => x.name.startsWith('👥'))) {
        const parent = chans.find((x) => x.type === 4 && x.name === s.parent_name);
        const g = await api('GET', `/guilds/${gid}?with_counts=true`);
        await api('POST', `/guilds/${gid}/channels`, { name: `👥 Members: ${g.approximate_member_count}`, type: 2, parent_id: parent?.id, position: 0, permission_overwrites: [{ id: gid, type: 0, allow: bits(['View channel']), deny: bits(['Connect']) }] }, { reason: why });
      }
      done.push('member count channel ready');
    } else if (s.op === 'server_settings') {
      const body = {};
      if (s.description !== undefined) body.description = s.description;
      if (s.name) body.name = s.name;
      if (s.icon) { const { readFile } = await import('node:fs/promises'); body.icon = `data:image/png;base64,${(await readFile(s.icon)).toString('base64')}`; }
      if (s.explicit_content_filter !== undefined) body.explicit_content_filter = s.explicit_content_filter;
      if (s.verification_level !== undefined) body.verification_level = s.verification_level;
      if (s.default_message_notifications !== undefined) body.default_message_notifications = s.default_message_notifications;
      await api('PATCH', `/guilds/${gid}`, body, { reason: why });
      done.push('updated server settings');
    } else if (s.op === 'rules_screening') {
      await api('PATCH', `/guilds/${gid}/member-verification`, { enabled: true, description: s.description || null, form_fields: [{ field_type: 'TERMS', label: 'Read and agree to the server rules', values: s.rules, required: true }, ...(s.question ? [{ field_type: 'TEXT_INPUT', label: s.question, required: true, placeholder: null }] : [])] }, { reason: why });
      done.push('updated the rules new members agree to');
    } else if (s.op === 'emoji') {
      const { readFile } = await import('node:fs/promises');
      const image = `data:image/png;base64,${(await readFile(s.image)).toString('base64')}`;
      if (s.app) {
        const app = await api('GET', '/applications/@me');
        const have = (await api('GET', `/applications/${app.id}/emojis`)).items || [];
        if (!have.some((x) => x.name === s.name)) await api('POST', `/applications/${app.id}/emojis`, { name: s.name, image });
      } else {
        const have = await api('GET', `/guilds/${gid}/emojis`);
        if (!have.some((x) => x.name === s.name)) await api('POST', `/guilds/${gid}/emojis`, { name: s.name, image }, { reason: why });
      }
      done.push(`emoji :${s.name}:`);
    } else if (s.op === 'edit_post') {
      const app = await api('GET', '/applications/@me');
      const c = (await api('GET', `/guilds/${gid}/channels`)).find((x) => x.name === s.channel);
      if (!c) throw new Error(`step ${i + 1}: no channel called "${s.channel}"`);
      const msgs = await api('GET', `/channels/${c.id}/messages?limit=50`);
      const m = msgs.find((x) => x.author.id === app.id && x.embeds?.[0]?.title === s.title);
      if (!m) throw new Error(`step ${i + 1}: couldn't find my post "${s.title}" in ${s.channel}`);
      const e = m.embeds[0];
      const all = await api('GET', `/guilds/${gid}/channels`);
      if (s.description) s.description = s.description.replace(/\{#([^}]+)\}/g, (_, n) => { const ch = all.find((x) => x.name === n); return ch ? `<#${ch.id}>` : n; });
      const embed = { title: s.new_title || e.title, description: s.description || e.description, color: s.colour ? hex(s.colour) : e.color, footer: s.footer ? { text: s.footer } : e.footer, image: { url: `attachment://${s.image.split('/').pop()}` } };
      await postWithFiles(c.id, { embeds: [embed] }, [s.image], m.id);
      done.push(`refreshed "${s.title}" in ${s.channel}`);
    } else if (s.op === 'delete_zone') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: deleting needs approved_by Dai or Wolf`);
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const cat = channels.find((x) => x.id === s.id && x.type === 4);
      if (!cat) throw new Error(`step ${i + 1}: zone ${s.id} not found`);
      const inside = channels.filter((x) => x.parent_id === s.id);
      for (const c of inside) await api('DELETE', `/channels/${c.id}`, undefined, { reason: why });
      await api('DELETE', `/channels/${s.id}`, undefined, { reason: why });
      done.push(`deleted ${cat.name} and its ${inside.length} channels`);
    } else if (s.op === 'merge_role') {
      if (!['Dai', 'Wolf'].includes(req.approved_by)) throw new Error(`step ${i + 1}: merging deletes a role, so it needs approved_by Dai or Wolf`);
      const from = role(s.from); const into = role(s.into);
      let added = 0;
      for (let after = '0'; ;) {
        const page = await api('GET', `/guilds/${gid}/members?limit=1000&after=${after}`);
        for (const m of page) {
          if (m.roles.includes(from.id) && !m.roles.includes(into.id)) { await api('PUT', `/guilds/${gid}/members/${m.user.id}/roles/${into.id}`, undefined, { reason: why }); added++; }
        }
        if (page.length < 1000) break;
        after = page[page.length - 1].user.id;
      }
      let moved = 0;
      for (const c of await api('GET', `/guilds/${gid}/channels`)) {
        const ow = c.permission_overwrites || [];
        const f = ow.find((o) => o.id === from.id);
        if (!f) continue;
        const t = ow.find((o) => o.id === into.id);
        const next = ow.filter((o) => o.id !== from.id && o.id !== into.id);
        next.push({ id: into.id, type: 0, allow: (BigInt(f.allow) | BigInt(t?.allow || 0)).toString(), deny: ((BigInt(f.deny) | BigInt(t?.deny || 0)) & ~(BigInt(f.allow) | BigInt(t?.allow || 0))).toString() });
        await api('PATCH', `/channels/${c.id}`, { permission_overwrites: next }, { reason: why });
        moved++;
      }
      await api('DELETE', `/guilds/${gid}/roles/${from.id}`, undefined, { reason: why });
      done.push(`merged ${s.from} into ${s.into} (${added} people given ${s.into}, ${moved} channels updated)`);
    } else if (s.op === 'order_zones') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const cats = channels.filter((x) => x.type === 4);
      const ids = s.names.map((n) => cats.find((c) => c.name === n)?.id).filter(Boolean);
      const rest = cats.filter((c) => !ids.includes(c.id)).sort((a, b) => a.position - b.position).map((c) => c.id);
      await api('PATCH', `/guilds/${gid}/channels`, [...ids, ...rest].map((id, n) => ({ id, position: n })), { reason: why });
      done.push('reordered zones');
    } else if (s.op === 'order_categories') {
      const channels = await api('GET', `/guilds/${gid}/channels`);
      const cats = channels.filter((x) => x.type === 4).sort((a, b) => a.position - b.position);
      const wanted = s.top.filter((id) => cats.some((c) => c.id === id));
      const rest = cats.filter((c) => !wanted.includes(c.id) && !(s.bottom || []).includes(c.id)).map((c) => c.id);
      const order = [...wanted, ...rest, ...(s.bottom || [])];
      await api('PATCH', `/guilds/${gid}/channels`, order.map((id, n) => ({ id, position: n })), { reason: why });
      done.push('reordered zones');
    } else {
      throw new Error(`step ${i + 1}: unknown step "${s.op}"`);
    }
  }
  } catch (e) {
    throw new Error(`${e.message} (finished before this: ${done.length} steps: ${done.join('; ') || 'none'})`);
  }
  return `Done: ${done.join('; ') || 'nothing'}. Now: ${await status()}`;
}
