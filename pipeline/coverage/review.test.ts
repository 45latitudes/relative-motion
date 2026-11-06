import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { auditRecords, cantoneseTitles, invalidClocks, missingMovie, originalVideos, plotHeadings, rejectedRequest, searchCases, unknownFailure } from '../../fixtures/coverage-review.ts';
import { createClient, RATE_POLICY } from './client.ts';
import { CoverageError, diagnostic } from './errors.ts';
import { newRow, plotSection, tmdb, wikidata } from './enrich.ts';
import { requestAudit } from './audit.ts';
import { chooseMovie, movieFields } from './matching.ts';
import { parseSamples } from './model.ts';
import { report } from './report.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/coverage.sample.json', import.meta.url), 'utf8'));
const sample = () => parseSamples([structuredClone(fixture.sample)], 1)[0];
const movie = () => ({ ...structuredClone(fixture.movie), original_language: 'en' });
const temporary: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'relative-motion-review-')); temporary.push(d); return d; };
afterEach(() => { temporary.forEach((d) => rmSync(d, { recursive: true, force: true })); temporary.length = 0; });
function simulated(handler: (url: URL) => { data: unknown; status?: number }, directory = temp()) {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    const result = handler(url);
    return new Response(JSON.stringify(result.data), { status: result.status ?? 200 });
  });
  return { requests, fetcher, client: createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }) };
}
function ordinary(url: URL) {
  if (url.pathname.endsWith('/search/movie')) return { data: { total_pages: 1, results: [{ id: 900001 }] } };
  if (url.pathname.endsWith('/configuration')) return { data: { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } } };
  return { data: movie() };
}

