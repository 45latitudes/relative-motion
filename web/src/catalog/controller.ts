import { useMemo, useState } from 'react';
import type { Release } from '../../../shared/schema.ts';
import { buildFilmViews, type FilmView } from './view.ts';

export const sortOptions = [
  { key: 'rotten-tomatoes-tomatometer', label: '烂番茄' },
  { key: 'metacritic-metascore', label: 'Metacritic' },
  { key: 'tmdb', label: 'TMDb' },
  { key: 'year', label: '年份，新片在前' },
  { key: 'airlines', label: '收录航司数' },
] as const;
export type SortKey = (typeof sortOptions)[number]['key'];

export interface CatalogState {
  // Empty means every airline; several selected airlines combine as a union.
  airlines: string[];
  sort: SortKey;
  // Plain title search; full-field fuzzy search is planned for the next version.
  query?: string;
}

const searchKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function matchesQuery(film: FilmView, query: string): boolean {
  const key = searchKey(query);
  if (!key) return true;
  return [film.title, ...film.alternateTitles.map((alt) => alt.text), ...film.airlines.map((entry) => entry.rawTitle)]
    .some((title) => searchKey(title).includes(key));
}

// A TMDb average from a handful of votes says little; such films sort as unrated.
export const minimumTmdbVotes = 10;

// Score sources in the order the ticket prefers them.
export const scoreSources = ['rotten-tomatoes-tomatometer', 'metacritic-metascore', 'tmdb'] as const;

const fewVotes = (rating: FilmView['ratings'][number]) =>
  rating.source === 'tmdb' && rating.votes !== undefined && rating.votes < minimumTmdbVotes;

// The score printed on a stub: the source being sorted by, or else the first one the film has.
// A TMDb score from few votes counts as missing here, as it does in sorting; the ticket details
// still show it with its vote count.
export function shownRating(film: FilmView, sort: SortKey): FilmView['ratings'][number] | undefined {
  const sources: readonly string[] = (scoreSources as readonly string[]).includes(sort) ? [sort] : scoreSources;
  for (const source of sources) {
    const rating = film.ratings.find((entry) => entry.source === source);
    if (rating && !fewVotes(rating)) return rating;
  }
  return undefined;
}

function sortValue(film: FilmView, sort: SortKey): number | undefined {
  if (sort === 'year') return film.year;
  if (sort === 'airlines') return film.airlines.length;
  const rating = film.ratings.find((entry) => entry.source === sort);
  if (!rating || fewVotes(rating)) return undefined;
  return (rating.value - rating.scale.min) / (rating.scale.max - rating.scale.min);
}

const collator = new Intl.Collator('zh-Hans-CN');

export function selectFilms(films: FilmView[], state: CatalogState): FilmView[] {
  const chosen = new Set(state.airlines);
  const visible = (chosen.size === 0 ? films
    : films.filter((film) => film.airlines.some((entry) => chosen.has(entry.code))))
    .filter((film) => matchesQuery(film, state.query ?? ''));
  return visible
    .map((film) => ({ film, value: sortValue(film, state.sort) }))
    .sort((a, b) => {
      // Missing values always go last, whatever the sort.
      if (a.value === undefined || b.value === undefined) {
        if (a.value !== b.value) return a.value === undefined ? 1 : -1;
      } else if (a.value !== b.value) return b.value - a.value;
      return collator.compare(a.film.title, b.film.title);
    })
    .map((entry) => entry.film);
}

export function airlineCounts(release: Release) {
  return release.airlines.map((airline) => ({
    ...airline,
    count: new Set(release.listings.filter((l) => l.airlineCode === airline.code).map((l) => l.filmId)).size,
  }));
}

export function latestObservation(release: Release): string | undefined {
  return release.listings.map((listing) => listing.observedAt).sort().at(-1);
}

export function useCatalogController(release: Release) {
  const [state, setState] = useState<CatalogState>({ airlines: [], sort: 'rotten-tomatoes-tomatometer', query: '' });
  const all = useMemo(() => buildFilmViews(release), [release]);
  const films = useMemo(() => selectFilms(all, state), [all, state]);
  return {
    state,
    films,
    total: all.length,
    airlines: useMemo(() => airlineCounts(release), [release]),
    observedAt: latestObservation(release),
    toggleAirline: (code: string) => setState((current) => ({
      ...current,
      airlines: current.airlines.includes(code)
        ? current.airlines.filter((item) => item !== code) : [...current.airlines, code],
    })),
    setSort: (sort: SortKey) => setState((current) => ({ ...current, sort })),
    setQuery: (query: string) => setState((current) => ({ ...current, query })),
  };
}
