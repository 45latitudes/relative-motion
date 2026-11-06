import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ReleaseSchema } from '../../shared/schema.ts';
import { Catalog } from '../src/Catalog.tsx';
import { MobileCatalog } from '../src/MobileCatalog.tsx';
import { buildFilmViews } from '../src/catalog/view.ts';
import { StubFace } from '../src/components/Stub.tsx';
import { StubGrid } from '../src/components/StubGrid.tsx';
import { TicketDetails } from '../src/components/TicketDetails.tsx';

// Synthetic release; no real titles, IDs or scores.
const release = ReleaseSchema.parse(JSON.parse(readFileSync(
  new URL('../../fixtures/release.sample.json', import.meta.url), 'utf8')));
const html = renderToStaticMarkup(<Catalog release={release} />);

const films = buildFilmViews(release);
const details = (id: string) => renderToStaticMarkup(<TicketDetails film={films.find((film) => film.id === id)!} />);

test('renders the films as stubs in the wall', () => {
  expect(html).toContain('A Window Without a Map');
});

test('prints the poster on the joined stub from the TMDb CDN, never from local image files', () => {
  const page = renderToStaticMarkup(<StubFace film={films[0]} sort="tmdb" joined />);
  expect(page).toContain('src="https://image.tmdb.org/t/p/w185/syntheticPaperHorizon.jpg"');
  expect(page).not.toMatch(/src="\/(?!\/)/);
});

test('keeps posters off the stubs in the wall', () => {
  expect(html).not.toContain('class="poster"');
});

test('explains unconfirmed entries and dates each score on the ticket', () => {
  expect(details('film-0004')).toContain('还没能确认是哪一部电影（未召回候选）');
  const page = details(films[0].id);
  expect(page).toContain('2026 年 9 月 1 日');
  expect(page).toContain('class="plane-icon"');
});

test('credits the data sources in the footer', () => {
  expect(html).toContain('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  expect(html).toContain('Wikidata');
});

test('notes unfinished catalogues only when a collection is not complete', () => {
  expect(html).toContain('部分片单还在匹配资料');
  const complete = { ...release, collections: release.collections.map((c) => ({ ...c, status: 'success' as const })) };
  expect(renderToStaticMarkup(<Catalog release={complete} />)).not.toContain('部分片单还在匹配资料');
});

test('lays every film out once in the tidy layout, all reachable by keyboard', () => {
  const grid = renderToStaticMarkup(<StubGrid films={films} sort="year" onPick={() => {}} />);
  expect(grid.match(/<button/g)).toHaveLength(films.length);
  expect(grid).not.toContain('aria-hidden');
  expect(grid).not.toContain('tabindex="-1"');
});

test('starts with the drifting wall and a switch for the tidy layout', () => {
  expect(html).toContain('role="switch" aria-checked="false"');
  expect(html).not.toContain('stub-grid');
});

test('prints each score date on the ticket, and says when it is unknown', () => {
  const page = details(films[0].id);
  expect(page).toContain('评分日期 2026 年 9 月 1 日');
  expect(page).toContain('评分日期未知，2026 年 10 月 29 日读取');
});

test('shows awards, airline audio tracks and a folded overview', () => {
  const page = details(films[0].id);
  expect(page).toContain('获奖 2 项 · 提名 5 项');
  expect(page).toContain('另有 7 项未能读取名称');
  expect(page).toContain('aria-expanded="false"');
  expect(page).toContain('展开简介');
  expect(details('film-0004')).toContain('音轨 English');
});

test('lays the phone layout out as rings of stubs under a search slip', () => {
  const phone = renderToStaticMarkup(<MobileCatalog release={release} />);
  expect(phone).toContain('class="m-slip"');
  expect(phone).toContain('class="stub-rings"');
  for (const film of films) expect(phone).toContain(`${film.title}，查看详情`);
  expect(phone).toContain('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  expect(phone).toContain('href="mailto:relativemotion@icloud.com"');
});

test('tells phone readers too when some collections are partial', () => {
  const partial = { ...release, collections: release.collections.map((entry, index) => (index === 0 ? { ...entry, status: 'partial' as const } : entry)) };
  expect(renderToStaticMarkup(<MobileCatalog release={partial} />)).toContain('部分片单还在匹配资料');
});

test('leaves out the poster entirely for a film that has none', () => {
  const film = films.find((entry) => !entry.posterPath)!;
  const stub = renderToStaticMarkup(<StubFace film={film} sort="tmdb" joined />);
  expect(stub).not.toContain('stub-poster');
  expect(stub).not.toContain('无海报');
});

test('opens the awards into one line each, wins first', () => {
  const film = { ...films[0], awards: { wins: 1, nominations: 1, fetchedAt: '2026-10-29T08:00:00Z', items: [
    { kind: 'win' as const, award: 'Synthetic Prize for Best Map', year: 2002, recipients: ['Ada Placeholder'] },
    { kind: 'nomination' as const, award: 'Synthetic Award for Paper', year: 2002 },
  ] } };
  const page = renderToStaticMarkup(<TicketDetails film={film} />);
  expect(page).toContain('<details class="awards"><summary>获奖 1 项 · 提名 1 项</summary>');
  expect(page.indexOf('Synthetic Prize for Best Map')).toBeLessThan(page.indexOf('Synthetic Award for Paper'));
  expect(page).toContain('Ada Placeholder');
  expect(page).not.toContain('未能读取名称');
  const some = renderToStaticMarkup(<TicketDetails film={{ ...film, awards: { ...film.awards, wins: 3, unnamed: 1 } }} />);
  expect(some).toContain('另有 1 项未能读取名称');
});

test('marks an unconfirmed stub quietly', () => {
  const stub = renderToStaticMarkup(<StubFace film={films.find((film) => !film.confirmed)!} sort="tmdb" />);
  expect(stub).toContain('stub-score is-unconfirmed');
});
