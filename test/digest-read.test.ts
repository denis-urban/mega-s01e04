import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { DigestRow, Night } from '../src/digest/types.js';

function rowsOf(night: Night): DigestRow[] {
  if (!night.found) throw new Error('night not found');
  return night.rows;
}

function row(night: Night, job: string): DigestRow | undefined {
  return rowsOf(night).find((r) => r.job === job);
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('finds 5 jobs, sorted by job, and 1 bad line', () => {
    expect(night).toMatchObject({ found: true, badLines: 1 });
    expect(rowsOf(night).map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts runs and retries, last status from the latest line', () => {
    expect(row(night, 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(row(night, 'lane/sync')).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok' });
  });

  it('keeps the last error of a failed job', () => {
    expect(row(night, 'notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps a row whose owner is null', () => {
    expect(row(night, 'digest/render')).toMatchObject({ owner: null, runs: 1 });
  });

  it('keeps the log offset on times', () => {
    expect(row(night, 'rig/rotate-logs')).toMatchObject({
      firstAt: '2026-10-28T23:00:02+01:00',
      lastAt: '2026-10-28T23:00:02+01:00',
    });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a night with no file is not found', () => {
    expect(readNight(dir, '2026-01-01')).toEqual({ found: false });
  });

  it('an empty file is found with no rows', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({ found: true, rows: [], badLines: 0 });
  });

  it('rejects a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '../runs/2026-10-28')).toEqual({ found: false });
    expect(readNight('runs', '2026-10-28.jsonl')).toEqual({ found: false });
  });

  it('counts wrong-shape lines as bad and skips blank lines', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"not a time","job":"a","status":"ok","owner":"x"}',
      '{"job":"a","status":"ok","owner":"x"}',
      '[1,2]',
      '   ',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), `${lines.join('\n')}\n`);

    const night = readNight(dir, '2026-01-03');
    expect(night).toMatchObject({ found: true, badLines: 4 });
    expect(rowsOf(night)).toHaveLength(1);
  });

  it('picks the latest line by instant, not by file order or string', () => {
    const lines = [
      '{"at":"2026-01-04T02:00:00+01:00","job":"a","status":"fail","owner":"x","error":"late"}',
      '{"at":"2026-01-04T01:30:00+00:00","job":"a","status":"retry","owner":"x","error":"early"}',
      '{"at":"2026-01-04T00:30:00+01:00","job":"a","status":"ok","owner":"x"}',
    ];
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\n'));

    expect(row(readNight(dir, '2026-01-04'), 'a')).toEqual({
      job: 'a',
      owner: 'x',
      runs: 3,
      retries: 1,
      lastStatus: 'retry',
      lastError: 'early',
      firstAt: '2026-01-04T00:30:00+01:00',
      lastAt: '2026-01-04T01:30:00+00:00',
    });
  });
});
