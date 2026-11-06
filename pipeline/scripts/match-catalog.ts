import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { currentObservations, roundsRoot } from '../airlines/rounds.ts';
import type { AirlineCode, ScoutAirline } from '../airlines/parse.ts';
import { scoutFiles, scoutObservations, scoutRoot } from '../airlines/scout.ts';
import { sampleId, sampleOf } from '../airlines/samples.ts';
import { createClient } from '../coverage/client.ts';
import { newRow, tmdb, wikidata } from '../coverage/enrich.ts';
import type { Row } from '../coverage/model.ts';
import { writeJsonAtomic } from '../coverage/storage.ts';
import type { RatingRule } from '../coverage/wikidata.ts';

// Matches the current catalogue of each airline against TMDb and Wikidata with the T-05 rules.
// Resumable: finished rows are skipped; rows that hit a source error are retried on the next run.
// Cached responses are reused; `--offline` makes no requests at all.
const { values } = parseArgs({
  // `pnpm <script> -- --flag` passes the separator through; drop it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    offline: { type: 'boolean', default: false },
    // Re-evaluate finished rows too, e.g. after a rule change; cached responses keep this cheap.
    refresh: { type: 'boolean', default: false },
    // Match the 2026-08-20 scout snapshot of airlines that are not collected (SQ, CX, EK).
    scout: { type: 'boolean', default: false },
    month: { type: 'string', default: new Date().toISOString().slice(0, 7) },
    airline: { type: 'string', multiple: true },
  },
  strict: true,
});
const rowsDir = values.scout ? 'local/scout/match' : 'local/catalog/match';
const responsesDir = 'local/catalog/responses';
mkdirSync(rowsDir, { recursive: true });

const done = (file: string) => {
  if (!existsSync(file)) return false;
  const row = JSON.parse(readFileSync(file, 'utf8')) as Row;
  return !['error', 'untested'].includes(row.fields.tmdbMatch?.status ?? 'untested')
    && row.fields.wikidataMatch?.status !== 'error';
};

// One run at a time: two runs would share the cache and request clock and double the traffic.
const lockFile = 'local/catalog/match.lock';
if (existsSync(lockFile)) {
  const pid = Number(readFileSync(lockFile, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* stale lock */ }
  if (alive) throw new Error(`Another match run (pid ${pid}) is active`);
}
writeFileSync(lockFile, String(process.pid));
process.on('exit', () => rmSync(lockFile, { force: true }));
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const token = process.env.TMDB_READ_ACCESS_TOKEN;
const apiKey = process.env.TMDB_API_KEY;
if (!values.offline && !token && !apiKey) throw new Error('Missing TMDb credential; run with --env-file=.env');
// TMDb and Wikidata are APIs for programs: requests go back to back, one at a time per domain.
const client = createClient(responsesDir, !values.offline, { token, apiKey, gapMs: () => 0 });
const rules = JSON.parse(readFileSync(new URL('../coverage/rating-rules.json', import.meta.url), 'utf8')) as RatingRule[];
const airlines = (values.airline ?? (values.scout ? ['SQ', 'CX', 'EK'] : ['CI', 'CA', 'UA'])) as (AirlineCode | ScoutAirline)[];

const save = (row: Row, file: string, label: string) => {
  // Search summaries and Wikidata candidates are recoverable from the response cache.
  delete row.details.tmdbSearchCandidates;
  delete row.details.wikidataCandidates;
  writeJsonAtomic(file, row);
  console.log(`${label} ${row.sample.id} ${row.fields.tmdbMatch.status} ${row.fields.tmdbMatch.reason} | wikidata ${row.fields.wikidataMatch?.status} | requests ${client.used.size}`);
};

// TMDb and Wikidata run as two loops, each the only sender to its domain, so per-domain gaps hold.
const queue: { row: Row; file: string; label: string }[] = [];
let producing = true;
let failed = false;
const wikidataWorker = (async () => {
  while (!failed && (producing || queue.length)) {
    const item = queue.shift();
    if (!item) { await setTimeout(100); continue; }
    await wikidata(client, item.row, rules);
    save(item.row, item.file, item.label);
    if (item.row.fields.wikidataMatch?.status === 'error') failed = true;
  }
})();

let processed = 0;
outer: for (const airline of airlines) {
  const { round, observations } = values.scout
    ? { round: 'scout', observations: scoutObservations(airline as ScoutAirline) }
    : currentObservations(roundsRoot, airline as AirlineCode, values.month);
  if (!round) { console.warn(`${airline}: no successful round`); continue; }
  for (const [index, observation] of observations.entries()) {
    if (failed) break outer;
    const file = join(rowsDir, `${sampleId(observation)}.json`);
    if (!values.refresh && done(file)) continue;
    const sample = sampleOf(observation, round);
    if (values.scout) sample.source = `${scoutRoot}/samples/${scoutFiles[airline as ScoutAirline]}`;
    const row = newRow(sample);
    await tmdb(client, row);
    processed++;
    const label = `${airline} ${index + 1}/${observations.length}`;
    if (row.fields.tmdbMatch.status === 'error') { save(row, file, label); failed = true; break outer; }
    if (row.fields.tmdbMatch.status === 'hit') queue.push({ row, file, label });
    else save(row, file, label);
  }
}
producing = false;
await wikidataWorker;
for (const warning of client.warnings) console.warn(warning);
if (failed) {
  console.error('Stopped: a source failed. Rerun later to resume.');
  process.exitCode = 1;
}
console.log(`Done: ${processed} films matched this run.`);
