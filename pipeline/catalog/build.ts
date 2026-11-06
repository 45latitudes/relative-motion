import { ExternalIdsSchema, ReleaseSchema, schemaVersion, type Film, type Listing, type Rating, type Release } from '../../shared/schema.ts';
import { chooseMovie, movieFields } from '../coverage/matching.ts';
import { awardEntries, awardItems } from './awards.ts';
import { array, number, object, string, type ObjectValue, type Row, type Sample } from '../coverage/model.ts';

// A maintainer-recorded fix for a field the airline published wrongly. The airline's
// own value stays on the listing; matching reruns on the corrected fact and still decides.
export interface AirlineCorrection {
  airline: string;
  sourceRecord: string;
  field: 'directors';
  published: string[];
  corrected: string[];
  evidence: string;
  checkedOn: string;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export function applyCorrections(row: Row, corrections: AirlineCorrection[], warnings: string[]): Row {
  const correction = corrections.find((c) => c.airline === row.sample.airline && c.sourceRecord === row.sample.sourceRecord);
  if (!correction) return row;
  if (!sameList(row.sample[correction.field], correction.published)) {
    warnings.push(`${row.sample.id}: airline value changed since the correction was recorded; correction skipped`);
    return row;
  }
  const sample: Sample = { ...row.sample, [correction.field]: correction.corrected };
  const result = chooseMovie(sample, array(row.details.tmdbCandidates), row.details.tmdbSearchTruncated === true);
  if (result.decision !== 'confirmed' || !result.movie) {
    warnings.push(`${row.sample.id}: still unconfirmed after correction (${result.match.reason})`);
    return { ...row, fields: { ...row.fields, tmdbMatch: result.match } };
  }
  return {
    ...row,
    fields: { ...row.fields, tmdbMatch: result.match, wikidataMatch: { status: 'untested', reason: '' } },
    details: { ...row.details, identity: 'confirmed', tmdb: movieFields(result.movie).details, wikidata: undefined, corrected: [correction.field] },
  };
}

// Airline fields that disagree with the confirmed film: corrected ones, and a director conflict the match waived.
export function differsOn(row: Row): Listing['differsOn'] {
  if (row.details.identity !== 'confirmed') return undefined;
  const movieId = object(object(row.details.tmdb).movie).id;
  const chosen = array(object(row.details.matchAudit).candidates).map(object).find((c) => c.id === movieId);
  const fields = [...array(row.details.corrected), ...array(chosen?.waived)].map(string)
    .map((field) => field === 'director' ? 'directors' : field).filter((field) => field === 'directors');
  return fields.length ? ['directors'] : undefined;
}

export const airlineNames: Record<string, string> = {
  CA: '中国国际航空',
  CI: '中华航空',
  UA: '美国联合航空',
};

// IMDb-published scores belong to the personal layer (DESIGN), even when Wikidata mirrors them.
const withheldRatingSources = new Set(['imdb-weighted-average']);

const tmdbGenres: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 99: '纪录', 18: '剧情', 10751: '家庭',
  14: '奇幻', 36: '历史', 27: '恐怖', 10402: '音乐', 9648: '悬疑', 10749: '爱情', 878: '科幻',
  10770: '电视电影', 53: '惊悚', 10752: '战争', 37: '西部',
};

const han = /\p{Script=Han}/u;
const nonEmpty = (values: string[]) => {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length > 0 ? unique : undefined;
};

export interface FetchTimes {
  tmdbMovie(id: number): string | undefined;
  wikidataEntity(id: string): string | undefined;
}

