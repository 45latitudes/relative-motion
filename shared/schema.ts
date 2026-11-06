import { z } from 'zod';

export const schemaVersion = 2 as const;

// Acquisition sources allowed in public releases. Anything else must fail validation.
export const publicSources = ['tmdb', 'wikidata'] as const;

const text = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const filmId = text.refine((value) => !/\s/u.test(value), 'Film IDs must not contain whitespace');
const airlineCode = z.string().regex(/^[A-Z0-9]{2}$/);
const timestamp = z.iso.datetime({ offset: true });
const names = z.array(text).min(1);

export const AirlineSchema = z.strictObject({
  code: airlineCode,
  name: text,
});

export const ExternalIdsSchema = z.strictObject({
  tmdbId: z.number().int().positive().optional(),
  imdbId: z.string().regex(/^tt\d{7,}$/).optional(),
  wikidataId: z.string().regex(/^Q[1-9]\d*$/).optional(),
  doubanId: z.string().regex(/^[1-9]\d*$/).optional(),
  rottenTomatoesId: z.string().regex(/^m\/[\w-]+$/).optional(),
  metacriticId: z.string().regex(/^movie\/[\w-]+$/).optional(),
  letterboxdId: z.string().regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|film:\d+)$/).optional(),
});

export const MatchSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('confirmed') }),
  z.strictObject({ status: z.literal('unconfirmed'), reason: text }),
]);

// Fields that only a confirmed match may carry; airline statements live on listings.
const enrichmentKeys = [
  'originalTitle', 'englishTitle', 'year', 'runtime', 'directors', 'cast', 'genres',
  'originalLanguage', 'posterPath', 'overview', 'trailerUrl', 'awards',
] as const;

export const FilmSchema = z.strictObject({
  // Assigned locally once and reused across releases; never derived from a title or external ID.
  id: filmId,
  // Display title: a Chinese title when the match provides one, otherwise the airline's raw title.
  title: text,
  match: MatchSchema,
  externalIds: ExternalIdsSchema,
  originalTitle: text.optional(),
  englishTitle: text.optional(),
  year: z.number().int().min(1).max(9999).optional(),
  runtime: z.number().int().positive().optional(),
  directors: names.optional(),
  cast: names.optional(),
  genres: names.optional(),
  originalLanguage: z.string().regex(/^[a-z]{2,3}$/).optional(),
  // TMDb image path; the page builds the external CDN URL and never stores image files.
  posterPath: z.string().regex(/^\/[\w-]+\.(?:jpg|png)$/).optional(),
  overview: z.strictObject({ text, language: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/) }).optional(),
  trailerUrl: z.string().regex(/^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]+|vimeo\.com\/\d+)$/).optional(),
  // Counts of Wikidata award (P166) and nomination (P1411) statements at fetch time, and the
  // awards whose names could be read: name, year (P585) and named recipients (P1346).
  awards: z.strictObject({
    wins: z.number().int().nonnegative(),
    nominations: z.number().int().nonnegative(),
    fetchedAt: timestamp,
    items: z.array(z.strictObject({
      kind: z.enum(['win', 'nomination']),
      award: text,
      year: z.number().int().min(1800).optional(),
      recipients: z.array(text).min(1).optional(),
    })).optional(),
    // Awards left out of `items` because their names could not be read.
    unnamed: z.number().int().nonnegative().optional(),
  }).optional(),
}).superRefine((film, ctx) => {
  const hasIds = Object.values(film.externalIds).some((id) => id !== undefined);
  if (film.match.status === 'confirmed' && film.externalIds.tmdbId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['externalIds', 'tmdbId'], message: 'Confirmed films need a TMDb ID' });
  }
  if (film.match.status === 'unconfirmed') {
    if (hasIds) {
      ctx.addIssue({ code: 'custom', path: ['externalIds'], message: 'Unconfirmed films must have no external IDs' });
    }
    for (const key of enrichmentKeys) {
      if (film[key] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Unconfirmed films carry no enrichment' });
      }
    }
  }
});

export const ListingSchema = z.strictObject({
  airlineCode,
  filmId,
  // UTC date of the retained entry's last observation, not its first appearance.
  observedAt: z.iso.date(),
  // The airline's own marker: null means unknown, false means no marker was present.
  nativeNew: z.boolean().nullable(),
  rawTitle: text,
  // Catalogue month only when the source states it; never inferred from the observation date.
  catalogMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).optional(),
  // The airline's own statements, kept as published.
  year: z.number().int().min(1).max(9999).optional(),
  runtime: z.number().int().positive().optional(),
  directors: names.optional(),
  cast: names.optional(),
  audioLanguages: names.optional(),
  // Fields the airline states differently from the confirmed film's reference data, kept when the
  // match rests on other evidence or on a recorded correction. Spelling variants are not listed.
  differsOn: z.array(z.enum(['directors'])).min(1).optional(),
});

