// Entry point. Runs each pending request in requests/*.json, oldest first, and records the result.
// A request looks like: { "action": "snapshot", "status": "pending", "asked_by": "Dai", "note": "..." }

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { apply, status } from './apply.mjs';
import { backup } from './backup.mjs';
import { deepdive } from './deepdive.mjs';
import { appendFile } from 'node:fs/promises';
import { changeLog } from './changelog.mjs';
import { daily, checkup, albumOfTheWeek, weeklyPoll } from './schedule.mjs';
import { leafvellaNews } from './leafvella.mjs';
import { securityWatch } from './security.mjs';

// The repo is public: a plain snapshot would publish pinned posts, so only the sealed deep dive is allowed.
const privateSnapshot = async () => { throw new Error('Snapshots are private now. Use deepdive with seal_with.'); };
const ACTIONS = { snapshot: privateSnapshot, apply, status, backup, deepdive, leafvellaNews, albumOfTheWeek, securityWatch };
const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFile(process.env.GITHUB_STEP_SUMMARY, line + '\n');

// Scheduled jobs run without needing a request file.
const JOBS = { backup: ['🌙 Nightly backup and security watch', async () => `${await backup()} · ${await securityWatch().catch((e) => `security watch failed: ${e.message}`)}`], daily: ['📅 Daily posts', async () => `${await daily()} · ${await leafvellaNews().catch((e) => `Leafvella news failed: ${e.message}`)}`], checkup: ['🛡 Weekly check-up', checkup], album: ['⚡ Album of the week', albumOfTheWeek], poll: ['📊 Weekly poll', weeklyPoll] };
if (JOBS[process.argv[2]]) {
  const [label, job] = JOBS[process.argv[2]];
  const r = await job(); console.log(r); await summary(`### ${label}\n${r}`); process.exit(0);
}

const files = (await readdir('requests').catch(() => [])).filter((f) => f.endsWith('.json')).sort();
let failed = false;
let stop = false;
for (const f of files) {
  const path = `requests/${f}`;
  const req = JSON.parse(await readFile(path, 'utf8'));
  if (req.status !== 'pending') continue;
  if (stop) { console.log(`${f}: waiting, because an earlier request failed`); continue; }
  const fn = ACTIONS[req.action];
  try {
    if (!fn) throw new Error(`Unknown action "${req.action}"`);
    req.result = await fn(req);
    req.status = 'done';
    if (req.action === 'apply') await changeLog(req).catch((e) => console.log(`change log not posted: ${e.message}`));
  } catch (e) {
    req.status = 'failed';
    stop = true;
    req.result = String(e.message || e).replace(/Bot [\w.-]{20,}/g, 'Bot [hidden]');
    failed = true;
  }
  req.finished = new Date().toISOString();
  await writeFile(path, JSON.stringify(req, null, 2) + '\n');
  console.log(`${f}: ${req.status} – ${req.result}`);
  await summary(`### ${req.status === 'done' ? '✅' : '❌'} ${req.action}: ${req.note || f}\n${req.result}\n`);
}
if (failed) process.exitCode = 1;
