import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAirChina, parseChinaAirlines, parseUnited, type AirlineCode, type Observation } from './parse.ts';

// A collection round stores raw responses plus a manifest; parsers only ever read these files.
export interface RoundEntry {
  airline: AirlineCode;
  url: string;
  fetchedAt: string;
  status: number;
  // Body file name inside the round directory; absent when the request failed.
  file?: string;
}

export const roundsRoot = 'local/airlines/rounds';
export const minimumFeatureMinutes = 40;

export function readManifest(directory: string): RoundEntry[] {
  return JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as RoundEntry[];
}

function parseEntry(directory: string, entry: RoundEntry): Observation[] {
  const body = readFileSync(join(directory, entry.file!), 'utf8');
  const observedAt = entry.fetchedAt.slice(0, 10);
  if (entry.airline === 'UA') return parseUnited(JSON.parse(body), observedAt);
  if (entry.airline === 'CI') return parseChinaAirlines(body, observedAt);
  return parseAirChina(body, observedAt);
}

// The latest round in which every request for the airline succeeded; a failed round never replaces it.
export function latestSuccessfulRound(root: string, airline: AirlineCode): { id: string; entries: RoundEntry[] } | undefined {
  if (!existsSync(root)) return undefined;
  for (const id of readdirSync(root).sort().reverse()) {
    const entries = readManifest(join(root, id)).filter((entry) => entry.airline === airline);
    if (entries.length && entries.every((entry) => entry.status === 200 && entry.file)) return { id, entries };
  }
  return undefined;
}

// Observations of the airline's current catalogue. For United, the programme covering `month`,
// or the latest earlier one when that month is not published yet.
export function currentObservations(root: string, airline: AirlineCode, month: string) {
  const round = latestSuccessfulRound(root, airline);
  if (!round) return { round: undefined, observations: [] as Observation[] };
  // Items under 40 minutes are promotional or short films, not features; the raw round keeps them.
  const all = round.entries.flatMap((entry) => parseEntry(join(root, round.id), entry))
    .filter((o) => o.runtime === undefined || o.runtime >= minimumFeatureMinutes);
  if (airline !== 'UA') return { round: round.id, observations: all };
  const months = [...new Set(all.map((o) => o.catalogMonth).filter((m): m is string => Boolean(m && m <= month)))].sort();
  const chosen = months.at(-1);
  return { round: round.id, observations: all.filter((o) => o.catalogMonth === chosen) };
}
