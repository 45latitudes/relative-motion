import type { Row, Sample } from '../pipeline/coverage/model.ts';

// Invented T-05-shaped rows for catalog export tests; no real titles, IDs or scores.
export const fetchedAt = { tmdb: '2026-10-29T08:00:00.000Z', wikidata: '2026-10-29T08:00:05.000Z' };

const sample = (overrides: Partial<Sample>): Sample => ({
  id: 'synthetic-1',
  title: 'Paper Horizon',
  aliases: ['紙上地平線'],
  year: 2001,
  runtime: 100,
  directors: ['Ari Example'],
  cast: ['Casey Example'],
  audioLanguages: ['English'],
  tags: ['synthetic'],
  airline: 'CI',
  source: 'synthetic.json',
  sourceSha256: 'a'.repeat(64),
  sourceRecord: '0',
  observedAt: '2026-08-20',
  editionNote: 'Synthetic edition.',
  ...overrides,
});

const movie = (overrides: Record<string, unknown> = {}) => ({
  id: 900001,
  title: 'Paper Horizon',
  original_title: 'Paper Horizon',
  original_language: 'en',
  release_date: '2001-03-04',
  runtime: 102,
  vote_average: 7.25,
  vote_count: 40,
  poster_path: '/syntheticPoster.jpg',
  overview: 'An invented story.',
  genres: [{ id: 18, name: 'Drama' }, { id: 99999, name: 'Unknown' }],
  credits: {
    crew: [{ job: 'Director', name: 'Ari Example' }, { job: 'Writer', name: 'Wren Example' }],
    cast: [{ name: 'Second Lead', order: 1 }, { name: 'Casey Example', order: 0 }],
  },
  external_ids: { imdb_id: 'tt9000001' },
  translations: { translations: [
    { iso_639_1: 'zh', iso_3166_1: 'TW', data: { title: '紙上地平線', overview: '' } },
    { iso_639_1: 'zh', iso_3166_1: 'CN', data: { title: '纸上地平线', overview: '一个自造的故事。' } },
  ] },
  ...overrides,
});

const wikidata = (imdbId = 'tt9000001') => ({
  entity: { id: 'Q900000001' },
  ids: { imdbId, doubanId: '900000001', rottenTomatoesId: 'm/paper_horizon', metacriticId: 'not-a-movie-id', letterboxdId: 'paper-horizon' },
  awards: [{}, {}],
  nominations: [{}],
  ratings: { selected: [
    { source: 'rotten-tomatoes-tomatometer', value: 88, max: 100, date: '2026-01-02', votes: 50 },
    { source: 'imdb-weighted-average', value: 7.7, max: 10, date: '2026-01-02' },
  ] },
});

const hit = { status: 'hit' as const, reason: '' };

export const confirmedRow = (options: { wikidataImdb?: string; movie?: Record<string, unknown> } = {}): Row => ({
  sample: sample({}),
  fields: { tmdbMatch: hit, wikidataMatch: hit },
  notes: [],
  details: {
    identity: 'confirmed',
    tmdb: { movie: movie(options.movie), trailerUrl: 'https://www.youtube.com/watch?v=synthetic1' },
    wikidata: wikidata(options.wikidataImdb),
  },
});

export const unconfirmedRow = (): Row => ({
  sample: sample({ id: 'synthetic-2', title: 'Lanterns at Noon', aliases: [], airline: 'UA', cast: undefined }),
  fields: { tmdbMatch: { status: 'ambiguous', reason: '导演信息冲突' }, wikidataMatch: { status: 'untested', reason: '' } },
  notes: [],
  details: { identity: 'unconfirmed' },
});