// Indexes cached responses so each exported field can carry the time its source was read.
export function fetchTimesFrom(records: { url: string; fetchedAt: string; status: number }[]): FetchTimes {
  const tmdb = new Map<number, string>();
  const wikidata = new Map<string, string>();
  const keepLatest = <K>(map: Map<K, string>, key: K, at: string) => {
    const known = map.get(key);
    if (!known || Date.parse(at) > Date.parse(known)) map.set(key, at);
  };
  for (const record of records) {
    if (record.status !== 200 || Number.isNaN(Date.parse(record.fetchedAt))) continue;
    const url = new URL(record.url);
    const movie = url.hostname === 'api.themoviedb.org' && /^\/3\/movie\/(\d+)$/.exec(url.pathname);
    if (movie) keepLatest(tmdb, Number(movie[1]), record.fetchedAt);
    if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
      for (const id of (url.searchParams.get('ids') ?? '').split('|')) keepLatest(wikidata, id, record.fetchedAt);
    }
  }
  return { tmdbMovie: (id) => tmdb.get(id), wikidataEntity: (id) => wikidata.get(id) };
}

function translation(movie: ObjectValue, language: string, region: string) {
  const entry = array(object(movie.translations).translations).map(object)
    .find((item) => item.iso_639_1 === language && item.iso_3166_1 === region);
  return object(entry?.data);
}

function chineseTitle(movie: ObjectValue, row: Row): string | undefined {
  const regional = (region: string) => string(translation(movie, 'zh', region).title).trim();
  const original = string(movie.original_title);
  const originalIsChinese = ['zh', 'cn'].includes(string(movie.original_language)) && han.test(original);
  // The airline's own Chinese title comes first (owner decision 2026-11-05), then TMDb's.
  const candidates = [
    ...[row.sample.title, ...row.sample.aliases].filter((title) => han.test(title)),
    regional('CN'), regional('SG'), originalIsChinese ? original : '', regional('TW'), regional('HK'),
  ];
  return candidates.find((title) => title.trim().length > 0);
}

function overview(movie: ObjectValue): Film['overview'] {
  for (const [region, language] of [['CN', 'zh-CN'], ['SG', 'zh-SG'], ['TW', 'zh-TW'], ['HK', 'zh-HK']] as const) {
    const text = string(translation(movie, 'zh', region).overview).trim();
    if (text) return { text, language };
  }
  const english = string(movie.overview).trim();
  return english ? { text: english, language: 'en' } : undefined;
}

function externalIds(movie: ObjectValue, wikidata: ObjectValue | undefined, warnings: string[], filmId: string) {
  const ids = object(wikidata?.ids);
  const tmdbImdb = string(object(movie.external_ids).imdb_id);
  const wikidataImdb = string(ids.imdbId);
  // A disagreement between sources means the Wikidata link cannot be trusted for this film.
  const trustWikidata = wikidata !== undefined && !(tmdbImdb && wikidataImdb && tmdbImdb !== wikidataImdb);
  if (wikidata && !trustWikidata) warnings.push(`${filmId}: TMDb and Wikidata IMDb IDs differ; Wikidata data dropped`);
  const candidate: Record<string, unknown> = {
    tmdbId: number(movie.id),
    imdbId: tmdbImdb || (trustWikidata ? wikidataImdb : '') || undefined,
    ...(trustWikidata ? {
      wikidataId: string(object(wikidata.entity).id) || undefined,
      doubanId: string(ids.doubanId) || undefined,
      rottenTomatoesId: string(ids.rottenTomatoesId) || undefined,
      metacriticId: string(ids.metacriticId) || undefined,
      letterboxdId: string(ids.letterboxdId) || undefined,
    } : {}),
  };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    const field = ExternalIdsSchema.shape[key as keyof typeof ExternalIdsSchema.shape];
    if (field.safeParse(value).success) result[key] = value;
    else warnings.push(`${filmId}: dropped malformed ${key}`);
  }
  return { ids: result as Film['externalIds'], trustWikidata };
}

