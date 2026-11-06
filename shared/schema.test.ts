import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ReleaseSchema, schemaVersion, type Release } from './schema.js';

// All names, IDs, dates and scores are invented; no source data or network access is used.
const sample: unknown = JSON.parse(readFileSync(
  new URL('../fixtures/release.sample.json', import.meta.url),
  'utf8',
));
const release = (): Release => ReleaseSchema.parse(sample);

test('validates the synthetic release without changing its data', () => {
  expect(release()).toEqual(sample);
  expect(release().schemaVersion).toBe(schemaVersion);
});

test('keeps same-title films distinct and shares a stable film ID across airlines', () => {
  const { films, listings, ratings } = release();
  expect(films[0].title).toBe(films[1].title);
  expect(films[0].year).not.toBe(films[1].year);
  expect(films[0].id).not.toBe(films[1].id);
  expect(listings.filter((entry) => entry.filmId === films[0].id)
    .map((entry) => entry.airlineCode)).toEqual(['A1', 'A2']);
  expect(ratings.some((rating) => rating.filmId === films[1].id)).toBe(false);
});

test('retains unrated and unconfirmed entries with their raw titles', () => {
  const { films, listings, ratings } = release();
  expect(films.slice(1).map((film) => film.match.status))
    .toEqual(['confirmed', 'unconfirmed', 'unconfirmed']);
  for (const film of films.slice(1)) {
    expect(listings.some((entry) => entry.filmId === film.id && entry.rawTitle.length > 0)).toBe(true);
    expect(ratings.filter((rating) => rating.filmId === film.id)).toEqual([]);
  }
  expect(films[3].externalIds).toEqual({});
  expect(films[3].year).toBeUndefined();
});

test('keeps airline statements on listings for unconfirmed films', () => {
  const { films, listings } = release();
  const listing = listings.find((entry) => entry.filmId === films[3].id);
  expect(listing).toMatchObject({ year: 1999, runtime: 97, directors: ['Dora Fictional'] });
  expect(films[3].match).toEqual({ status: 'unconfirmed', reason: '未召回候选' });
});

test('records where each public score was obtained and its own date', () => {
  const { ratings } = release();
  expect(ratings.map(({ via, ratedOn }) => ({ via, ratedOn })))
    .toEqual([{ via: 'tmdb', ratedOn: undefined }, { via: 'wikidata', ratedOn: '2026-09-01' }]);
});

test('preserves original rating scales, absent vote counts and native New markers', () => {
  const { ratings, listings } = release();
  expect(ratings.map(({ value, scale }) => ({ value, scale }))).toEqual([
    { value: 7.5, scale: { min: 0, max: 10 } },
    { value: 82, scale: { min: 0, max: 100 } },
  ]);
  expect(ratings[0].votes).toBe(120);
  expect(ratings[1]).not.toHaveProperty('votes');
  expect(listings.slice(0, 4).map((entry) => entry.nativeNew)).toEqual([true, false, false, null]);
});

test('allows an empty rating list and a genuine zero score', () => {
  const data = release();
  data.ratings[0].value = 0;
  expect(ReleaseSchema.parse(data).ratings[0].value).toBe(0);
  data.ratings = [];
  expect(ReleaseSchema.parse(data).ratings).toEqual([]);
});

test('represents partial/failed collections while keeping older observed listings', () => {
  const data = release();
  expect(data.collections.map((collection) => collection.status)).toEqual(['success', 'partial', 'failed']);
  const retained = data.listings.find((entry) => entry.airlineCode === 'A3');
  expect(retained?.observedAt).toBe('2026-09-29');
  expect(retained?.observedAt).not.toBe(data.issue);
});

test('preserves a known original title while allowing an unknown one', () => {
  const data = release();
  Object.assign(data.films[0], { title: '纸上地平线', originalTitle: 'The Paper Horizon' });
  const parsed = ReleaseSchema.parse(data);
  expect(parsed.films[0]).toMatchObject({ title: '纸上地平线', originalTitle: 'The Paper Horizon' });
  expect(parsed.films[3]).not.toHaveProperty('originalTitle');
});

test('allows the same rating source for different films', () => {
  const data = release();
  data.ratings.push({ ...data.ratings[0], filmId: data.films[1].id });
  expect(ReleaseSchema.parse(data).ratings).toHaveLength(3);
});