export const RatingSchema = z.strictObject({
  filmId,
  // Stable lowercase publisher key, e.g. `tmdb` or `rotten-tomatoes-tomatometer`.
  source: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  // Where the score was obtained; restricted to public sources.
  via: z.enum(publicSources),
  value: z.number(),
  scale: z.strictObject({ min: z.number(), max: z.number() }),
  // Omit unknown vote counts. A missing score is represented by no Rating entry.
  votes: z.number().int().nonnegative().optional(),
  // Date the source attaches to the score itself; omitted when unknown.
  ratedOn: z.iso.date().optional(),
  fetchedAt: timestamp,
}).superRefine((rating, ctx) => {
  if (rating.scale.min >= rating.scale.max) {
    ctx.addIssue({ code: 'custom', path: ['scale'], message: 'Scale must have min < max' });
  }
  if (rating.value < rating.scale.min || rating.value > rating.scale.max) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Score is outside its original scale' });
  }
});

export const ReleaseSchema = z.strictObject({
  schemaVersion: z.literal(schemaVersion),
  // UTC publication date; observations and fetched scores must be no later than this day.
  issue: z.iso.date(),
  airlines: z.array(AirlineSchema).min(1),
  films: z.array(FilmSchema),
  listings: z.array(ListingSchema),
  ratings: z.array(RatingSchema),
  // Latest attempt status; retained entries may predate it, including earlier that day.
  // Publishing safety (such as count drops) requires comparison with the previous release.
  collections: z.array(z.strictObject({
    airlineCode,
    status: z.enum(['success', 'partial', 'failed']),
  })),
}).superRefine((release, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const airlines = new Set<string>();
  release.airlines.forEach((airline, index) => {
    if (airlines.has(airline.code)) issue(['airlines', index, 'code'], 'Duplicate airline code');
    airlines.add(airline.code);
  });
  const films = new Map<string, Film>();
  release.films.forEach((film, index) => {
    if (films.has(film.id)) issue(['films', index, 'id'], 'Duplicate local film ID');
    films.set(film.id, film);
  });
  const listingKeys = new Set<string>();
  const listedFilms = new Set<string>();
  const listedAirlines = new Set<string>();
  release.listings.forEach((listing, index) => {
    if (!airlines.has(listing.airlineCode)) {
      issue(['listings', index, 'airlineCode'], 'Unknown airline');
    }
    if (!films.has(listing.filmId)) issue(['listings', index, 'filmId'], 'Unknown film');
    const key = JSON.stringify([listing.airlineCode, listing.filmId]);
    if (listingKeys.has(key)) {
      issue(['listings', index, 'filmId'], 'Duplicate airline/film listing');
    }
    listingKeys.add(key);
    listedFilms.add(listing.filmId);
    listedAirlines.add(listing.airlineCode);
    if (listing.observedAt > release.issue) {
      issue(['listings', index, 'observedAt'], 'Observation is after the issue date');
    }
  });
  release.films.forEach((film, index) => {
    if (!listedFilms.has(film.id)) issue(['films', index, 'id'], 'Film has no airline listing');
  });
  const ratingKeys = new Set<string>();
  const issueEnd = Date.parse(`${release.issue}T00:00:00Z`) + 86_400_000;
  release.ratings.forEach((rating, index) => {
    const film = films.get(rating.filmId);
    if (!film) issue(['ratings', index, 'filmId'], 'Unknown film');
    else if (film.match.status !== 'confirmed') {
      issue(['ratings', index, 'filmId'], 'Scores require a confirmed match');
    }
    const key = JSON.stringify([rating.filmId, rating.source]);
    if (ratingKeys.has(key)) issue(['ratings', index, 'source'], 'Duplicate film/source rating');
    ratingKeys.add(key);
    if (Date.parse(rating.fetchedAt) >= issueEnd) {
      issue(['ratings', index, 'fetchedAt'], 'Fetch time is after the UTC issue date');
    }
    if (rating.ratedOn !== undefined && rating.ratedOn > release.issue) {
      issue(['ratings', index, 'ratedOn'], 'Rating date is after the issue date');
    }
  });
  release.films.forEach((film, index) => {
    if (film.awards && Date.parse(film.awards.fetchedAt) >= issueEnd) {
      issue(['films', index, 'awards', 'fetchedAt'], 'Fetch time is after the UTC issue date');
    }
  });
  const collected = new Set<string>();
  release.collections.forEach((collection, index) => {
    if (!airlines.has(collection.airlineCode)) {
      issue(['collections', index, 'airlineCode'], 'Unknown airline');
    }
    if (collected.has(collection.airlineCode)) {
      issue(['collections', index, 'airlineCode'], 'Duplicate collection status');
    }
    if (collection.status === 'success' && !listedAirlines.has(collection.airlineCode)) {
      issue(['collections', index, 'status'], 'Successful collection has no airline listings');
    }
    collected.add(collection.airlineCode);
  });
  release.airlines.forEach((airline) => {
    if (!collected.has(airline.code)) {
      issue(['collections'], `Missing collection status for ${airline.code}`);
    }
  });
});

export type Airline = z.infer<typeof AirlineSchema>;
export type Film = z.infer<typeof FilmSchema>;
export type Listing = z.infer<typeof ListingSchema>;
export type Rating = z.infer<typeof RatingSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
