export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  // ISO 8601 exactly as in the log, offset kept; never normalised to UTC.
  firstAt: string;
  lastAt: string;
};

export type Night =
  | { found: false }
  | { found: true; rows: DigestRow[]; badLines: number };

export type ReadNight = (runsDir: string, night: string) => Night;
