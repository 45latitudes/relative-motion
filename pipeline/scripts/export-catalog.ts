import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AirlineCode } from '../airlines/parse.ts';
import { currentObservations, roundsRoot } from '../airlines/rounds.ts';
import { sampleId, sampleOf } from '../airlines/samples.ts';
import { buildRelease, fetchTimesFrom, type AirlineCorrection } from '../catalog/build.ts';
import { historyOf } from '../catalog/history.ts';
import { assignFilmId, emptyRegistry, type FilmIdRegistry } from '../catalog/ids.ts';
import { newRow } from '../coverage/enrich.ts';
import { number, object, type Row } from '../coverage/model.ts';

// Offline: builds one month's catalogue from the latest rounds and match results; makes no requests.
// It writes three things:
// - the published snapshot, `web/public/data/<month>.json` and `latest.json` naming the newest
//   month. It carries TMDb details, so it is not committed: it is uploaded to the replaceable
//   `catalog-snapshot` release, where the site build picks it up and old months can be deleted;
// - the month's history, `data/history/<month>.json`: airline listings and film identities only,
//   committed so the months accumulate in Git;
// - per-airline copies in `local/releases/<month>/`, so one airline can be withdrawn, or a new one
//   added during the month, by exporting again with `--airlines`.
const { values } = parseArgs({
  // `pnpm <script> -- --flag` passes the separator through; drop it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    month: { type: 'string', default: new Date().toISOString().slice(0, 7) },
    airlines: { type: 'string', default: 'UA,CI,CA' },
    'data-dir': { type: 'string', default: 'web/public/data' },
  },
  strict: true,
});
const rowsDir = 'local/catalog/match';
const responsesDir = 'local/catalog/responses';
const registryFile = 'data/film-ids.json';
if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(values.month)) throw new Error(`--month must look like 2026-11, not ${values.month}`);
const airlines = values.airlines.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean) as AirlineCode[];
const rowsByAirline = new Map<AirlineCode, Row[]>();

const rows: Row[] = [];
const months = new Map<string, string | undefined>();
const statuses = new Map<string, 'success' | 'partial' | 'failed'>();
for (const airline of airlines) {
  rowsByAirline.set(airline, []);
  const { round, observations } = currentObservations(roundsRoot, airline, values.month);
  if (!round) { statuses.set(airline, 'failed'); continue; }
  let complete = true;
  for (const observation of observations) {
    const file = join(rowsDir, `${sampleId(observation)}.json`);
    let row: Row;
    if (existsSync(file)) row = JSON.parse(readFileSync(file, 'utf8')) as Row;
    else {
      complete = false;
      row = newRow(sampleOf(observation, round));
      row.fields.tmdbMatch = { status: 'untested', reason: '尚未完成匹配' };
    }
    rows.push(row);
    rowsByAirline.get(airline)!.push(row);
    months.set(row.sample.id, observation.catalogMonth);
  }
  statuses.set(airline, complete ? 'success' : 'partial');
}

const registry: FilmIdRegistry = existsSync(registryFile)
  ? JSON.parse(readFileSync(registryFile, 'utf8')) as FilmIdRegistry : emptyRegistry();
const records = readdirSync(responsesDir).filter((name) => name.endsWith('.json')).map((name) => {
  const { url, fetchedAt, status } = JSON.parse(readFileSync(join(responsesDir, name), 'utf8')) as {
    url: string; fetchedAt: string; status: number;
  };
  return { url, fetchedAt, status };
});
const labelsFile = 'local/catalog/award-labels.json';
const awardLabels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')) as Record<string, string> : {};
const corrections = JSON.parse(readFileSync(new URL('../catalog/airline-corrections.json', import.meta.url), 'utf8')) as AirlineCorrection[];
const idWarnings: string[] = [];
const build = (selected: Row[]) => buildRelease(selected, new Date().toISOString().slice(0, 10), fetchTimesFrom(records), {
  corrections,
  awardLabels,
  filmIdOf: (row) => {
    const tmdbId = row.details.identity === 'confirmed' ? number(object(object(row.details.tmdb).movie).id) : undefined;
    return assignFilmId(registry, [...(tmdbId ? [`tmdb:${tmdbId}`] : []), `${row.sample.airline}:${row.sample.sourceRecord}`], idWarnings);
  },
  catalogMonthOf: (row) => months.get(row.sample.id),
  collectionOf: (airline) => statuses.get(airline) ?? 'failed',
});
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const write = (file: string, content: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };

const { release, warnings } = build(rows);
for (const warning of [...warnings, ...idWarnings]) console.warn(warning);

// Published snapshot: this month's file, and `latest.json` naming the newest month exported.
const dataDir = values['data-dir'];
const releaseFile = join(dataDir, `${values.month}.json`);
write(releaseFile, json(release));
const exported = readdirSync(dataDir).map((name) => /^(\d{4}-\d{2})\.json$/.exec(name)?.[1]).filter((month): month is string => Boolean(month)).sort();
write(join(dataDir, 'latest.json'), json({ current: exported.at(-1) }));

// History kept in Git.
const historyFile = join('data/history', `${values.month}.json`);
write(historyFile, json(historyOf(release, values.month)));

// Local: the same month per airline, with what went into it.
const localDir = join('local/releases', values.month);
const perAirline = airlines.map((airline) => {
  const selected = rowsByAirline.get(airline) ?? [];
  if (selected.length) write(join(localDir, `${airline}.json`), json(build(selected).release));
  return { airline, status: statuses.get(airline), observations: selected.length };
});
write(join(localDir, 'manifest.json'), json({ month: values.month, exportedAt: new Date().toISOString(), airlines: perAirline, films: release.films.length }));

write(registryFile, json(registry));
const confirmed = release.films.filter((film) => film.match.status === 'confirmed').length;
console.log(`Wrote ${releaseFile} and ${historyFile}: ${release.films.length} films (${confirmed} confirmed), ${release.ratings.length} ratings; collections ${[...statuses].map(([a, s]) => `${a} ${s}`).join(', ')}. Per-airline copies in ${localDir}.`);
