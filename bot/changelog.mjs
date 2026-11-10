// Posts a short note in the staff change log after every change, so Dai and Wolf can always see what the bot did.
import { api, theGuild } from './discord.mjs';

export async function changeLog(req) {
  const gid = await theGuild();
  const log = (await api('GET', `/guilds/${gid}/channels`)).find((c) => c.name === '📋・assistant-log');
  if (!log) return;
  const steps = (req.steps || []).length;
  const description = [
    req.note,
    '',
    `**Asked by:** ${req.asked_by || 'Dai'}${req.approved_by ? ` · **Approved by:** ${req.approved_by}` : ''}`,
    `**Steps:** ${steps}`,
    `**Result:** ${String(req.result).split('. Now:')[0].slice(0, 1500)}`,
  ].join('\n');
  await api('POST', `/channels/${log.id}/messages`, {
    embeds: [{ title: '📋 Change made', description: description.slice(0, 4000), color: 0x47c0de, timestamp: new Date().toISOString() }],
    allowed_mentions: { parse: [] },
  });
}