test('allows observations on the issue date after a later collection fails that day', () => {
  const data = release();
  data.listings.find((listing) => listing.airlineCode === 'A3')!.observedAt = data.issue;
  expect(ReleaseSchema.parse(data).collections[2].status).toBe('failed');
});

test('pairs a UTC observation date with a fetch timestamp on the next local date', () => {
  const data = release();
  data.issue = '2026-10-29';
  data.ratings[0].fetchedAt = '2026-10-30T00:30:00+08:00';
  const parsed = ReleaseSchema.parse(data);
  expect(parsed.listings[0].observedAt).toBe('2026-10-29');
  expect(parsed.ratings[0].fetchedAt).toBe(data.ratings[0].fetchedAt);
});

test.each(['partial', 'failed'] as const)('allows a %s collection without available listings', (status) => {
  const data = release();
  data.airlines = [data.airlines[0]];
  data.collections = [{ airlineCode: data.airlines[0].code, status }];
  data.films = [];
  data.listings = [];
  data.ratings = [];
  expect(ReleaseSchema.parse(data).collections[0].status).toBe(status);
});

test.each([
  '2026-10-30T23:59:59.999Z',
  '2026-10-31T01:59:59.999+02:00',
])('accepts fetch time %s within the UTC issue date', (fetchedAt) => {
  const data = release();
  data.ratings[0].fetchedAt = fetchedAt;
  expect(ReleaseSchema.parse(data).ratings[0].fetchedAt).toBe(fetchedAt);
});

