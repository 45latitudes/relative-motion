import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { parseCathay, parseEmirates, parseSingapore, scoutObservations } from './scout.ts';

// Synthetic rows shaped like the scout package's parsed arrays; no real catalogue data.
const temporary: string[] = [];
afterEach(() => { temporary.forEach((d) => rmSync(d, { recursive: true, force: true })); temporary.length = 0; });

test('reads Singapore Airlines rows with their year and expands audio abbreviations', () => {
  const [film] = parseSingapore([{ movie_airline_content_id: 'm001', title: 'Paper Horizon', year_of_release: 2001, rt_min: '102',
    director: 'Ari Example', cast: 'Casey Example, Dana Example', genre: 'Drama', lang_1: 'Man', lang_2: 'Eng', lang_3: 'Xyz', lang_4: '' }]);
  expect(film).toMatchObject({ airline: 'SQ', sourceId: 'm001', year: 2001, runtime: 102, directors: ['Ari Example'],
    cast: ['Casey Example', 'Dana Example'], audioLanguages: ['Mandarin', 'English', 'Xyz'] });
});

test('keeps only the year of Cathay Pacific catalogue dates', () => {
  const [film] = parseCathay([{ id: '901', title: 'Paper Horizon', release_date: '2001-06-29', duration_minute: 102,
    director_list: 'Ari Example', cast_list: 'Casey Example', movie_language: ['eng'], subtitle_language: ['zho'] }]);
  expect(film).toMatchObject({ airline: 'CX', sourceId: '901', year: 2001, runtime: 102, audioLanguages: ['eng'] });
});

test('merges Emirates entries repeated across categories and drops series', () => {
  const entry = { title: 'Paper Horizon', director: 'Ari Example', duration: 102, episodes: '0', starring: 'Casey Example',
    genre: 'Drama / Comedy', languages: 'English,English,French', subtitles: 'null' };
  const films = parseEmirates([{ ...entry, id: 30 }, { ...entry, id: 12 }, { ...entry, id: 40, episodes: '6', title: 'A Series' }]);
  expect(films).toHaveLength(1);
  expect(films[0]).toMatchObject({ airline: 'EK', sourceId: '12', genres: ['Drama', 'Comedy'], audioLanguages: ['English', 'French'], subtitleLanguages: [] });
  expect(films[0].year).toBeUndefined();
  expect(parseEmirates([{ ...entry, id: 50, title: 'Tamil - Paper Horizon' }])[0].title).toBe('Paper Horizon');
});

test('applies the feature-length floor to scout snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'relative-motion-scout-')); temporary.push(root);
  mkdirSync(join(root, 'samples'));
  writeFileSync(join(root, 'samples', 'cathay.json'), JSON.stringify([
    { id: '1', title: 'Short', duration_minute: 5 }, { id: '2', title: 'Feature', duration_minute: 90 }]));
  expect(scoutObservations('CX', root).map((o) => o.title)).toEqual(['Feature']);
});
