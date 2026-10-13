export function bucketKey(row: {
  source: string;
  model: string;
  project: string;
  hour_start: string;
  collector?: string;
}): string {
  const collector = row.collector?.trim() || '';
  return `${row.source}|${collector}|${row.model}|${row.project}|${row.hour_start}`;
}

export function monthFromHourStart(hourStart: string): string {
  const d = new Date(hourStart);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function queueFilePath(dataDir: string, hourStart: string): string {
  const month = monthFromHourStart(hourStart);
  return `${dataDir}/queue/${month}.jsonl`;
}

export function toUtcHalfHourStart(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = d.getUTCMinutes();
  d.setUTCMinutes(mins < 30 ? 0 : 30, 0, 0);
  return d.toISOString();
}

export function ingestBucketKey(row: {
  source: string;
  model: string;
  hour_start: string;
  collector?: string;
}): string {
  const collector = row.collector?.trim() || '';
  return `${row.source}|${collector}|${row.model}|${row.hour_start}`;
}
