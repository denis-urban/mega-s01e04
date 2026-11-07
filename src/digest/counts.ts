import { join } from 'node:path';
import { parseLine, readLog } from './read.js';
import type { StatusCounts } from './types.js';

export function countNight(runsDir: string, night: string): StatusCounts | null {
  const text = readLog(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const raw of text.split('\n')) {
    const line = parseLine(raw);
    if (line !== null) counts[line.status]++;
  }

  return counts;
}
