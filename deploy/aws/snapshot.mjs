import { DatabaseSync, backup } from 'node:sqlite';
import { readFile, writeFile, chmod, access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Rooms are captured first so the subsequent ledger snapshot includes any
// result already referenced by them. Recovery reconciles newer ledger results.
export async function snapshotState(source, destination, requireRankings = false) {
  const rooms = await readFile(join(source, 'rooms.json'));
  JSON.parse(rooms.toString());
  await writeFile(join(destination, 'rooms.json'), rooms, { mode: 0o600, flag: 'wx' });
  const database = join(source, 'rankings.sqlite');
  try { await access(database); } catch (error) {
    if (error.code === 'ENOENT' && !requireRankings) return;
    throw error;
  }
  const db = new DatabaseSync(database, { readOnly: true, timeout: 5000 });
  const target = join(destination, 'rankings.sqlite');
  try { await backup(db, target); } finally { db.close(); }
  await chmod(target, 0o600);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('Ranking snapshot integrity failed');
  } finally { copy.close(); }
}

// Invoked through stdin inside the running container, without a restart.
if (process.argv[1] === '-') {
  process.umask(0o077);
  const directory = await mkdtemp(join(tmpdir(), 'farfield-snapshot-'));
  try {
    await snapshotState('/data', directory, process.env.FARFIELD_RANKED_ENABLED === '1');
    const tar = spawnSync('tar', ['-czf', '-', '-C', directory, '.'], { stdio: ['ignore', 'inherit', 'pipe'] });
    if (tar.status !== 0) throw new Error('Snapshot archive failed');
  } catch {
    console.error('Could not create the private Farfield state snapshot');
    process.exitCode = 1;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
