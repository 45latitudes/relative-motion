import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ReleaseSchema } from '../../shared/schema.ts';
import { historyOf } from './history.ts';

const release = ReleaseSchema.parse(JSON.parse(readFileSync(new URL('../../fixtures/release.sample.json', import.meta.url), 'utf8')));

test('keeps airline listings and film identities, and leaves TMDb data out of the history', () => {
  const history = historyOf(release, '2026-10');
  expect(history.listings).toEqual(release.listings);
  expect(history.films.map((film) => film.id)).toEqual(release.films.map((film) => film.id));
  expect(history.films[0]).toEqual({ id: 'film-0001', match: { status: 'confirmed' }, wikidataId: 'Q900000001' });
  const text = JSON.stringify(history);
  for (const field of ['tmdbId', 'posterPath', 'overview', 'ratings', 'genres', 'imdbId']) expect(text).not.toContain(field);
});
