import { describe, expect, test } from 'vitest';
import { confirmedRow, fetchedAt, unconfirmedRow } from '../../fixtures/catalog-rows.ts';
import { buildRelease, fetchTimesFrom, type AirlineCorrection, type FetchTimes } from './build.ts';

const times: FetchTimes = {
  tmdbMovie: (id) => (id === 900001 ? fetchedAt.tmdb : undefined),
  wikidataEntity: (id) => (id === 'Q900000001' ? fetchedAt.wikidata : undefined),
};

test('exports a confirmed film with display fields and public ratings only', () => {
  const { release, warnings } = buildRelease([confirmedRow()], '2026-10-30', times);
  const [film] = release.films;
  expect(film).toMatchObject({
    // The airline's own Chinese title wins over TMDb's translation.
    title: '紙上地平線',
    originalTitle: 'Paper Horizon',
    year: 2001,
    runtime: 102,
    directors: ['Ari Example'],
    cast: ['Casey Example', 'Second Lead'],
    genres: ['剧情'],
    posterPath: '/syntheticPoster.jpg',
    overview: { text: '一个自造的故事。', language: 'zh-CN' },
    awards: { wins: 2, nominations: 1, fetchedAt: fetchedAt.wikidata },
    externalIds: { tmdbId: 900001, imdbId: 'tt9000001', wikidataId: 'Q900000001', letterboxdId: 'paper-horizon' },
  });
  expect(film.externalIds).not.toHaveProperty('metacriticId');
  expect(warnings).toContain('synthetic-1: dropped malformed metacriticId');
  expect(release.ratings.map(({ source, via, ratedOn }) => ({ source, via, ratedOn }))).toEqual([
    { source: 'tmdb', via: 'tmdb', ratedOn: undefined },
    { source: 'rotten-tomatoes-tomatometer', via: 'wikidata', ratedOn: '2026-01-02' },
  ]);
});

test('keeps unconfirmed entries as airline facts without enrichment', () => {
  const { release } = buildRelease([confirmedRow(), unconfirmedRow()], '2026-10-30', times);
  const film = release.films[1];
  expect(film).toEqual({
    id: 'synthetic-2',
    title: 'Lanterns at Noon',
    match: { status: 'unconfirmed', reason: '导演信息冲突' },
    externalIds: {},
  });
  expect(release.ratings.some((rating) => rating.filmId === film.id)).toBe(false);
  expect(release.listings[1]).toMatchObject({ airlineCode: 'UA', year: 2001, directors: ['Ari Example'] });
  expect(release.listings[1]).not.toHaveProperty('cast');
  expect(release.airlines.map((airline) => airline.code)).toEqual(['CI', 'UA']);
});

test('drops Wikidata data when its IMDb ID disagrees with TMDb', () => {
  const { release, warnings } = buildRelease([confirmedRow({ wikidataImdb: 'tt9000009' })], '2026-10-30', times);
  expect(release.films[0].externalIds).toEqual({ tmdbId: 900001, imdbId: 'tt9000001' });
  expect(release.films[0]).not.toHaveProperty('awards');
  expect(release.ratings.map((rating) => rating.source)).toEqual(['tmdb']);
  expect(warnings[0]).toContain('IMDb IDs differ');
});

test('omits a TMDb score without votes and prefers a Chinese original title over regional ones', () => {
  // Without an airline Chinese title, TMDb's titles decide.
  const row = confirmedRow({ movie: {
    vote_count: 0,
    original_language: 'zh',
    original_title: '纸上的地平线',
    translations: { translations: [{ iso_639_1: 'zh', iso_3166_1: 'TW', data: { title: '紙上地平線' } }] },
  } });
  row.sample.aliases = [];
  const { release } = buildRelease([row], '2026-10-30', times);
  expect(release.films[0].title).toBe('纸上的地平线');
  expect(release.films[0].overview).toEqual({ text: 'An invented story.', language: 'en' });
  expect(release.ratings.some((rating) => rating.source === 'tmdb')).toBe(false);
});

