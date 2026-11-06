import type { Film, Rating, Release } from '../../../shared/schema.ts';

export interface RatingView {
  source: string;
  label: string;
  display: string;
  value: number;
  scale: { min: number; max: number };
  votes?: number;
  ratedOn?: string;
  fetchedOn: string;
}

export interface AirlineEntry {
  code: string;
  name: string;
  rawTitle: string;
  observedAt: string;
  audioLanguages?: string[];
}

export interface FilmLink {
  label: string;
  href: string;
  // `search` links open a search page because no confirmed ID is known.
  kind: 'page' | 'search';
}

export interface AlternateTitle {
  text: string;
  // Latin-script titles are set in italics; CJK titles never are.
  latin: boolean;
}

export interface FilmView {
  id: string;
  title: string;
  alternateTitles: AlternateTitle[];
  confirmed: boolean;
  unconfirmedReason?: string;
  year?: number;
  runtime?: number;
  directors: string[];
  cast: string[];
  genres: string[];
  language?: string;
  posterPath?: string;
  overview?: Film['overview'];
  trailerUrl?: string;
  awards?: Film['awards'];
  airlines: AirlineEntry[];
  // One sentence per airline whose statement differs from the confirmed film's data.
  differences: string[];
  ratings: RatingView[];
  links: FilmLink[];
}

const ratingLabels: Record<string, string> = {
  tmdb: 'TMDb',
  'rotten-tomatoes-tomatometer': '烂番茄',
  'rotten-tomatoes-average': '烂番茄均分',
  'metacritic-metascore': 'Metacritic',
};

export const ratingLabel = (source: string) => ratingLabels[source] ?? source;

// Shows each score on its own scale; nothing is combined into an overall score.
export function formatScore(rating: Pick<Rating, 'source' | 'value' | 'scale'>): string {
  if (rating.source === 'rotten-tomatoes-tomatometer') return `${Math.round(rating.value)}%`;
  if (rating.scale.max === 100) return String(Math.round(rating.value));
  return rating.value.toFixed(1);
}

const languageNames = new Intl.DisplayNames(['zh-Hans'], { type: 'language', fallback: 'none' });
export const languageLabel = (code: string | undefined) => (code ? languageNames.of(code) : undefined);

const searchQuery = (film: Film, year: number | undefined) =>
  encodeURIComponent([film.originalTitle ?? film.title, year].filter(Boolean).join(' '));

function links(film: Film, year: number | undefined): FilmLink[] {
  const ids = film.externalIds;
  const query = searchQuery(film, year);
  const result: FilmLink[] = [];
  result.push(ids.doubanId
    ? { label: '豆瓣', href: `https://movie.douban.com/subject/${ids.doubanId}/`, kind: 'page' }
    : { label: '豆瓣', href: `https://search.douban.com/movie/subject_search?search_text=${query}`, kind: 'search' });
  if (ids.imdbId) result.push({ label: 'IMDb', href: `https://www.imdb.com/title/${ids.imdbId}/`, kind: 'page' });
  if (ids.rottenTomatoesId) result.push({ label: '烂番茄', href: `https://www.rottentomatoes.com/${ids.rottenTomatoesId}`, kind: 'page' });
  if (ids.metacriticId) result.push({ label: 'Metacritic', href: `https://www.metacritic.com/${ids.metacriticId}`, kind: 'page' });
  result.push(ids.letterboxdId && !ids.letterboxdId.startsWith('film:')
    ? { label: 'Letterboxd', href: `https://letterboxd.com/film/${ids.letterboxdId}/`, kind: 'page' }
    : { label: 'Letterboxd', href: `https://letterboxd.com/search/films/${query}/`, kind: 'search' });
  if (ids.tmdbId) result.push({ label: 'TMDb', href: `https://www.themoviedb.org/movie/${ids.tmdbId}`, kind: 'page' });
  result.push({ label: 'Google', href: `https://www.google.com/search?q=${query}%20film`, kind: 'search' });
  return result;
}

const latinOnly = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]+$/u;
const alternates = (values: (string | undefined)[], exclude: string): AlternateTitle[] =>
  [...new Set(values.filter((value): value is string => Boolean(value && value !== exclude)))]
    .map((text) => ({ text, latin: latinOnly.test(text) }));

export function buildFilmViews(release: Release): FilmView[] {
  const airlineNames = new Map(release.airlines.map((airline) => [airline.code, airline.name]));
  return release.films.map((film) => {
    const listings = release.listings.filter((listing) => listing.filmId === film.id);
    const confirmed = film.match.status === 'confirmed';
    // Unconfirmed films show only what the airline itself published.
    const statement = listings[0];
    const year = confirmed ? film.year : statement?.year;
    return {
      id: film.id,
      title: film.title,
      alternateTitles: alternates([film.originalTitle, film.englishTitle], film.title),
      confirmed,
      unconfirmedReason: film.match.status === 'unconfirmed' ? film.match.reason : undefined,
      year,
      runtime: confirmed ? film.runtime : statement?.runtime,
      directors: (confirmed ? film.directors : statement?.directors) ?? [],
      cast: (confirmed ? film.cast : statement?.cast) ?? [],
      genres: film.genres ?? [],
      language: film.originalLanguage,
      posterPath: film.posterPath,
      overview: film.overview,
      trailerUrl: film.trailerUrl,
      awards: film.awards,
      airlines: listings.map((listing) => ({
        code: listing.airlineCode,
        name: airlineNames.get(listing.airlineCode) ?? listing.airlineCode,
        rawTitle: listing.rawTitle,
        observedAt: listing.observedAt,
        audioLanguages: listing.audioLanguages,
      })),
      differences: confirmed ? listings.filter((listing) => listing.differsOn?.includes('directors') && listing.directors)
        .map((listing) => `${airlineNames.get(listing.airlineCode) ?? listing.airlineCode}片单写的导演是 ${listing.directors!.join('、')}，`
          + `TMDb 资料为 ${(film.directors ?? ['未知']).join('、')}`) : [],
      ratings: release.ratings.filter((rating) => rating.filmId === film.id).map((rating) => ({
        source: rating.source,
        label: ratingLabel(rating.source),
        display: formatScore(rating),
        value: rating.value,
        scale: rating.scale,
        votes: rating.votes,
        ratedOn: rating.ratedOn,
        fetchedOn: rating.fetchedAt.slice(0, 10),
      })),
      links: links(film, year),
    };
  });
}