function confirmedFilm(row: Row, filmId: string, times: FetchTimes, warnings: string[], awardLabels: Record<string, string>) {
  const tmdb = object(row.details.tmdb);
  const movie = object(tmdb.movie);
  // T-05 flags conflicting external IDs on the linked entity; such links are not exported.
  const wikidataHit = row.fields.wikidataMatch?.status === 'hit' && !row.details.idConflict
    ? object(row.details.wikidata) : undefined;
  if (row.details.idConflict) warnings.push(`${filmId}: Wikidata external IDs conflict; Wikidata data dropped`);
  const { ids, trustWikidata } = externalIds(movie, wikidataHit, warnings, filmId);
  const wikidata = trustWikidata ? wikidataHit : undefined;
  const credits = object(movie.credits);
  const year = Number.parseInt(string(movie.release_date).slice(0, 4), 10);
  const runtime = number(movie.runtime);
  const language = string(movie.original_language);
  const trailer = string(tmdb.trailerUrl);
  const posterPath = string(movie.poster_path);
  const wikidataFetchedAt = ids.wikidataId ? times.wikidataEntity(ids.wikidataId) : undefined;
  const englishTitle = string(movie.title).trim();
  const film: Film = {
    id: filmId,
    title: chineseTitle(movie, row) ?? (englishTitle || row.sample.title),
    match: { status: 'confirmed' },
    externalIds: ids,
    originalTitle: string(movie.original_title).trim() || undefined,
    englishTitle: englishTitle || undefined,
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    runtime: runtime && runtime > 0 ? runtime : undefined,
    directors: nonEmpty(array(credits.crew).map(object).filter((c) => c.job === 'Director').map((c) => string(c.name))),
    cast: nonEmpty(array(credits.cast).map(object)
      .sort((a, b) => (number(a.order) ?? 0) - (number(b.order) ?? 0)).slice(0, 4).map((c) => string(c.name))),
    genres: nonEmpty(array(movie.genres).map(object).map((g) => tmdbGenres[number(g.id) ?? -1] ?? '')),
    // TMDb uses the non-standard `cn` for Cantonese; `xx` means no language.
    originalLanguage: language === 'cn' ? 'yue' : /^[a-z]{2,3}$/.test(language) && language !== 'xx' ? language : undefined,
    posterPath: /^\/[\w-]+\.(?:jpg|png)$/.test(posterPath) ? posterPath : undefined,
    overview: overview(movie),
    trailerUrl: /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]+|vimeo\.com\/\d+)$/.test(trailer) ? trailer : undefined,
    awards: wikidata && wikidataFetchedAt ? {
      wins: array(wikidata.awards).length,
      nominations: array(wikidata.nominations).length,
      fetchedAt: wikidataFetchedAt,
      ...(() => {
        const { items, unnamed } = awardItems(awardEntries(wikidata), awardLabels);
        return { items: items.length ? items : undefined, unnamed: items.length && unnamed ? unnamed : undefined };
      })(),
    } : undefined,
  };
  if (wikidata && !wikidataFetchedAt) warnings.push(`${filmId}: no cached read time for ${ids.wikidataId ?? 'Wikidata entity'}; awards and Wikidata scores dropped`);
  const ratings: Rating[] = [];
  const tmdbFetchedAt = ids.tmdbId ? times.tmdbMovie(ids.tmdbId) : undefined;
  if (!tmdbFetchedAt) warnings.push(`${filmId}: no cached read time for TMDb movie; TMDb score dropped`);
  const votes = number(movie.vote_count) ?? 0;
  const average = number(movie.vote_average);
  if (tmdbFetchedAt && votes > 0 && average !== undefined) {
    ratings.push({ filmId, source: 'tmdb', via: 'tmdb', value: average, scale: { min: 0, max: 10 }, votes, fetchedAt: tmdbFetchedAt });
  }
  if (wikidata && wikidataFetchedAt) {
    for (const selected of array(object(wikidata.ratings).selected).map(object)) {
      const source = string(selected.source);
      const value = number(selected.value);
      const max = number(selected.max);
      if (!source || withheldRatingSources.has(source) || value === undefined || max === undefined) continue;
      const ratedOn = /^\d{4}-\d{2}-\d{2}$/.test(string(selected.date)) ? string(selected.date) : undefined;
      const selectedVotes = number(selected.votes);
      ratings.push({
        filmId, source, via: 'wikidata', value, scale: { min: 0, max },
        ...(selectedVotes !== undefined ? { votes: selectedVotes } : {}),
        ...(ratedOn ? { ratedOn } : {}),
        fetchedAt: wikidataFetchedAt,
      });
    }
  }
  return { film: stripUndefined(film), ratings };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function listing(row: Row, filmId: string): Listing {
  const { sample } = row;
  return stripUndefined({
    airlineCode: sample.airline,
    filmId,
    observedAt: sample.observedAt.slice(0, 10),
    nativeNew: null,
    rawTitle: sample.title,
    year: sample.year,
    runtime: sample.runtime,
    directors: nonEmpty(sample.directors),
    cast: nonEmpty(sample.cast ?? []),
    audioLanguages: nonEmpty(sample.audioLanguages ?? []),
  });
}