test('indexes the latest successful read per TMDb film and Wikidata entity', () => {
  const index = fetchTimesFrom([
    { url: 'https://api.themoviedb.org/3/movie/7?language=en-US', fetchedAt: '2026-10-01T00:00:00Z', status: 200 },
    { url: 'https://api.themoviedb.org/3/movie/7?language=en-US', fetchedAt: '2026-10-02T00:00:00Z', status: 200 },
    { url: 'https://api.themoviedb.org/3/movie/7/videos', fetchedAt: '2026-10-05T00:00:00Z', status: 200 },
    { url: 'https://api.themoviedb.org/3/movie/8', fetchedAt: '2026-10-03T00:00:00Z', status: 404 },
    { url: 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1%7CQ2', fetchedAt: '2026-10-04T00:00:00Z', status: 200 },
  ]);
  expect(index.tmdbMovie(7)).toBe('2026-10-02T00:00:00Z');
  expect(index.tmdbMovie(8)).toBeUndefined();
  expect(index.wikidataEntity('Q2')).toBe('2026-10-04T00:00:00Z');
});

test('drops Wikidata data flagged as conflicting, keeps Vimeo trailers and marks samples as partial', () => {
  const row = confirmedRow();
  row.details.idConflict = true;
  (row.details.tmdb as { trailerUrl: string }).trailerUrl = 'https://vimeo.com/12345';
  const { release, warnings } = buildRelease([row], '2026-10-30', times);
  expect(release.films[0]).not.toHaveProperty('awards');
  expect(release.films[0].trailerUrl).toBe('https://vimeo.com/12345');
  expect(release.ratings.map((rating) => rating.source)).toEqual(['tmdb']);
  expect(warnings.some((warning) => warning.includes('conflict'))).toBe(true);
  expect(release.collections[0].status).toBe('partial');
});

test('moves the issue date forward to the latest local observation date', () => {
  const row = confirmedRow();
  row.sample.observedAt = '2026-10-31';
  expect(buildRelease([row], '2026-10-30', times).release.issue).toBe('2026-10-31');
});

test('warns instead of silently dropping data without a cached read time', () => {
  const none: FetchTimes = { tmdbMovie: () => undefined, wikidataEntity: () => undefined };
  const { release, warnings } = buildRelease([confirmedRow()], '2026-10-30', none);
  expect(release.ratings).toEqual([]);
  expect(warnings.filter((warning) => warning.includes('no cached read time'))).toHaveLength(2);
});

describe('airline field corrections', () => {
  const candidate = {
    id: 900005, title: 'Lanterns at Noon', original_title: 'Lanterns at Noon', original_language: 'en',
    release_date: '2001-05-01', runtime: 101, vote_average: 6.5, vote_count: 20, poster_path: '/lanterns.jpg',
    credits: { crew: [{ job: 'Director', name: 'Real Director' }], cast: [{ name: 'Casey Example', order: 0 }] },
    videos: { results: [] }, translations: { translations: [] },
  };
  const row = () => {
    const base = unconfirmedRow();
    base.details.tmdbCandidates = [candidate];
    return base;
  };
  const correction: AirlineCorrection = {
    airline: 'UA', sourceRecord: '0', field: 'directors', published: ['Ari Example'], corrected: ['Real Director'],
    evidence: 'Synthetic evidence.', checkedOn: '2026-10-30',
  };
  const tmdbTimes: FetchTimes = { tmdbMovie: () => fetchedAt.tmdb, wikidataEntity: () => undefined };

  test('reruns the rules on the corrected fact and keeps the airline value on the listing', () => {
    const { release } = buildRelease([row()], '2026-10-30', tmdbTimes, { corrections: [correction] });
    expect(release.films[0]).toMatchObject({ match: { status: 'confirmed' }, externalIds: { tmdbId: 900005 }, directors: ['Real Director'] });
    expect(release.listings[0].directors).toEqual(['Ari Example']);
    expect(release.listings[0].differsOn).toEqual(['directors']);
  });

  test('skips a correction once the airline value no longer matches what was recorded', () => {
    const { release, warnings } = buildRelease([row()], '2026-10-30', tmdbTimes, { corrections: [{ ...correction, published: ['Someone Else'] }] });
    expect(release.films[0].match.status).toBe('unconfirmed');
    expect(warnings[0]).toContain('correction skipped');
  });
});
