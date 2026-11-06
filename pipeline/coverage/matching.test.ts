import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { boundedSearchResults, binaryTitles, duplicateCast, kanjiNames, nameVariants, placeholders, romanizedDirector, matchingCases, personAliases, phoneticCases, scriptTitles, sourceAudio, sourceCast, syntheticMetadata, translatedEntity } from '../../fixtures/matching.ts';
import { filmMetadataView } from '../../shared/film-metadata.ts';
import { chooseMovie, movieFields, shortenedTitle, titleMatches } from './matching.ts';
import { evidenceVector } from './signals.ts';
import { parseSamples } from './model.ts';
import { newRow, tmdb, wikidata } from './enrich.ts';
import { createClient } from './client.ts';
import { meaningfulName, personNames, phoneticName, sameName } from './names.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/coverage.sample.json', import.meta.url), 'utf8'));
const sample = () => parseSamples([structuredClone(fixture.sample)], 1)[0];
const movie = () => structuredClone(fixture.movie);
const temporary: string[] = [];
afterEach(() => { temporary.forEach((d) => rmSync(d, { recursive: true, force: true })); temporary.length = 0; });

test.each(matchingCases)('$name', (c) => {
  expect(chooseMovie({ ...sample(), ...c.sample }, [{ ...movie(), ...c.movie }]).match.status).toBe(c.status);
});
test.each(phoneticCases)('compares complete name transcription %s / %s; 比较完整姓名转写', (left, right, expected) => {
  expect(phoneticName(left, right)).toBe(expected);
  expect(phoneticName(right, left)).toBe(expected);
});
test('phonetic identity needs runtime and cannot resolve homophones; 转写须有片长且不消解同音歧义', () => {
  const source = { ...sample(), aliases: [], year: undefined, directors: ['林青'] };
  const candidate = { ...movie(), credits: { crew: [{ job: 'Director', name: 'Qing Lin' }] } };
  const result = chooseMovie(source, [candidate]);
  expect(result.match.status).toBe('hit');
  expect(result.audit.candidates[0].vector.director).toMatchObject({ state: 'phonetic', points: 20 });
  expect(chooseMovie(source, [{ ...candidate, runtime: null }]).match.status).toBe('ambiguous');
  expect(chooseMovie(source, [candidate, { ...candidate, id: 900002 }]).match.status).toBe('ambiguous');
  expect(chooseMovie(source, [{ ...candidate, credits: { crew: [{ job: 'Director', name: '林清' }] } }]).match.status).toBe('ambiguous');
});
test('keeps evidence vectors and deduplicates IDs deterministically; 保留证据向量并按编号确定性去重', () => {
  const result = chooseMovie(sample(), [movie(), movie()]);
  expect(result.match.status).toBe('hit');
  expect(result.audit.candidates).toHaveLength(1);
  expect(result.audit.margin).toBeNull();
  expect(result.audit.viableCandidates).toBe(1);
  expect(result.audit.candidates[0].vector.runtime).toMatchObject({ state: 'match', points: 20, delta: 2 });
  const other = { ...movie(), id: 900002 };
  expect(chooseMovie(sample(), [movie(), other])).toEqual(chooseMovie(sample(), [other, movie()]));
});
test('auxiliary signals cannot resolve a core evidence tie; 辅助信号不能独自消解主要证据平局', () => {
  const richer = { ...movie(), original_language: 'zh', production_countries: [{ iso_3166_1: 'HK' }], credits: { ...movie().credits, cast: sourceCast.map((name) => ({ name })) } };
  const result = chooseMovie({ ...sample(), originalLanguage: 'zh', productionCountryCodes: ['HK'], cast: sourceCast }, [richer, { ...movie(), id: 900002, credits: { ...movie().credits, cast: [] } }]);
  expect(result.audit.margin).toBe(10);
  expect(result.match.status).toBe('ambiguous');
});
test('language evidence requires an independent source and audio stays weak; 语言需独立来源且音轨只作弱证据', () => {
  const candidate = { ...movie(), original_language: 'en' };
  expect(evidenceVector(sample(), candidate, true).language.points).toBe(0);
  expect(evidenceVector({ ...sample(), originalLanguage: 'eng' }, candidate, true).language.points).toBe(3);
  expect(evidenceVector({ ...sample(), audioLanguages: sourceAudio }, candidate, true).language.points).toBe(1);
  expect(evidenceVector({ ...sample(), originalLanguage: 'ja' }, candidate, true).language).toMatchObject({ state: 'different', points: 0 });
});
test('country codes are independent and never inferred from language or labels; 地区代码独立且不从语言或名称推断', () => {
  const candidate = { ...movie(), original_language: 'zh', production_countries: [{ iso_3166_1: 'HK', name: syntheticMetadata.productionCountries[0].name }] };
  expect(evidenceVector({ ...sample(), productionCountryCodes: ['HK', 'GB'] }, candidate, true).country.points).toBe(2);
  for (const codes of [['CN'], ['TW'], ['MO'], ['Hong Kong'], []]) expect(evidenceVector({ ...sample(), productionCountryCodes: codes }, candidate, true).country.points).toBe(0);
});
test('uses attested director aliases without inventing transliteration; 用有来源的导演别名而不猜测转写', () => {
  const candidate = { ...movie(), credits: { crew: [{ id: 900010, job: 'Director', name: 'Ari Example' }] } };
  const source = { ...sample(), aliases: [], year: undefined, directors: ['艾莉示例'] };
  expect(chooseMovie(source, [candidate]).match.status).toBe('ambiguous');
  expect(chooseMovie(source, [candidate], false, personAliases).match.status).toBe('hit');
});
test('public metadata omits countries while local metadata retains them; 公开资料省略地区且本地资料保留', () => {
  expect(filmMetadataView(syntheticMetadata, 'public')).toEqual({ originalLanguage: 'zh' });
  expect(filmMetadataView(syntheticMetadata, 'local')).toEqual(syntheticMetadata);
  const result = movieFields({ ...movie(), original_language: 'zh', production_countries: [{ iso_3166_1: 'HK', name: syntheticMetadata.productionCountries[0].name }] });
  expect(result.fields.originalLanguage.status).toBe('hit');
  expect(result.details.publicMetadata).toEqual({ originalLanguage: 'zh' });
  expect(JSON.stringify(result.details.publicMetadata)).not.toContain('HK');
  expect(result.details.localMetadata).toEqual(syntheticMetadata);
});
test('finds adjacent-year identity despite irrelevant same-year results; 同年有无关结果仍能找到相邻年份影片', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-matching-')); temporary.push(directory);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    let data: unknown = {};
    if (url.pathname.endsWith('/search/movie')) data = { total_pages: 1, results: [{ id: 900001, release_date: '2002-01-01' }, { id: 900002, release_date: '2001-01-01' }] };
    if (url.pathname.endsWith('/movie/900001')) data = { ...movie(), release_date: '2002-01-01' };
    if (url.pathname.endsWith('/movie/900002')) data = { ...movie(), id: 900002, title: 'Other Film', original_title: 'Other Film', translations: {} };
    if (url.pathname.endsWith('/configuration')) data = { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } };
    return new Response(JSON.stringify(data));
  });
  const row = newRow(sample()); await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.notes).toContain('来源年份与候选相差 1 年，保留两者原值');
});
test('fetches and replays director aliases for missing-year samples; 缺年份样本获取并重放导演别名', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-aliases-')); temporary.push(directory);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const data = url.pathname.endsWith('/search/movie') ? { total_pages: 1, results: [{ id: 900001 }] }
      : url.pathname.includes('/person/') ? { id: 900010, name: url.searchParams.get('language') === 'zh-CN' ? personAliases['900010'].names[1] : 'Ari Example', also_known_as: [] }
        : url.pathname.endsWith('/configuration') ? { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }
          : { ...movie(), credits: { crew: [{ id: 900010, name: 'Ari Example', job: 'Director' }] } };
    return new Response(JSON.stringify(data));
  });
  const input = { ...sample(), year: undefined, directors: ['艾莉示例'] };
  const row = newRow(input); await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.details.directorAliases).toMatchObject({ '900010': { urls: expect.arrayContaining(['https://api.themoviedb.org/3/person/900010?language=zh-CN']) } });
  fetcher.mockClear();
  const replay = newRow(input); await tmdb(createClient(directory, false, { fetcher }), replay);
  expect(replay).toEqual(row);
  expect(fetcher).not.toHaveBeenCalled();
});
test('broadens without director verification to find missing candidate dates; 窗口未核实导演时补查缺日期候选', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-dates-')); temporary.push(directory);
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    const data = url.pathname.endsWith('/search/movie') ? { total_pages: 1, results: [{ id: url.searchParams.has('primary_release_year') ? 900002 : 900001 }] }
      : url.pathname.endsWith('/movie/900002') ? { ...movie(), id: 900002, credits: {} }
        : url.pathname.endsWith('/configuration') ? { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }
          : { ...movie(), release_date: '' };
    return new Response(JSON.stringify(data));
  });
  const row = newRow(sample()); await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.fields.year.status).toBe('miss');
  expect(requests.some((u) => u.pathname.endsWith('/search/movie') && !u.searchParams.has('primary_release_year'))).toBe(true);
});
test('bounds detail requests and rejects truncated evidence without an anchor; 限制详情请求并拒绝截断后的无锚点结果', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-cap-')); temporary.push(directory);
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    return new Response(JSON.stringify(url.pathname.endsWith('/search/movie')
      ? { total_pages: url.searchParams.has('primary_release_year') ? 1 : 6, results: boundedSearchResults(requests.length) }
      : { ...movie(), id: Number(url.pathname.split('/').at(-1)), credits: {} }));
  });
  const row = newRow(sample()); await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('ambiguous');
  expect(requests.filter((r) => /\/movie\/\d+$/.test(r.pathname))).toHaveLength(200);
  expect(row.details.tmdbSearchCandidates).toHaveLength(200);
  expect(row.details.matchAudit).toMatchObject({ searchTruncated: true });
});
test('retains alias failure provenance and stops live follow-ups; 保留别名失败溯源并停止后续联网', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-alias-failure-')); temporary.push(directory);
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.includes('/person/') && url.searchParams.get('language') === 'zh-CN') return new Response('{}', { status: 503 });
    const data = url.pathname.endsWith('/search/movie') ? { total_pages: 1, results: [{ id: 900001 }] }
      : url.pathname.includes('/person/') ? { id: 900010, name: phoneticCases[0][1], also_known_as: [] }
        : { ...movie(), credits: { crew: [{ id: 900010, name: phoneticCases[0][1], job: 'Director' }] } };
    return new Response(JSON.stringify(data));
  });
  const row = newRow({ ...sample(), year: undefined, directors: [phoneticCases[0][0]] });
  await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.fields.tmdbMatch.status).toBe('hit');
  expect(row.fields.poster.status).toBe('error');
  expect(row.details.directorAliasIssues).toEqual([expect.objectContaining({ personId: 900010, url: 'https://api.themoviedb.org/3/person/900010?language=zh-CN', status: 'error' })]);
  expect(requests.some((r) => r.pathname.endsWith('/configuration'))).toBe(false);
});
test('uses localized movie titles for Wikidata ID cross-checks; 使用本地化片名召回 Wikidata 并核对编号', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-translated-')); temporary.push(directory);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const data = url.searchParams.get('action') === 'wbgetentities' ? { entities: { Q900001: translatedEntity } }
      : { search: url.searchParams.get('search') === movie().title ? [{ id: 'Q900001' }] : [] };
    return new Response(JSON.stringify(data));
  });
  const row = newRow({ ...sample(), title: sample().aliases[0], aliases: [] });
  row.fields.tmdbMatch.status = 'hit';
  row.details.tmdb = { movie: { ...movie(), original_title: sample().aliases[0] } };
  await wikidata(createClient(directory, true, { fetcher, wait: async () => {} }), row, []);
  expect(row.fields.wikidataMatch.status).toBe('hit');
});

