import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { array, object, string } from '../coverage/model.ts';
import { personNames } from '../coverage/names.ts';
import { minimumFeatureMinutes } from './rounds.ts';
import type { Observation, ScoutAirline } from './parse.ts';

// Reads the parsed arrays of the 2026-08-20 scout package for airlines that are not collected.
// These are a one-off snapshot for validating matching; nothing here requests an airline server.
export const scoutRoot = 'data/raw/ife-scout-20260820';
export const scoutDate = '2026-08-20';
export const scoutFiles: Record<ScoutAirline, string> = { SQ: 'sia.json', CX: 'cathay.json', EK: 'emirates.json' };

const positive = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const list = (value: unknown) => [...new Set(string(value).split(',').map((item) => item.trim()).filter((item) => item && item !== 'null'))];

// KrisWorld abbreviates audio languages; unknown abbreviations are kept as published.
const singaporeLanguages: Record<string, string> = {
  Man: 'Mandarin', Can: 'Cantonese', Eng: 'English', Jpn: 'Japanese', Kor: 'Korean', Hin: 'Hindi',
  Fre: 'French', Ger: 'German', CSp: 'Spanish', Ita: 'Italian',
};

// Singapore Airlines: one KrisWorld catalogue object per film, with a clean release year.
export function parseSingapore(rows: unknown[]): Observation[] {
  return rows.map(object).filter((row) => string(row.title).trim() && string(row.movie_airline_content_id)).map((row) => ({
    airline: 'SQ' as const, sourceId: string(row.movie_airline_content_id), observedAt: scoutDate,
    title: string(row.title).trim(), titles: { en: string(row.title).trim() },
    year: positive(row.year_of_release), runtime: positive(row.rt_min),
    directors: personNames(string(row.director)), cast: personNames(string(row.cast)), genres: list(row.genre),
    audioLanguages: ['lang_1', 'lang_2', 'lang_3', 'lang_4'].map((key) => string(row[key]).trim()).filter(Boolean)
      .map((code) => singaporeLanguages[code] ?? code),
    subtitleLanguages: [], raw: row,
  }));
}

// Cathay Pacific: Anuvu items. The year of `release_date` matches the film; its day and month are
// catalogue dates shared by many titles, so only the year is kept.
export function parseCathay(rows: unknown[]): Observation[] {
  return rows.map(object).filter((row) => string(row.title).trim() && string(row.id)).map((row) => ({
    airline: 'CX' as const, sourceId: string(row.id), observedAt: scoutDate,
    title: string(row.title).trim(), titles: { en: string(row.title).trim() },
    year: positive(string(row.release_date).slice(0, 4)), runtime: positive(row.duration_minute),
    directors: personNames(string(row.director_list)), cast: personNames(string(row.cast_list)), genres: [],
    audioLanguages: array(row.movie_language).map(string).filter(Boolean),
    subtitleLanguages: array(row.subtitle_language).map(string).filter(Boolean), raw: row,
  }));
}

// Emirates prefixes regional films with their language ("Tamil - The Verdict").
const emiratesLanguagePrefix = /^(?:Malayalam|Tamil|Telugu|Bengali|Marathi|Kannada|Punjabi|Gujarati|Bhojpuri|Urdu|Pashto|Hindi|Sinhala|Nepali|Odia|Assamese) - (?=\S)/;

// Emirates: one entry per film and category, so a film repeats; entries are merged by title,
// director and runtime and keep the lowest ID. The feed has no release year.
export function parseEmirates(rows: unknown[]): Observation[] {
  const films = new Map<string, Observation>();
  for (const row of rows.map(object)) {
    const published = string(row.title).trim();
    const title = published.replace(emiratesLanguagePrefix, '');
    if (!title || string(row.episodes) !== '0') continue;
    const key = [published, string(row.director), string(row.duration)].join('|');
    const id = String(row.id ?? '');
    const known = films.get(key);
    if (known && Number(known.sourceId) <= Number(id)) continue;
    films.set(key, {
      airline: 'EK', sourceId: id, observedAt: scoutDate, title, titles: { en: title },
      runtime: positive(row.duration), directors: personNames(string(row.director)), cast: personNames(string(row.starring)),
      genres: string(row.genre).split('/').map((genre) => genre.trim()).filter(Boolean),
      audioLanguages: list(row.languages), subtitleLanguages: list(row.subtitles), raw: row,
    });
  }
  return [...films.values()];
}

const parsers: Record<ScoutAirline, (rows: unknown[]) => Observation[]> = { SQ: parseSingapore, CX: parseCathay, EK: parseEmirates };

// Feature films only, with the same 40-minute floor as the collected airlines.
export function scoutObservations(airline: ScoutAirline, root = scoutRoot): Observation[] {
  const rows = JSON.parse(readFileSync(join(root, 'samples', scoutFiles[airline]), 'utf8')) as unknown;
  if (!Array.isArray(rows)) throw new Error(`Expected an array in ${scoutFiles[airline]}`);
  return parsers[airline](rows).filter((o) => o.runtime === undefined || o.runtime >= minimumFeatureMinutes);
}