type InvalidCase = [string, (data: Release) => void, (string | number)[]];
const invalidCases: InvalidCase[] = [
  ['fully empty release', (r) => {
    Object.assign(r, { airlines: [], collections: [], films: [], listings: [], ratings: [] });
  }, ['airlines']],
  ['successful airline without listings', (r) => {
    r.listings = r.listings.filter((listing) => listing.airlineCode !== 'A1');
    r.films = r.films.filter((film) => r.listings.some((listing) => listing.filmId === film.id));
  }, ['collections', 0, 'status']],
  ['all successful airlines without data', (r) => {
    r.collections.forEach((collection) => { collection.status = 'success'; });
    r.films = [];
    r.listings = [];
    r.ratings = [];
  }, ['collections', 0, 'status']],
  ['unsupported schema version', (r) => { Object.assign(r, { schemaVersion: 1 }); }, ['schemaVersion']],
  ['invalid issue date', (r) => { r.issue = '2026-02-30'; }, ['issue']],
  ['missing required collection data', (r) => { Reflect.deleteProperty(r, 'collections'); }, ['collections']],
  ['unknown release field', (r) => { Object.assign(r, { privateData: 'synthetic' }); }, []],
  ['invalid airline code', (r) => { r.airlines[0].code = 'aaa'; }, ['airlines', 0, 'code']],
  ['blank airline name', (r) => { r.airlines[0].name = ' '; }, ['airlines', 0, 'name']],
  ['blank film ID', (r) => { r.films[0].id = ''; }, ['films', 0, 'id']],
  ['film ID containing whitespace', (r) => {
    const oldId = r.films[0].id;
    r.films[0].id += ' ';
    r.listings.filter((listing) => listing.filmId === oldId).forEach((listing) => { listing.filmId += ' '; });
    r.ratings.filter((rating) => rating.filmId === oldId).forEach((rating) => { rating.filmId += ' '; });
  }, ['films', 0, 'id']],
  ['blank original title', (r) => { Object.assign(r.films[0], { originalTitle: ' ' }); }, ['films', 0, 'originalTitle']],
  ['invalid year', (r) => { r.films[0].year = 2001.5; }, ['films', 0, 'year']],
  ['v1 confidence field', (r) => { Object.assign(r.films[0], { matchConfidence: 'high' }); }, ['films', 0]],
  ['invalid match status', (r) => { Object.assign(r.films[0], { match: { status: 'high' } }); }, ['films', 0, 'match', 'status']],
  ['unconfirmed film without a reason', (r) => { Object.assign(r.films[3], { match: { status: 'unconfirmed' } }); }, ['films', 3, 'match', 'reason']],
  ['unconfirmed film with enrichment', (r) => { r.films[3].posterPath = '/synthetic.jpg'; }, ['films', 3, 'posterPath']],
  ['unconfirmed film with a year', (r) => { r.films[2].year = 2001; }, ['films', 2, 'year']],
  ['poster stored as a full URL', (r) => { r.films[0].posterPath = 'https://image.example/p.jpg'; }, ['films', 0, 'posterPath']],
  ['trailer on an unknown host', (r) => { r.films[0].trailerUrl = 'http://video.example/1'; }, ['films', 0, 'trailerUrl']],
  ['empty director list', (r) => { r.films[0].directors = []; }, ['films', 0, 'directors']],
  ['invalid Rotten Tomatoes ID', (r) => { r.films[0].externalIds.rottenTomatoesId = 'the_paper_horizon'; }, ['films', 0, 'externalIds', 'rottenTomatoesId']],
  ['invalid Metacritic ID', (r) => { r.films[0].externalIds.metacriticId = 'the-paper-horizon'; }, ['films', 0, 'externalIds', 'metacriticId']],
  ['invalid TMDb ID', (r) => { r.films[0].externalIds.tmdbId = 0; }, ['films', 0, 'externalIds', 'tmdbId']],
  ['awards fetched after the issue date', (r) => { r.films[0].awards!.fetchedAt = '2026-10-31T00:00:00Z'; }, ['films', 0, 'awards', 'fetchedAt']],
  ['invalid catalogue month', (r) => { r.listings[0].catalogMonth = '2026-13'; }, ['listings', 0, 'catalogMonth']],
  ['rating obtained from a non-public source', (r) => { Object.assign(r.ratings[0], { via: 'imdb-file' }); }, ['ratings', 0, 'via']],
  ['rating without an acquisition source', (r) => { Reflect.deleteProperty(r.ratings[0], 'via'); }, ['ratings', 0, 'via']],
  ['rating dated after the issue date', (r) => { r.ratings[1].ratedOn = '2026-10-31'; }, ['ratings', 1, 'ratedOn']],
  ['invalid IMDb ID', (r) => { r.films[0].externalIds.imdbId = '9000001'; }, ['films', 0, 'externalIds', 'imdbId']],
  ['invalid Wikidata ID', (r) => { r.films[0].externalIds.wikidataId = 'q900000001'; }, ['films', 0, 'externalIds', 'wikidataId']],
  ['invalid Douban ID', (r) => { r.films[0].externalIds.doubanId = 'not-an-id'; }, ['films', 0, 'externalIds', 'doubanId']],
  ['confirmed film without a TMDb ID', (r) => { r.films[0].externalIds = {}; }, ['films', 0, 'externalIds', 'tmdbId']],
  ['unconfirmed film with IDs', (r) => { r.films[3].externalIds = r.films[0].externalIds; }, ['films', 3, 'externalIds']],
  ['extra film field', (r) => { Object.assign(r.films[0], { synopsis: 'Synthetic prose' }); }, ['films', 0]],
  ['invalid observation date', (r) => { r.listings[0].observedAt = '2026-13-01'; }, ['listings', 0, 'observedAt']],
  ['observation after the issue date', (r) => { r.listings[0].observedAt = '2026-10-31'; }, ['listings', 0, 'observedAt']],
  ['blank raw title', (r) => { r.listings[0].rawTitle = ' '; }, ['listings', 0, 'rawTitle']],
  ['string New marker', (r) => { Object.assign(r.listings[0], { nativeNew: 'true' }); }, ['listings', 0, 'nativeNew']],
  ['missing New marker', (r) => { Reflect.deleteProperty(r.listings[0], 'nativeNew'); }, ['listings', 0, 'nativeNew']],
  ['missing rating source', (r) => { Reflect.deleteProperty(r.ratings[0], 'source'); }, ['ratings', 0, 'source']],
  ['uppercase rating source', (r) => { r.ratings[0].source = r.ratings[0].source.toUpperCase(); }, ['ratings', 0, 'source']],
  ['padded rating source', (r) => { r.ratings[0].source += ' '; }, ['ratings', 0, 'source']],
  ['line break in rating source', (r) => { r.ratings[0].source += '\n'; }, ['ratings', 0, 'source']],
  ['tab in rating source', (r) => { r.ratings[0].source += '\t'; }, ['ratings', 0, 'source']],
  ['null rating', (r) => { Object.assign(r.ratings[0], { value: null }); }, ['ratings', 0, 'value']],
  ['non-finite rating', (r) => { r.ratings[0].value = Infinity; }, ['ratings', 0, 'value']],
  ['score above its scale', (r) => { r.ratings[0].value = 11; }, ['ratings', 0, 'value']],
  ['score below its scale', (r) => { r.ratings[0].value = -1; }, ['ratings', 0, 'value']],
  ['empty scale', (r) => { r.ratings[0].scale.max = 0; }, ['ratings', 0, 'scale']],
  ['reversed scale', (r) => { r.ratings[0].scale.min = 20; }, ['ratings', 0, 'scale']],
  ['negative votes', (r) => { r.ratings[0].votes = -1; }, ['ratings', 0, 'votes']],
  ['fractional votes', (r) => { r.ratings[0].votes = 1.5; }, ['ratings', 0, 'votes']],
  ['unqualified fetch time', (r) => { r.ratings[0].fetchedAt = '2026-10-29T08:00:00'; }, ['ratings', 0, 'fetchedAt']],
  ['invalid fetch date', (r) => { r.ratings[0].fetchedAt = '2026-02-30T08:00:00Z'; }, ['ratings', 0, 'fetchedAt']],
  ['fetch on the next UTC date', (r) => { r.ratings[0].fetchedAt = '2026-10-31T00:00:00Z'; }, ['ratings', 0, 'fetchedAt']],
  ['fetch offset crossing into the next UTC date', (r) => { r.ratings[0].fetchedAt = '2026-10-30T23:30:00-01:00'; }, ['ratings', 0, 'fetchedAt']],
  ['duplicate airline', (r) => { r.airlines.push(r.airlines[0]); }, ['airlines', 3, 'code']],
  ['duplicate film ID', (r) => { r.films[1].id = r.films[0].id; }, ['films', 1, 'id']],
  ['duplicate listing', (r) => { r.listings.push({ ...r.listings[0] }); }, ['listings', 6, 'filmId']],
  ['conflicting New marker for the same listing', (r) => { r.listings.push({ ...r.listings[0], nativeNew: false }); }, ['listings', 6, 'filmId']],
  ['duplicate listing with a different date', (r) => { r.listings.push({ ...r.listings[0], observedAt: '2026-10-28' }); }, ['listings', 6, 'filmId']],
  ['duplicate rating', (r) => { r.ratings.push({ ...r.ratings[0] }); }, ['ratings', 2, 'source']],
  ['conflicting score from the same source', (r) => { r.ratings.push({ ...r.ratings[0], value: 1 }); }, ['ratings', 2, 'source']],
  ['unlisted film', (r) => { r.films.push({ ...r.films[3], id: 'film-0005' }); }, ['films', 4, 'id']],
  ['rated film without listings', (r) => { r.listings = r.listings.filter((listing) => listing.filmId !== r.films[0].id); }, ['films', 0, 'id']],
  ['listing for unknown airline', (r) => { r.listings[0].airlineCode = 'ZZ'; }, ['listings', 0, 'airlineCode']],
  ['listing for unknown film', (r) => { r.listings[0].filmId = 'unknown'; }, ['listings', 0, 'filmId']],
  ['rating for unknown film', (r) => { r.ratings[0].filmId = 'unknown'; }, ['ratings', 0, 'filmId']],
  ['rating for a film with close candidates', (r) => { r.ratings[0].filmId = r.films[2].id; }, ['ratings', 0, 'filmId']],
  ['rating for an unconfirmed film', (r) => { r.ratings[0].filmId = r.films[3].id; }, ['ratings', 0, 'filmId']],
  ['unknown collection status', (r) => { Object.assign(r.collections[0], { status: 'pending' }); }, ['collections', 0, 'status']],
  ['collection for unknown airline', (r) => { r.collections[0].airlineCode = 'ZZ'; }, ['collections', 0, 'airlineCode']],
  ['duplicate collection status', (r) => { r.collections.push(r.collections[0]); }, ['collections', 3, 'airlineCode']],
  ['airline without collection status', (r) => { r.collections.pop(); }, ['collections']],
];

describe('rejects invalid releases at the relevant field', () => {
  test.each(invalidCases)('%s', (_name, mutate, path) => {
    const data = release();
    mutate(data);
    const result = ReleaseSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path);
    }
  });
});