test.each(nameVariants)('normalizes name variants %s / %s; 归一化姓名写法', (a, b, expected) => {
  expect(sameName(a, b)).toBe(expected);
  expect(sameName(b, a)).toBe(expected);
});
test('does not treat unresolved Asian romanization as a conflict; 未解的东亚转写保持未知', () => {
  const source = { ...sample(), directors: [romanizedDirector.source] };
  const candidate = { ...movie(), original_language: romanizedDirector.language, credits: { crew: [{ job: 'Director', name: romanizedDirector.name }] } };
  expect(evidenceVector(source, candidate, true).director.state).toBe('unknown');
  expect(chooseMovie(source, [candidate]).decision).toBe('unconfirmed');
});
test('folds Japanese kanji only to avoid director conflicts; 日文字形只用于避免导演误判冲突', () => {
  const candidate = (name: string) => ({ ...movie(), credits: { crew: [{ job: 'Director', name }] } });
  expect(evidenceVector({ ...sample(), directors: [kanjiNames.chinese] }, candidate(kanjiNames.japanese), true).director).toMatchObject({ state: 'unknown', points: 0 });
  const [left, right] = kanjiNames.distinct;
  expect(sameName(left, right)).toBe(false);
  expect(evidenceVector({ ...sample(), directors: [left] }, candidate(right), true).director.points).toBe(0);
});
test('compares original titles only within one writing system; 原名只在同一文字系统内判冲突', () => {
  const state = (own: string, candidate: string) => evidenceVector({ ...sample(), originalTitle: own }, { ...movie(), original_title: candidate }, true).originalTitle.state;
  expect(state(binaryTitles.original, binaryTitles.other)).toBe('conflict');
  expect(state(binaryTitles.variant, scriptTitles.otherHan)).toBe('conflict');
  expect(state(binaryTitles.variant, binaryTitles.translated)).toBe('match');
  for (const [own, candidate] of [[binaryTitles.original, binaryTitles.variant], [binaryTitles.variant, scriptTitles.hangul],
    [binaryTitles.variant, scriptTitles.kana], [scriptTitles.simplifiedKanji, scriptTitles.kanji]]) {
    expect(state(own, candidate)).toBe('unknown');
  }
  const source = { ...sample(), title: binaryTitles.translated, aliases: [], originalTitle: binaryTitles.original };
  expect(chooseMovie(source, [{ ...movie(), original_title: binaryTitles.variant }]).decision).toBe('confirmed');
});
test('requires independent corroboration for the year-runtime anchor; 年份片长路径需要独立佐证', () => {
  const source = { ...sample(), directors: [] };
  const candidate = { ...movie(), original_language: 'en' };
  expect(chooseMovie(source, [candidate]).decision).toBe('unconfirmed');
  expect(chooseMovie({ ...source, audioLanguages: sourceAudio }, [candidate]).decision).toBe('unconfirmed');
  for (const metadata of [{ originalLanguage: 'en' }, { originalTitle: binaryTitles.original }, { cast: sourceCast }, { productionCountryCodes: ['HK'] }]) {
    expect(chooseMovie({ ...source, ...metadata }, [{ ...candidate, production_countries: [{ iso_3166_1: 'HK' }] }]).decision).toBe('confirmed');
  }
  expect(chooseMovie({ ...source, cast: sourceCast }, [candidate], true).decision).toBe('unconfirmed');
});
test('uses an explicit source original title to distinguish translated namesakes; 用来源明确原名区分同译名', () => {
  const source = { ...sample(), title: binaryTitles.translated, aliases: [], originalTitle: binaryTitles.original };
  const other = { ...movie(), id: 900002, original_title: binaryTitles.other };
  expect(chooseMovie(source, [movie(), other]).movie?.id).toBe(movie().id);
  expect(chooseMovie({ ...source, originalTitle: undefined }, [movie(), other]).decision).toBe('unconfirmed');
  expect(chooseMovie(source, [other]).decision).toBe('unconfirmed');
  expect(chooseMovie({ ...sample(), title: binaryTitles.variant, aliases: [] }, [movie()]).decision).toBe('confirmed');
  expect(chooseMovie({ ...source, title: binaryTitles.other }, [movie(), movie()]).audit.candidates).toHaveLength(1);
});
test('keeps self-remakes ambiguous until independent evidence creates a margin; 自我翻拍需足够分差', () => {
  const remake = { ...movie(), id: 900002, release_date: '2010-01-01' };
  expect(chooseMovie(sample(), [movie(), remake]).decision).toBe('unconfirmed');
  expect(chooseMovie(sample(), [movie(), { ...remake, runtime: 140 }]).movie?.id).toBe(movie().id);
  expect(chooseMovie({ ...sample(), year: undefined, runtime: undefined }, [movie(), remake], true).decision).toBe('unconfirmed');
});
test('counts cast identities once across spelling and transcription; 演员写法和转写只计一个身份', () => {
  const source = { ...sample(), cast: duplicateCast };
  const candidate = { ...movie(), credits: { cast: [{ id: 900010, name: duplicateCast[1] }, { id: 900010, name: duplicateCast[0] }] } };
  expect(evidenceVector(source, candidate, true).cast).toMatchObject({ state: 'match', points: 2 });
  expect(evidenceVector({ ...source, cast: [...duplicateCast].reverse() }, candidate, true).cast).toEqual(evidenceVector(source, candidate, true).cast);
  expect(evidenceVector({ ...sample(), cast: [duplicateCast[0]] }, { ...movie(), credits: { cast: [{ name: duplicateCast[1] }] } }, true).cast).toMatchObject({ state: 'phonetic', points: 1 });
  expect(evidenceVector({ ...sample(), cast: placeholders }, { ...movie(), credits: { cast: placeholders.map((name) => ({ name })) } }, true).cast.points).toBe(0);
  expect(placeholders.every((name) => !meaningfulName(name))).toBe(true);
  expect(personNames([...sourceCast, ...placeholders].join(', '))).toEqual(sourceCast);
});
test('records excluded namesakes and never converts conflicts into points; 记录排除同名且冲突不能被加分抵消', () => {
  // Shared cast without a matching runtime does not outweigh the director conflict.
  const other = { ...movie(), id: 900002, runtime: movie().runtime + 40, credits: { crew: [{ job: 'Director', name: nameVariants.at(-1)![1] }], cast: sourceCast.map((name) => ({ name })) }, original_language: 'en' };
  const result = chooseMovie({ ...sample(), originalLanguage: 'en', cast: sourceCast }, [movie(), other]);
  expect(result.decision).toBe('confirmed');
  expect(result.audit.excludedNamesakes).toBe(1);
  expect(chooseMovie(sample(), [other]).decision).toBe('unconfirmed');
});
test('two shared cast members with year and runtime outweigh one wrong airline director; 两名演员加年份片长可压过单一导演冲突', () => {
  const credits = { crew: [{ job: 'Director', name: 'Peter Baynton' }], cast: sourceCast.map((name) => ({ name })) };
  const source = { ...sample(), directors: ['Sara Daddy'], cast: sourceCast };
  const result = chooseMovie(source, [{ ...movie(), credits }]);
  expect(result.decision).toBe('confirmed');
  expect(result.waived).toEqual(['director']);
  expect(result.match.reason).toContain('航司导演与资料不符');
  // Remakes and sequels share cast but not the year; one shared name is not enough either.
  expect(chooseMovie(source, [{ ...movie(), release_date: '1990-01-01', credits }]).decision).toBe('unconfirmed');
  expect(chooseMovie({ ...source, cast: sourceCast.slice(0, 1) }, [{ ...movie(), credits }]).decision).toBe('unconfirmed');
});
test('spelling variants, Hong Kong long forms and translated Han names are not director conflicts; 拼写变体、港式全名与外国导演汉字译名不算冲突', () => {
  const vector = (directors: string[], name: string, language = 'en', aliases: string[] = []) => evidenceVector(
    { ...sample(), directors }, { ...movie(), original_language: language, credits: { crew: [{ id: 1, job: 'Director', name }] } }, true,
    { 1: { names: aliases, url: 'https://example.invalid/person/1' } }).director;
  expect(vector(['Antoine Fuque'], 'Antoine Fuqua')).toMatchObject({ state: 'near', points: 0 });
  expect(vector(['Joseph Pytka'], 'Joe Pytka').state).toBe('near');
  expect(vector(['Hyn-jin Cho'], 'Cho Hyeon-jin').state).toBe('near');
  expect(vector(['Dickson Leung'], 'Dickson Leung Kwok-Fai').state).toBe('near');
  expect(vector(['Ho Miu Ki'], 'Ho Miu-Kei').state).toBe('near');
  expect(vector(['Frant Gwo'], 'Frant Guo Fan').state).toBe('near');
  expect(vector(['Karan Sharmaa'], 'Karan Shrikant Sharma').state).toBe('near');
  expect(vector(['Ari Example'], 'Bo Sample').state).toBe('conflict');
  // A Han alias of a Korean director is a translation; for a Chinese-language film it still conflicts.
  expect(vector(['甲乙丙'], 'Kim Example', 'ko', ['丁戊己']).state).toBe('unknown');
  expect(vector(['甲乙丙'], 'Kim Example', 'zh', ['丁戊己']).state).toBe('conflict');
  expect(vector(['No Director Available'], 'Bo Sample').state).toBe('unknown');
});
test('accepts a shortened airline title only with a matching director and never a sequel; 简写片名须导演对应且排除续集', () => {
  const credits = movie().credits;
  const named = (title: string) => ({ ...movie(), title, original_title: title, translations: { translations: [] } });
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon' }, named('Paper Horizon: The Untold Story'))).toBe(true);
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon' }, named('Paper Horizon The Movie'))).toBe(true);
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon 1' }, named('Paper Horizon'))).toBe(true);
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon' }, named('Paper Horizon: Part 2'))).toBe(false);
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon' }, named('Paper Horizon 2'))).toBe(false);
  expect(shortenedTitle({ ...sample(), title: 'Paper Horizon' }, named('Paper Horizons'))).toBe(false);
  const source = { ...sample(), title: 'Paper Horizon', aliases: [] };
  const result = chooseMovie(source, [{ ...named('Paper Horizon: The Untold Story'), credits }]);
  expect(result.decision).toBe('confirmed');
  expect(result.match.reason).toContain('航司片名为简写');
  expect(chooseMovie(source, [{ ...named('Paper Horizon: The Untold Story'), credits: { crew: [{ job: 'Director', name: 'Bo Sample' }] } }]).decision).toBe('unconfirmed');
  // An exact-title namesake keeps the shortened comparison off.
  expect(chooseMovie(source, [{ ...named('Paper Horizon: The Untold Story'), credits }, { ...named('Paper Horizon'), id: 900002, credits: { crew: [{ job: 'Director', name: 'Bo Sample' }] } }]).decision).toBe('unconfirmed');
});
test('anchors a yearless Chinese-title source with the attested Chinese title and runtime; 无年份中文片名来源以中文译名加片长确认', () => {
  const source = { ...sample(), title: '纸上地平线', aliases: [], year: undefined, directors: ['某某·某某'], cast: [] };
  const candidate = { ...movie(), credits: { crew: [{ job: 'Director', name: 'Ari Example' }] } };
  const result = chooseMovie(source, [candidate]);
  expect(result.decision).toBe('confirmed');
  expect(result.match.reason).toContain('由中文片名与片长确认');
  expect(chooseMovie(source, [{ ...candidate, runtime: 140 }]).decision).toBe('unconfirmed');
  // Two candidates with the same Chinese title and runtime stay undecided.
  expect(chooseMovie(source, [candidate, { ...candidate, id: 900002 }]).decision).toBe('unconfirmed');
  // An English title alone, or a source with a year, does not use this anchor.
  expect(chooseMovie({ ...source, title: 'Paper Horizon' }, [candidate]).decision).toBe('unconfirmed');
  expect(chooseMovie({ ...source, year: 2010 }, [candidate]).decision).toBe('unconfirmed');
});
test('uses short-film tolerance in version diagnostics; 版本诊断遵循短片容差', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-short-')); temporary.push(directory);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(url.pathname.endsWith('/search/movie') ? { total_pages: 1, results: [{ id: movie().id }] }
      : url.pathname.endsWith('/configuration') ? {} : { ...movie(), runtime: 24 }));
  });
  const row = newRow({ ...sample(), runtime: 20 });
  await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.details.identity).toBe('confirmed');
  expect(row.notes).toContain('身份确认，片长差异超过对应时长容差；保留版本差异，原因未知');
});

