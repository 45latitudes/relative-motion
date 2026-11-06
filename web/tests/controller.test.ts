import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ReleaseSchema, type Release } from '../../shared/schema.ts';
import { selectFilms, shownRating } from '../src/catalog/controller.ts';
import { buildFilmViews, formatScore, languageLabel } from '../src/catalog/view.ts';

// Synthetic release; no real titles, IDs or scores.
const release = (): Release => ReleaseSchema.parse(JSON.parse(readFileSync(
  new URL('../../fixtures/release.sample.json', import.meta.url), 'utf8')));
const ids = (films: { id: string }[]) => films.map((film) => film.id);

test('shows every airline by default and combines selected airlines as a union', () => {
  const films = buildFilmViews(release());
  expect(selectFilms(films, { airlines: [], sort: 'year' })).toHaveLength(4);
  expect(ids(selectFilms(films, { airlines: ['A3'], sort: 'year' }))).toEqual(['film-0002']);
  expect(ids(selectFilms(films, { airlines: ['A2', 'A3'], sort: 'year' })).sort())
    .toEqual(['film-0001', 'film-0002', 'film-0003']);
});

test('sorts by the chosen value and always puts missing values last', () => {
  const films = buildFilmViews(release());
  expect(ids(selectFilms(films, { airlines: [], sort: 'year' }))).toEqual(['film-0002', 'film-0001', 'film-0004', 'film-0003']);
  expect(ids(selectFilms(films, { airlines: [], sort: 'tmdb' }))[0]).toBe('film-0001');
  expect(ids(selectFilms(films, { airlines: [], sort: 'airlines' })).slice(0, 2).sort()).toEqual(['film-0001', 'film-0002']);
});

test('treats a TMDb score from few votes as unrated when sorting', () => {
  const data = release();
  data.ratings.push({ ...data.ratings[0], filmId: 'film-0002', value: 9.9, votes: 3 });
  const order = ids(selectFilms(buildFilmViews(data), { airlines: [], sort: 'tmdb' }));
  expect(order.indexOf('film-0001')).toBeLessThan(order.indexOf('film-0002'));
});

test('shows unconfirmed films with airline statements, search links and no scores', () => {
  const film = buildFilmViews(release()).find((entry) => entry.id === 'film-0004')!;
  expect(film).toMatchObject({ confirmed: false, unconfirmedReason: '未召回候选', year: 1999, runtime: 97, directors: ['Dora Fictional'] });
  expect(film.ratings).toEqual([]);
  expect(film.posterPath).toBeUndefined();
  expect(film.links.every((link) => link.kind === 'search')).toBe(true);
});

test('builds platform links from confirmed IDs without doubling path prefixes', () => {
  const film = buildFilmViews(release())[0];
  const href = (label: string) => film.links.find((link) => link.label === label)?.href;
  expect(href('烂番茄')).toBe('https://www.rottentomatoes.com/m/the_paper_horizon');
  expect(href('Metacritic')).toBe('https://www.metacritic.com/movie/the-paper-horizon');
  expect(href('豆瓣')).toBe('https://movie.douban.com/subject/900000001/');
  expect(href('Letterboxd')).toBe('https://letterboxd.com/film/the-paper-horizon/');
  expect(href('Google')).toContain('The%20Paper%20Horizon%202001');
  expect(film.alternateTitles).toEqual([{ text: 'The Paper Horizon', latin: true }]);
});

test('formats scores on their own scales and names languages in Chinese', () => {
  expect(formatScore({ source: 'tmdb', value: 7.586, scale: { min: 0, max: 10 } })).toBe('7.6');
  expect(formatScore({ source: 'rotten-tomatoes-tomatometer', value: 59, scale: { min: 0, max: 100 } })).toBe('59%');
  expect(formatScore({ source: 'metacritic-metascore', value: 46, scale: { min: 0, max: 100 } })).toBe('46');
  expect(languageLabel('ko')).toBe('韩语');
  expect(languageLabel(undefined)).toBeUndefined();
});

test('describes an airline statement that differs from the confirmed film in a fixed sentence', () => {
  const data = release();
  const film = buildFilmViews(data)[0];
  expect(film.differences).toEqual([]);
  const listing = data.listings.find((entry) => entry.filmId === film.id)!;
  Object.assign(listing, { directors: ['Wrong Fictional'], differsOn: ['directors'] });
  const [text] = buildFilmViews(data)[0].differences;
  expect(text).toMatch(/^.+片单写的导演是 Wrong Fictional，TMDb 资料为 .+$/);
  expect(text).toContain(film.directors.join('、'));
});

test('searches titles across Chinese, original and airline names', () => {
  const all = buildFilmViews(release());
  const film = all[0];
  const byTitle = selectFilms(all, { airlines: [], sort: 'tmdb', query: film.title.slice(0, 2) });
  expect(ids(byTitle)).toContain(film.id);
  expect(selectFilms(all, { airlines: [], sort: 'tmdb', query: film.airlines[0].rawTitle.toUpperCase() }).map((f) => f.id)).toContain(film.id);
  expect(selectFilms(all, { airlines: [], sort: 'tmdb', query: 'no such title anywhere' })).toEqual([]);
});

test('keeps a TMDb score with an unknown vote count sortable', () => {
  const data = release();
  Reflect.deleteProperty(data.ratings[0], 'votes');
  expect(ids(selectFilms(buildFilmViews(data), { airlines: [], sort: 'tmdb' }))[0]).toBe('film-0001');
});

test('prints the sorted score on a stub, or Rotten Tomatoes, Metacritic, TMDb in that order', () => {
  const film = buildFilmViews(release()).find((entry) => entry.id === 'film-0001')!;
  const rating = (source: string, value: number) => ({ ...film.ratings[0], source, value, display: String(value) });
  const scored = { ...film, ratings: [rating('tmdb', 7.5), rating('rotten-tomatoes-tomatometer', 91), rating('metacritic-metascore', 74)] };
  expect(shownRating(scored, 'metacritic-metascore')?.source).toBe('metacritic-metascore');
  expect(shownRating(scored, 'tmdb')?.source).toBe('tmdb');
  expect(shownRating(scored, 'year')?.source).toBe('rotten-tomatoes-tomatometer');
  const noTomatometer = { ...scored, ratings: scored.ratings.filter((entry) => entry.source !== 'rotten-tomatoes-tomatometer') };
  expect(shownRating(noTomatometer, 'rotten-tomatoes-tomatometer')).toBeUndefined();
  expect(shownRating(noTomatometer, 'airlines')?.source).toBe('metacritic-metascore');
});

test('leaves a TMDb score from few votes off the stub, as it is left out of sorting', () => {
  const film = buildFilmViews(release()).find((entry) => entry.id === 'film-0001')!;
  const thin = { ...film, ratings: [{ ...film.ratings[0], source: 'tmdb', votes: 3 }] };
  expect(shownRating(thin, 'tmdb')).toBeUndefined();
  expect(shownRating(thin, 'year')).toBeUndefined();
});
