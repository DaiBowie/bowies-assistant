import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, VIEW_CHANNEL } from '../bot/discord.mjs';

test('channel types are named', () => {
  assert.equal(TYPES[0], 'text');
  assert.equal(TYPES[4], 'category');
});

test('view channel permission bit', () => {
  assert.equal(VIEW_CHANNEL, 1024n);
});

test('requests are valid JSON with an action and status', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  for (const f of (await readdir('requests')).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(await readFile(`requests/${f}`, 'utf8'));
    assert.ok(r.action, `${f} has an action`);
    assert.ok(['pending', 'done', 'failed'].includes(r.status), `${f} has a known status`);
    if ((r.steps || []).some((s) => s.op?.startsWith('delete'))) assert.ok(['Dai', 'Wolf'].includes(r.approved_by), `${f} deletes only with a yes`);
  }
});
