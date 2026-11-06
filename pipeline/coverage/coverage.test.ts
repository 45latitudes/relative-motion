import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { createClient, allowed } from './client.ts';
import { chooseMovie, movieFields } from './matching.ts';
import { parseSamples } from './model.ts';
import { readRatings, readRatingsFile } from './imdb.ts';
import { newRow, tmdb, wikidata } from './enrich.ts';
import { conflictingEntity } from '../../fixtures/coverage-wikidata.ts';
import { report, summarize } from './report.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/coverage.sample.json', import.meta.url), 'utf8'));
const sample = () => parseSamples([structuredClone(fixture.sample)], 1)[0];
const movie = () => structuredClone(fixture.movie);
const temporary: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'relative-motion-test-')); temporary.push(d); return d; };
afterEach(() => { temporary.forEach((d) => rmSync(d, { recursive: true, force: true })); temporary.length = 0; vi.unstubAllGlobals(); });

test('uses year and corroboration to distinguish namesakes; 通过年份和佐证区分同名', () => {
  const other = { ...movie(), id: 900002, release_date: '2002-01-01' };
  expect(chooseMovie(sample(), [movie(), other]).match.status).toBe('ambiguous');
  expect(chooseMovie(sample(), [movie(), { ...other, release_date: '2005-01-01' }]).decision).toBe('unconfirmed');
  expect(chooseMovie({ ...sample(), year: undefined }, [movie(), other]).match.status).toBe('ambiguous');
  expect(chooseMovie(sample(), [movie(), { ...movie(), id: 900003 }]).match.status).toBe('ambiguous');
  expect(chooseMovie(sample(), [movie()], true).decision).toBe('confirmed');
});
test('requires exact normalized titles and checks edition differences; 核对片名与版本差异', () => {
  expect(chooseMovie(sample(), [{ ...movie(), title: 'Paper Horizon 2', original_title: 'Paper Horizon 2', translations: {} }]).match.status).toBe('miss');
  expect(chooseMovie(sample(), [{ ...movie(), runtime: 120, credits: {} }]).match.status).toBe('ambiguous');
  expect(chooseMovie(sample(), [{ ...movie(), title: '纸上地平线', original_title: '纸上地平线' }]).match.status).toBe('hit');
});
test('measures metadata without downloading posters; 统计资料而不下载海报', () => {
  expect(movieFields(movie(), 'https://image.tmdb.org/t/p/').fields.poster.status).toBe('hit');
  expect(movieFields({ ...movie(), vote_count: 0 }).fields.tmdbRating.status).toBe('miss');
  expect(movieFields({ ...movie(), videos: { results: [{ type: 'Teaser', site: 'YouTube', key: 'synthetic' }] } }).fields.trailer.status).toBe('miss');
});
test('counts native English titles without a redundant translation; 英语原名无需重复翻译条目', () => {
  expect(movieFields({ ...movie(), original_language: 'en', translations: {} }).fields.englishTitle.status).toBe('hit');
  expect(movieFields({ ...movie(), original_language: 'ko', translations: {} }).fields.englishTitle.status).toBe('miss');
});
test('streams ratings, filters IDs and rejects conflicts; 流式过滤评分并拒绝冲突', async () => {
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network. 意外联网。'); });
  const result = await readRatings(Readable.from([fixture.ratings.slice(0, 17), fixture.ratings.slice(17)]), new Set(['tt9000001', 'tt9000003']));
  expect([...result.values.keys()]).toEqual(['tt9000001']);
  expect([...result.conflicts]).toEqual(['tt9000003']);
  expect(result.invalid).toBe(2);
  await expect(readRatings(Readable.from(['invalid\n']), new Set())).rejects.toThrow('header');
});
test('offline cache misses make zero requests; 离线缺缓存时零请求', async () => {
  const fetcher = vi.fn();
  await expect(createClient(temp(), false, { fetcher }).get('https://api.themoviedb.org/3/configuration')).rejects.toMatchObject({ kind: 'untested' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(allowed(new URL('https://example.com/3/configuration'))).toBe(false);
});
test('spaces requests, reuses cache and redacts credentials; 限速复用缓存并隔离凭据', async () => {
  const dir = temp();
  let at = 10000;
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ synthetic: true }), { status: 200 }));
  const wait = vi.fn(async (ms: number) => { at += ms; });
  const client = createClient(dir, true, { token: 'synthetic-token', fetcher, now: () => at, wait });
  const first = await client.get('https://api.themoviedb.org/3/configuration');
  await client.get('https://api.themoviedb.org/3/configuration');
  await client.get('https://api.themoviedb.org/3/movie/900001');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(2100);
  expect(JSON.stringify(first)).not.toContain('synthetic-token');
  const offline = createClient(dir, false, { fetcher });
  expect(await offline.get(first.url)).toEqual(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test('halts a source after API errors including cached errors; API 错误后停止来源并保留错误状态', async () => {
  const dir = temp();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'synthetic' } }), { status: 200 }));
  const client = createClient(dir, true, { fetcher });
  const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities';
  await expect(client.get(url)).rejects.toThrow('API');
  await expect(client.get(`${url}&ids=Q900001`)).rejects.toThrow('halted');
  await expect(createClient(dir, false, { fetcher }).get(url)).rejects.toThrow('Cached');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('reads gzip locally and rejects corrupt gzip; 本地读取 gzip 并拒绝损坏文件', async () => {
  const file = join(temp(), 'synthetic.tsv.gz');
  writeFileSync(file, gzipSync(fixture.ratings));
  expect((await readRatingsFile(file, new Set(['tt9000001']))).values.size).toBe(1);
  writeFileSync(file, fixture.ratings);
  await expect(readRatingsFile(file, new Set())).rejects.toThrow();
});
test('computes denominators and keeps raw metadata out of reports; 计算分母并隔离原始补全内容', () => {
  const rows = [newRow(sample()), newRow(sample()), newRow(sample())];
  rows[0].fields.tmdbMatch.status = 'hit'; rows[1].fields.tmdbMatch.status = 'error';
  rows[0].details = { raw: fixture.movie };
  expect(summarize(rows, 'tmdbMatch')).toEqual({ hit: 1, miss: 0, ambiguous: 0, error: 1, untested: 1, total: 3, measured: 1 });
  const output = report(rows, { observedFrom: 'synthetic', observedTo: 'synthetic', requestCount: 0, ratingsSha256: '', ratingsRows: 0, ratingsInvalid: 0 });
  expect(output).toContain('33.3%');
  expect(output).not.toContain(fixture.movie.overview);
  expect(output).not.toContain(fixture.movie.poster_path);
});
test('shares the Wikipedia interval across languages; 维基百科语言子域共享间隔', async () => {
  let at = 10000;
  const wait = vi.fn(async (ms: number) => { at += ms; });
  const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
  const client = createClient(temp(), true, { fetcher, now: () => at, wait });
  await client.get('https://en.wikipedia.org/w/api.php');
  await client.get('https://zh.wikipedia.org/w/api.php');
  expect(wait).toHaveBeenCalledWith(2100);
});
test('checks all search pages throughout the year window when an open search has too many pages', async () => {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    let response: unknown = {};
    const open = !url.searchParams.has('primary_release_year');
    if (url.pathname.endsWith('/search/movie')) response = { total_pages: open ? 6 : 2, results: [{ id: url.searchParams.get('page') === '2' ? 900002 : 900001 }] };
    if (url.pathname.endsWith('/movie/900001')) response = movie();
    if (url.pathname.endsWith('/movie/900002')) response = { ...movie(), id: 900002, runtime: 140, credits: {} };
    if (url.pathname.endsWith('/configuration')) response = { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } };
    return new Response(JSON.stringify(response));
  });
  const client = createClient(temp(), true, { token: 'synthetic', fetcher, wait: async () => {} });
  const row = newRow(sample());
  await tmdb(client, row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  const searches = requests.filter((r) => r.pathname.endsWith('/search/movie'));
  expect([...new Set(searches.map((r) => r.searchParams.get('primary_release_year')))]).toEqual([null, '1998', '1999', '2000', '2001', '2002', '2003', '2004']);
  // One open search per title (the sample has an English and a Chinese title).
  expect(searches.filter((r) => !r.searchParams.has('primary_release_year'))).toHaveLength(2);
  expect(searches.some((r) => r.searchParams.get('page') === '2')).toBe(true);
});

