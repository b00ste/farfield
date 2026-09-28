import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotState } from '../deploy/aws/snapshot.mjs';

test('online snapshot preserves committed rankings and rooms without stopping the writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'farfield-snapshot-test-'));
  const source = join(root, 'source'), target = join(root, 'target');
  await mkdir(source); await mkdir(target);
  const rooms = { rooms: [{ id: 'checkpoint' }] };
  await writeFile(join(source, 'rooms.json'), JSON.stringify(rooms));
  const writer = new DatabaseSync(join(source, 'rankings.sqlite'));
  try {
    writer.exec('CREATE TABLE results (id INTEGER PRIMARY KEY, rating INTEGER); INSERT INTO results VALUES (1, 1530)');
    await snapshotState(source, target, true);
    writer.exec('INSERT INTO results VALUES (2, 1550)');
    const copy = new DatabaseSync(join(target, 'rankings.sqlite'), { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM results').get().n, 1);
      assert.equal(copy.prepare('SELECT rating FROM results').get().rating, 1530);
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { copy.close(); }
    assert.deepEqual(JSON.parse(await readFile(join(target, 'rooms.json'), 'utf8')), rooms);
    for (const name of ['rooms.json', 'rankings.sqlite'])
      assert.equal((await stat(join(target, name))).mode & 0o777, 0o600);
  } finally { writer.close(); await rm(root, { recursive: true, force: true }); }
});

test('ranked backup fails closed when its database is missing; unranked backup supports rooms only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'farfield-snapshot-test-'));
  try {
    await writeFile(join(root, 'rooms.json'), '{}');
    const ranked = join(root, 'ranked'), unranked = join(root, 'unranked');
    await mkdir(ranked); await mkdir(unranked);
    await assert.rejects(snapshotState(root, ranked, true), { code: 'ENOENT' });
    await snapshotState(root, unranked);
    assert.equal(await readFile(join(unranked, 'rooms.json'), 'utf8'), '{}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