export interface ReleaseOptions {
  corrections?: AirlineCorrection[];
  // Stable film ID for a row once its (corrected) match is known; defaults to the sample ID.
  filmIdOf?: (row: Row) => string;
  // Names of award and recipient items, by Wikidata ID (see scripts/award-labels.ts).
  awardLabels?: Record<string, string>;
  // Catalogue month the airline stated for the row's observation.
  catalogMonthOf?: (row: Row) => string | undefined;
  // Latest collection status per airline; defaults to `partial`.
  collectionOf?: (airline: string) => 'success' | 'partial' | 'failed';
}

// Turns matched rows into a schema v2 release. Rows sharing a film ID become one film with several listings.
export function buildRelease(rows: Row[], today: string, times: FetchTimes, options: ReleaseOptions = {}) {
  // Observation dates are local; never let the UTC issue date fall before them.
  const issue = [today, ...rows.map((row) => row.sample.observedAt.slice(0, 10))].sort().at(-1)!;
  const warnings: string[] = [];
  const films = new Map<string, Film>();
  const ratings: Rating[] = [];
  const listings = new Map<string, Listing>();
  for (const original of rows) {
    const row = applyCorrections(original, options.corrections ?? [], warnings);
    const filmId = options.filmIdOf?.(row) ?? row.sample.id;
    if (!airlineNames[row.sample.airline]) throw new Error(`Unknown airline ${row.sample.airline}`);
    if (!films.has(filmId)) {
      if (row.details.identity === 'confirmed') {
        const built = confirmedFilm(row, filmId, times, warnings, options.awardLabels ?? {});
        films.set(filmId, built.film);
        ratings.push(...built.ratings);
      } else {
        films.set(filmId, {
          id: filmId,
          title: row.sample.title,
          match: { status: 'unconfirmed', reason: row.fields.tmdbMatch?.reason.trim() || '未确认' },
          externalIds: {},
        });
      }
    }
    // The listing keeps what the airline published, not the correction; one per airline and film.
    const key = `${row.sample.airline}|${filmId}`;
    if (!listings.has(key)) {
      const month = options.catalogMonthOf?.(original);
      const differs = differsOn(row);
      listings.set(key, { ...listing(original, filmId), ...(month ? { catalogMonth: month } : {}), ...(differs ? { differsOn: differs } : {}) });
    }
  }
  const codes = [...new Set([...listings.values()].map((entry) => entry.airlineCode))].sort();
  const release: Release = {
    schemaVersion,
    issue,
    airlines: codes.map((code) => ({ code, name: airlineNames[code]! })),
    films: [...films.values()],
    listings: [...listings.values()],
    ratings,
    collections: codes.map((code) => ({ airlineCode: code, status: options.collectionOf?.(code) ?? 'partial' })),
  };
  return { release: ReleaseSchema.parse(release), warnings };
}