test('applies the year window locally when one open search returns every result', async () => {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    let response: unknown = {};
    if (url.pathname.endsWith('/search/movie')) {
      response = { total_pages: 1, results: [{ id: 900001, release_date: '2001-01-01' }, { id: 900003, release_date: '1990-01-01' }, { id: 900004 }] };
    }
    if (url.pathname.endsWith('/movie/900001')) response = movie();
    if (url.pathname.endsWith('/configuration')) response = { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } };
    return new Response(JSON.stringify(response));
  });
  const row = newRow(sample());
  await tmdb(createClient(temp(), true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(requests.filter((r) => r.pathname.endsWith('/search/movie'))).toHaveLength(2);
  expect(requests.some((r) => r.searchParams.has('primary_release_year'))).toBe(false);
  // Out-of-window and undated results are what the year-filtered searches would not have returned.
  expect(requests.filter((r) => /\/movie\/\d+$/.test(r.pathname)).map((r) => r.pathname.split('/').at(-1))).toEqual(['900001']);
});
test('blocks ratings on contradictory cross-source IDs; 来源编号冲突时阻止评分挂载', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ entities: { Q900001: conflictingEntity } })));
  const row = newRow(sample());
  row.fields.tmdbMatch.status = 'hit';
  row.details.tmdb = { movie: { ...movie(), external_ids: { wikidata_id: 'Q900001', imdb_id: 'tt9000001' } } };
  await wikidata(createClient(temp(), true, { fetcher }), row, []);
  expect(row.fields.wikidataMatch.status).toBe('ambiguous');
  expect(row.details.idConflict).toBe(true);
  expect(row.details.wikidata).toBeUndefined();
});

test('reports binary identity, excluded namesakes and ID conflict signals; 报告二元身份、排除同名及编号冲突信号', () => {
  const rows = [newRow(sample()), newRow(sample())];
  rows[0].fields.tmdbMatch = { status: 'hit', reason: '' };
  rows[0].details = { matchAudit: { ...chooseMovie(sample(), [movie()]).audit, excludedNamesakes: 2 }, idConflict: true };
  rows[1].fields.tmdbMatch = { status: 'ambiguous', reason: '独立身份依据不足，未确认' };
  const output = report(rows, { observedFrom: 'synthetic', observedTo: 'synthetic', requestCount: 0, ratingsSha256: '', ratingsRows: 0, ratingsInvalid: 0 });
  expect(output).toContain('未确认原因与数据诊断');
  expect(output).toContain('无其他无冲突同名候选 | 2');
  expect(output).toContain('跨来源外部 ID 冲突：1 部');
  expect(output).not.toMatch(/人工修正|待复核|高置信度|medium/);
});