test('unconfirmed identity retains only airline information; 未确认身份只保留航司信息', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relative-motion-unconfirmed-')); temporary.push(directory);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(url.pathname.endsWith('/search/movie') ? { total_pages: 1, results: [{ id: movie().id }] } : movie()));
  });
  const row = newRow({ ...sample(), year: undefined, runtime: undefined, directors: [] });
  await tmdb(createClient(directory, true, { token: 'synthetic', fetcher, wait: async () => {} }), row);
  expect(row.details.identity).toBe('unconfirmed');
  expect(row.fields.tmdbMatch.reason).toBeTruthy();
  expect(row.details.tmdb).toBeUndefined();
  expect(row.fields.tmdbRating.status).toBe('untested');
  expect(row.sample.title).toBe(sample().title);
});

test('ignores one leading English article only in the lenient comparison', () => {
  const lord = { title: 'The Lord of the Rings: The Return of the King', original_title: 'The Lord of the Rings: The Return of the King' };
  const airline = { ...sample(), title: 'Lord of the Rings: The Return of the King', aliases: [] };
  expect(titleMatches(airline, lord)).toBe(false);
  expect(titleMatches(airline, lord, true)).toBe(true);
  expect(titleMatches({ ...sample(), title: 'Lord of the Rings', aliases: [] }, lord, true)).toBe(false);
});

test('falls back to the article-insensitive comparison only when no exact title exists', () => {
  const withArticle = { ...movie(), id: 900020, title: 'The Paper Horizon', original_title: 'The Paper Horizon', translations: {} };
  expect(chooseMovie({ ...sample(), aliases: [] }, [withArticle]).decision).toBe('confirmed');
  const exact = { ...movie(), id: 900021, translations: {} };
  const audit = chooseMovie({ ...sample(), aliases: [] }, [exact, withArticle]).audit;
  expect(audit.candidates.find((c) => c.id === 900020)?.vector.title.state).not.toBe('match');
});