test.each(plotHeadings)('recognizes plot heading %s; 识别剧情标题', (heading) => {
  expect(plotSection([{ line: heading, index: '1' }])).toBe('1');
});
test('preserves a match across candidate 404s and cached replays; 候选 404 及缓存重放不影响有效匹配', async () => {
  const directory = temp();
  const { client, fetcher } = simulated((url) => {
    if (url.pathname.endsWith('/search/movie')) return { data: { total_pages: 1, results: [{ id: 900002 }, { id: 900001 }] } };
    if (url.pathname.endsWith('/900002')) return { data: missingMovie, status: 404 };
    return ordinary(url);
  }, directory);
  const row = newRow(sample()); await tmdb(client, row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.details.tmdbMissingCandidates).toEqual([900002]);
  const calls = fetcher.mock.calls.length;
  const replay = newRow(sample()); await tmdb(createClient(directory, false, { fetcher }), replay);
  expect(replay.fields.tmdbMatch.status).toBe('hit');
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
test('a poster configuration failure preserves match and downstream IDs; 海报配置失败保留匹配与后续编号核对', async () => {
  const { client } = simulated((url) => {
    if (url.pathname.endsWith('/configuration')) return { data: rejectedRequest, status: 503 };
    return ordinary(url);
  });
  const row = newRow(sample()); await tmdb(client, row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.fields.poster.status).toBe('error');
  expect(row.fields.overview.status).toBe('hit');
  expect(row.details.tmdb).toBeDefined();
  const wd = simulated(() => ({ data: { search: [] } }));
  await wikidata(wd.client, row, []);
  expect(wd.requests.length).toBeGreaterThan(0);
});
test('falls back to original-language trailers; 补查原语言预告片', async () => {
  const { client, requests } = simulated((url) => {
    if (url.pathname.endsWith('/videos')) return { data: originalVideos };
    if (url.pathname.endsWith('/900001')) return { data: { ...movie(), original_language: 'de', videos: { results: [] } } };
    return ordinary(url);
  });
  const row = newRow(sample()); await tmdb(client, row);
  expect(row.fields.trailer.status).toBe('hit');
  expect(requests.find((r) => r.pathname.endsWith('/videos'))?.searchParams.get('language')).toBe('de');
});
test('halts both Wikipedia language hosts after source failure; 来源失败时停止百科两个语言子域', async () => {
  const { client, fetcher } = simulated(() => ({ data: rejectedRequest, status: 429 }));
  await expect(client.get('https://en.wikipedia.org/w/api.php')).rejects.toThrow('HTTP');
  await expect(client.get('https://zh.wikipedia.org/w/api.php')).rejects.toThrow('halted');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('does not classify an unrecognized 404 as a missing movie; 未识别的 404 仍停止来源', async () => {
  const { client, fetcher } = simulated(() => ({ data: {}, status: 404 }));
  await expect(client.get('https://api.themoviedb.org/3/movie/900001')).rejects.toMatchObject({ resourceMissing: false });
  await expect(client.get('https://api.themoviedb.org/3/movie/900002')).rejects.toThrow('halted');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('counts native Chinese titles and distinguishes absent runtime from edition differences; 中文原名回退并区分缺片长', async () => {
  expect(movieFields({ ...movie(), original_language: 'zh', original_title: '纸上地平线', translations: {} }).fields.chineseTitle.status).toBe('hit');
  const { client } = simulated((url) => url.pathname.endsWith('/900001') ? { data: { ...movie(), runtime: null } } : ordinary(url));
  const row = newRow(sample()); await tmdb(client, row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.notes).toEqual([]);
  expect(row.fields.runtime.status).toBe('miss');
});
test('uses a clear evidence lead over weak namesakes; 通过明确证据优势区分弱同名候选', () => {
  const other = { ...movie(), id: 900002, runtime: null, credits: {} };
  expect(chooseMovie(sample(), [movie(), other]).match.status).toBe('hit');
  expect(chooseMovie(sample(), [movie(), { ...other, runtime: 150 }]).match.status).toBe('hit');
});
test('checks director evidence after search truncation; 搜索截断后仍核对导演依据', async () => {
  const { client, requests } = simulated((url) => url.pathname.endsWith('/search/movie') ? { data: { total_pages: 6, results: [{ id: 900001 }] } } : ordinary(url));
  const row = newRow(sample()); await tmdb(client, row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(requests.some((r) => r.pathname.endsWith('/movie/900001'))).toBe(true);
  expect(row.details.matchAudit).toMatchObject({ searchTruncated: true });
});
test.each(searchCases)('classifies search blockers consistently: %j; 搜索前置判定一致且保留原因', async ({ missingYear, pages, count, status, reason }) => {
  const candidates = count ? [{ ...movie(), credits: {} }] : [];
  const { client, requests } = simulated((url) => url.pathname.endsWith('/search/movie') ? { data: { total_pages: pages, results: candidates } } : { data: candidates[0] });
  const row = newRow({ ...sample(), year: missingYear ? undefined : 2001 });
  await tmdb(client, row);
  expect(row.fields.tmdbMatch).toEqual({ status, reason });
  expect(row.fields.tmdbMatch).toEqual(chooseMovie(row.sample, candidates, pages > 5).match);
  expect(row.notes).toEqual([reason]);
  expect(requests.some((r) => r.pathname.endsWith('/movie/900001'))).toBe(Boolean(count));
});
test.each([false, true])('replays failures while retaining valid cache, online=%s; 重放失败状态并复用有效缓存', async (online) => {
  const directory = temp();
  const failedUrl = 'https://en.wikipedia.org/w/api.php';
  const goodUrl = 'https://zh.wikipedia.org/w/api.php';
  const seed = simulated((url) => url.hostname.startsWith('en.') ? { data: rejectedRequest, status: 429 } : { data: {} }, directory);
  const good = await seed.client.get(goodUrl);
  await expect(seed.client.get(failedUrl)).rejects.toThrow('HTTP');
  seed.fetcher.mockClear();
  const replay = createClient(directory, online, { fetcher: seed.fetcher });
  await expect(replay.get(failedUrl)).rejects.toThrow('Cached');
  expect(replay.used.get(failedUrl)).toEqual(seed.client.used.get(failedUrl));
  expect(await replay.get(goodUrl)).toEqual(good);
  await expect(replay.get(`${goodUrl}?page=uncached`)).rejects.toMatchObject({ kind: 'error', message: expect.stringContaining('halted') });
  expect(replay.used.size).toBe(2);
  expect(seed.fetcher).not.toHaveBeenCalled();
});
test.each(cantoneseTitles)('counts Cantonese original and translated titles; 统计粤语原名和译名', (titles) => {
  expect(movieFields({ ...movie(), ...titles }).fields.chineseTitle.status).toBe('hit');
});
test('distinguishes replay reads from retained audit records; 区分本次读取与全历史审计范围', () => {
  const directory = temp();
  auditRecords.forEach((record, i) => writeFileSync(join(directory, `${i}.json`), JSON.stringify(record)));
  const output = report([newRow(sample())], { observedFrom: auditRecords[0].fetchedAt, observedTo: auditRecords[0].fetchedAt,
    requestCount: 1, ratingsSha256: '', ratingsRows: 0, ratingsInvalid: 0, requestAudit: requestAudit(directory) });
  expect(output).toContain('本次重算使用 1 个不同缓存响应');
  expect(output).toContain('目录中保留的全部 4 个响应记录');
});
test.each(invalidClocks)('ignores malformed clocks offline: %s; 离线忽略损坏时钟', async (clock) => {
  const dir = temp();
  const { client, fetcher } = simulated(() => ({ data: {} }), dir);
  const url = 'https://www.wikidata.org/w/api.php';
  await client.get(url);
  writeFileSync(join(dir, 'request-clock.json'), clock);
  const offline = createClient(dir, false, { fetcher });
  expect((await offline.get(url)).status).toBe(200);
  await expect(offline.get(`${url}?synthetic=1`)).rejects.toMatchObject({ kind: 'untested' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('recovers a damaged clock with a full interval and writes valid state; 损坏时钟等待完整间隔后恢复', async () => {
  const dir = temp(); writeFileSync(join(dir, 'request-clock.json'), 'null');
  let now = 10000;
  const wait = vi.fn(async (ms: number) => { now += ms; });
  const fetcher = vi.fn(async () => new Response('{}'));
  const client = createClient(dir, true, { now: () => now, wait, fetcher });
  await client.get('https://www.wikidata.org/w/api.php');
  expect(wait).toHaveBeenCalledWith(2100);
  expect(client.warnings.size).toBe(1);
  expect(JSON.parse(readFileSync(join(dir, 'request-clock.json'), 'utf8'))['www.wikidata.org']).toBe(12100);
  expect(readdirSync(dir).some((file) => file.endsWith('.tmp'))).toBe(false);
});
test('audits explicit policies without inferring them from query parameters; 仅审计明确策略标记', () => {
  const dir = temp(); auditRecords.forEach((r, i) => writeFileSync(join(dir, `${i}.json`), JSON.stringify(r)));
  const audit = requestAudit(dir);
  expect(audit.markedFrom).toBe(auditRecords[3].fetchedAt);
  expect(audit.domains.find((d) => d.domain === 'api.themoviedb.org')?.markedRequests).toBe(0);
  expect(audit.domains.find((d) => d.domain === 'wikipedia.org')).toMatchObject({ minGapSeconds: 0.2, markedRequests: 1, unmarkedRequests: 2, markedMinGapSeconds: 2.1 });
});
test('reports curated errors and sends only the project contact in User-Agent; 输出预定义错误并只发送项目联系信息', async () => {
  expect(diagnostic(new CoverageError('Invalid sample. 样本无效。'))).toContain('样本无效');
  expect(diagnostic(new Error(unknownFailure))).not.toContain(unknownFailure);
  const fetcher = vi.fn(async () => new Response('{}'));
  const client = createClient(temp(), true, { fetcher });
  const response = await client.get('https://www.wikidata.org/w/api.php');
  const headers = (fetcher.mock.calls as unknown as [unknown, RequestInit][])[0][1].headers as Record<string, string>;
  expect(headers['User-Agent']).toBe('RelativeMotion/0.1 (research; +https://github.com/45latitudes/relative-motion; contact: relativemotion@icloud.com)');
  expect(response.ratePolicy).toBe(RATE_POLICY);
});
test('prints the missing-input diagnostic from the CLI; CLI 输出具体的输入缺失原因', () => {
  const directory = temp();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/coverage.ts', import.meta.url))], { cwd: directory, encoding: 'utf8', timeout: 5000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Cannot read scout sample');
  expect(result.stderr).not.toContain(directory);
});
