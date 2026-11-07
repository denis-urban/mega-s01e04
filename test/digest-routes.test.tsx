import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

type Entry = { at: string; job: string; status: 'ok' | 'retry' | 'fail'; owner?: string | null; error?: string };

const NORMAL = '2026-11-02';
const BAD_LINE = '2026-11-03';
const EMPTY = '2026-11-04';
const MISSING = '2026-11-05';

const normalEntries: Entry[] = [
  { at: '2026-11-02T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' },
  { at: '2026-11-02T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' },
  { at: '2026-11-03T01:30:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'timeout' },
  { at: '2026-11-03T01:31:00+01:00', job: 'fixtures/refresh', status: 'fail', owner: 'rook', error: 'timeout' },
  { at: '2026-11-03T01:40:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
  { at: '2026-11-03T02:00:00+01:00', job: 'digest/render', status: 'ok', owner: null },
];

const badLineEntries: Array<Entry | string> = [
  { at: '2026-11-03T23:00:01+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' },
  'not json at all',
  { at: '2026-11-03T23:10:00+01:00', job: 'notes/backup', status: 'fail', owner: 'rook', error: 'disk full' },
];

function jsonl(entries: Array<Entry | string>): string {
  return entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n');
}

function jobsInHtml(html: string): string[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((match) => match[1]!);
}

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
    writeFileSync(join(runsDir, `${NORMAL}.jsonl`), jsonl(normalEntries));
    writeFileSync(join(runsDir, `${BAD_LINE}.jsonl`), jsonl(badLineEntries));
    writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  });

  afterAll(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  describe('GET /digest/:night', () => {
    it('renders a normal night', async () => {
      const res = await createApp(config).request(`/digest/${NORMAL}`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(`digest ${NORMAL}`);
      expect(jobsInHtml(html)).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'rig/rotate-logs']);
    });

    it('answers 404 for a night with no file', async () => {
      const res = await createApp(config).request(`/digest/${MISSING}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('no run log for this night');
    });

    it('says nothing ran for an empty night', async () => {
      const res = await createApp(config).request(`/digest/${EMPTY}`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('nothing ran');
      expect(jobsInHtml(html)).toEqual([]);
    });

    it('still renders a night with a bad line and counts it', async () => {
      const res = await createApp(config).request(`/digest/${BAD_LINE}`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('1 line could not be read');
      expect(jobsInHtml(html)).toEqual(['lane/sync', 'notes/backup']);
    });
  });

  describe('GET /api/digest/:night', () => {
    it('returns the rows of a normal night', async () => {
      const res = await createApp(config).request(`/api/digest/${NORMAL}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        night: NORMAL,
        badLines: 0,
        rows: [
          {
            job: 'digest/render',
            owner: null,
            runs: 1,
            retries: 0,
            lastStatus: 'ok',
            lastError: null,
            firstAt: '2026-11-03T02:00:00+01:00',
            lastAt: '2026-11-03T02:00:00+01:00',
          },
          {
            job: 'fixtures/refresh',
            owner: 'rook',
            runs: 3,
            retries: 1,
            lastStatus: 'ok',
            lastError: null,
            firstAt: '2026-11-03T01:30:00+01:00',
            lastAt: '2026-11-03T01:40:00+01:00',
          },
          {
            job: 'lane/sync',
            owner: 'rook',
            runs: 1,
            retries: 0,
            lastStatus: 'ok',
            lastError: null,
            firstAt: '2026-11-02T23:00:06+01:00',
            lastAt: '2026-11-02T23:00:06+01:00',
          },
          {
            job: 'rig/rotate-logs',
            owner: 'lane-07',
            runs: 1,
            retries: 0,
            lastStatus: 'ok',
            lastError: null,
            firstAt: '2026-11-02T23:00:02+01:00',
            lastAt: '2026-11-02T23:00:02+01:00',
          },
        ],
      });
    });

    it('answers 404 for a night with no file', async () => {
      const res = await createApp(config).request(`/api/digest/${MISSING}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no such night' });
    });

    it('returns no rows for an empty night', async () => {
      const res = await createApp(config).request(`/api/digest/${EMPTY}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
    });

    it('counts the bad line and keeps the other rows', async () => {
      const res = await createApp(config).request(`/api/digest/${BAD_LINE}`);
      const body = (await res.json()) as { night: string; badLines: number; rows: Array<{ job: string }> };
      expect(res.status).toBe(200);
      expect(body.night).toBe(BAD_LINE);
      expect(body.badLines).toBe(1);
      expect(body.rows.map((row) => row.job)).toEqual(['lane/sync', 'notes/backup']);
    });
  });

  it.each([NORMAL, BAD_LINE])('page and JSON list the same jobs in the same order for %s', async (night) => {
    const app = createApp(config);
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as { rows: Array<{ job: string }> };
    expect(jobsInHtml(html)).toEqual(body.rows.map((row) => row.job));
  });
});
