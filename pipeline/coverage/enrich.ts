import { endpoint, SourceError, type Client } from './client.ts';
import { array, evidence, FIELDS, object, string, type ObjectValue, type Row, type Sample } from './model.ts';
import { chooseMovie, movieFields, searchBlocker, titleMatches } from './matching.ts';
import { directorSignal, evidenceVector, MATCH_POLICY, movieDirectors, type People } from './signals.ts';
import { sameName } from './names.ts';
import { externalId, wikidataFields, type RatingRule } from './wikidata.ts';

const WD = 'https://www.wikidata.org/w/api.php';
export const getEntities = async (client: Client, ids: string[]) => object((await client.get(endpoint(WD, {
  action: 'wbgetentities', ids: [...new Set(ids)].join('|'), props: 'labels|aliases|claims|sitelinks',
  languages: 'en|zh|zh-hans|zh-hant', format: 'json',
}))).data).entities;
const detailUrl = (id: number) => endpoint(`https://api.themoviedb.org/3/movie/${id}`, {
  language: 'en-US', append_to_response: 'credits,external_ids,videos,translations,alternative_titles',
});
export function failure(error: unknown) {
  return { status: error instanceof SourceError ? error.kind : 'error' as const,
    reason: error instanceof SourceError ? error.message : 'Unexpected data shape. 响应结构异常。' };
}
export async function tmdb(client: Client, row: Row, broaden = false): Promise<void> {
  try {
    const candidates = new Map<number, unknown>(broaden ? array(row.details.tmdbSearchCandidates).map(object).map((c) => [Number(c.id), c]) : []);
    let truncated = broaden && row.details.tmdbSearchTruncated === true;
    const searchPages = async (query: string, year: number | undefined, stopEarly: boolean) => {
      const params: Record<string, string> = { query, language: /\p{Script=Han}/u.test(query) ? 'zh-CN' : 'en-US', include_adult: 'false', page: '1' };
      if (year !== undefined) params.primary_release_year = String(year);
      const results: ObjectValue[] = [];
      let pages = 1;
      for (let page = 1; page <= Math.min(MATCH_POLICY.maxPages, pages); page++) {
        const search = object((await client.get(endpoint('https://api.themoviedb.org/3/search/movie', { ...params, page: String(page) }))).data);
        if (!Array.isArray(search.results)) throw new Error('Invalid search page. 搜索分页无效。');
        pages = Number(search.total_pages) || 1;
        results.push(...array(search.results).map(object));
        if (stopEarly && pages > MATCH_POLICY.maxPages) break;
      }
      return { results, complete: pages <= MATCH_POLICY.maxPages };
    };
    const window = broaden || row.sample.year === undefined ? undefined
      : { from: row.sample.year - MATCH_POLICY.yearWindow, to: row.sample.year + MATCH_POLICY.yearWindow };
    search: for (const query of [...new Set([row.sample.originalTitle, row.sample.title, ...row.sample.aliases].filter((title): title is string => Boolean(title)))]) {
      // An unfiltered search that fits within the page limit already holds every year-filtered result,
      // so the year window is applied locally; year-by-year searches remain for titles with more results.
      const open = await searchPages(query, undefined, window !== undefined);
      let found: ObjectValue[] = [];
      if (!window) { found = open.results; truncated ||= !open.complete; }
      else if (open.complete) {
        found = open.results.filter((result) => {
          const year = Number(string(result.release_date).slice(0, 4));
          return year >= window.from && year <= window.to;
        });
      } else {
        for (let year = window.from; year <= window.to; year++) {
          const filtered = await searchPages(query, year, false);
          truncated ||= !filtered.complete;
          found.push(...filtered.results);
        }
      }
      for (const result of found) {
        if (typeof result.id === 'number' && Number.isSafeInteger(result.id) && result.id > 0) {
          if (!candidates.has(result.id) && candidates.size >= MATCH_POLICY.maxCandidates) { truncated = true; break search; }
          candidates.set(result.id, result);
        }
      }
    }
    row.details.tmdbSearchCandidates = [...candidates.values()];
    row.details.tmdbSearchTruncated = truncated;
    const blocked = searchBlocker(candidates.size, truncated);
    if (!candidates.size && blocked) {
      if (blocked.status === 'miss' && !broaden && row.sample.year !== undefined) { await tmdb(client, row, true); return; }
      row.fields.tmdbMatch = blocked;
      row.details.matchAudit = chooseMovie(row.sample, [...candidates.values()], truncated).audit;
      row.notes.push(blocked.reason);
      return;
    }
    const movies: unknown[] = [];
    for (const id of candidates.keys()) {
      try { movies.push((await client.get(detailUrl(id))).data); }
      catch (error) {
        if (!(error instanceof SourceError && error.resourceMissing)) throw error;
        row.details.tmdbMissingCandidates = [...array(row.details.tmdbMissingCandidates), id];
        row.notes.push('候选详情资源已不存在，已记录本地编号并继续核对其他候选');
      }
    }
    row.details.tmdbCandidates = movies;
    const people: People = {};
    for (const movie of movies.map(object).filter((m) => titleMatches(row.sample, m))) {
      if (!row.sample.directors.length || directorSignal(row.sample, movie, people).state === 'match') continue;
      for (const person of movieDirectors(movie)) {
        if (!Number.isSafeInteger(person.id) || Number(person.id) <= 0 || people[String(person.id)]) continue;
        const url = endpoint(`https://api.themoviedb.org/3/person/${person.id}`, { language: 'en-US' });
        let requestedUrl = url;
        try {
          const data = object((await client.get(url)).data);
          if (data.id !== person.id) throw new Error('Person ID mismatch. 人物编号不符。');
          people[String(person.id)] = { names: [string(data.name), ...array(data.also_known_as).map(string)].filter(Boolean), url };
          const identity = people[String(person.id)];
          if (row.sample.directors.some((name) => /\p{Script=Han}/u.test(name))
            && !row.sample.directors.some((name) => identity.names.some((alias) => sameName(name, alias)))) {
            const translatedUrl = endpoint(`https://api.themoviedb.org/3/person/${person.id}`, { language: 'zh-CN' });
            requestedUrl = translatedUrl;
            const translated = object((await client.get(translatedUrl)).data);
            if (translated.id !== person.id) throw new Error('Person ID mismatch. 人物编号不符。');
            identity.names = [...new Set([...identity.names, string(translated.name), ...array(translated.also_known_as).map(string)].filter(Boolean))];
            identity.urls = [url, translatedUrl];
          }
        } catch (error) {
          row.notes.push('部分候选人物别名未取得，保留现有姓名证据');
          row.details.directorAliasIssues = [...array(row.details.directorAliasIssues), { personId: person.id, url: requestedUrl, ...failure(error) }];
        }
      }
    }
    row.details.directorAliases = people;
    const result = chooseMovie(row.sample, movies, truncated, people);
    row.details.matchAudit = result.audit;
    row.fields.tmdbMatch = result.match;
    row.details.identity = result.decision;
    const directorVerified = result.movie && directorSignal(row.sample, result.movie, people).state === 'match';
    if ((!result.movie || row.sample.directors.length > 0 && !directorVerified) && !broaden && row.sample.year !== undefined) {
      await tmdb(client, row, true); return;
    }
    if (!result.movie) { row.notes.push(result.match.reason); return; }
    if (truncated) row.notes.push('候选搜索截断，唯一明确导演锚点确认；未声称完整召回');
    if (directorSignal(row.sample, result.movie, people).state === 'phonetic') row.notes.push('导演使用完整拼音对应作为较弱佐证');
    const candidateYear = Number(string(result.movie.release_date).slice(0, 4));
    if (row.sample.year === undefined) row.notes.push('来源缺年份，通过独立身份锚点确认');
    else if (candidateYear && candidateYear !== row.sample.year) row.notes.push(`来源年份与候选相差 ${Math.abs(candidateYear - row.sample.year)} 年，保留两者原值`);
    const fields = movieFields(result.movie);
    Object.assign(row.fields, fields.fields);
    row.details.tmdb = fields.details;
    try {
      const config = object((await client.get('https://api.themoviedb.org/3/configuration')).data);
      const poster = movieFields(result.movie, string(object(config.images).secure_base_url));
      row.fields.poster = poster.fields.poster;
      fields.details.posterUrl = poster.details.posterUrl;
    } catch (error) { row.fields.poster = failure(error); }
    const originalLanguage = string(result.movie.original_language);
    if (row.fields.trailer.status !== 'hit' && /^[a-z]{2}$/.test(originalLanguage) && originalLanguage !== 'en') {
      try {
        const videos = object((await client.get(endpoint(`https://api.themoviedb.org/3/movie/${result.movie.id}/videos`, { language: originalLanguage }))).data);
        if (!Array.isArray(videos.results)) throw new Error('Invalid videos. 视频响应无效。');
        const trailer = movieFields({ ...result.movie, videos });
        row.fields.trailer = trailer.fields.trailer;
        fields.details.trailerUrl = trailer.details.trailerUrl;
        fields.details.originalLanguageVideos = videos;
      } catch (error) { row.fields.trailer = failure(error); }
    }
    if (evidenceVector(row.sample, result.movie, true, people).runtime.state === 'different') {
      row.notes.push('身份确认，片长差异超过对应时长容差；保留版本差异，原因未知');
    }
  } catch (error) { row.fields.tmdbMatch = failure(error); row.details.identity = 'unconfirmed'; }
}

export async function wikidata(client: Client, row: Row, rules: RatingRule[]) {
  if (row.fields.tmdbMatch.status !== 'hit') return;
  try {
    const movie = object(object(row.details.tmdb).movie);
    const external = object(movie.external_ids);
    const direct = string(external.wikidata_id);
    const ids = new Set<string>();
    if (/^Q\d+$/.test(direct)) ids.add(direct);
    else {
      for (const query of [...new Set([row.sample.title, ...row.sample.aliases, string(movie.title), string(movie.original_title)])].filter(Boolean)) {
        const response = object((await client.get(endpoint(WD, { action: 'wbsearchentities', search: query,
          language: /\p{Script=Han}/u.test(query) ? 'zh' : 'en', limit: '10', type: 'item', format: 'json',
        }))).data);
        if (!Array.isArray(response.search)) throw new Error('Invalid search. 搜索结果无效。');
        for (const value of response.search) if (/^Q\d+$/.test(string(object(value).id))) ids.add(string(object(value).id));
      }
    }
    const entities = ids.size ? Object.values(object(await getEntities(client, [...ids]))) : [];
    row.details.wikidataCandidates = entities;
    const matched = entities.filter((entity) => {
      const tmdb = externalId(entity, 'P4947', /^\d+$/);
      const imdb = externalId(entity, 'P345', /^tt\d+$/);
      const identified = tmdb.value === String(movie.id) || string(object(entity).id) === direct;
      if (identified && ((tmdb.value && tmdb.value !== String(movie.id))
        || (imdb.value && string(external.imdb_id) && imdb.value !== external.imdb_id)
        || tmdb.evidence.status === 'ambiguous' || imdb.evidence.status === 'ambiguous')) {
        row.details.idConflict = true;
        row.notes.push('已关联实体的外部 ID 冲突，暂停 IMDb 查表挂载');
      }
      if (tmdb.evidence.status === 'ambiguous' || imdb.evidence.status === 'ambiguous') return false;
      if (tmdb.value && tmdb.value !== String(movie.id)) return false;
      if (imdb.value && string(external.imdb_id) && imdb.value !== external.imdb_id) return false;
      return tmdb.value === String(movie.id) || Boolean(imdb.value && imdb.value === external.imdb_id);
    });
    row.fields.wikidataMatch = matched.length === 1 ? evidence(true, '与已核实 TMDb／IMDb ID 交叉一致')
      : { status: matched.length || entities.length ? 'ambiguous' : 'miss', reason: 'Wikidata 候选不能通过外部 ID 唯一交叉确认' };
    if (matched.length !== 1) return;
    const entity = object(matched[0]);
    const parsed = wikidataFields(entity, rules);
    Object.assign(row.fields, parsed.fields);
    row.details.wikidata = { entity, ...parsed };
    row.notes.push(...parsed.ratings.issues);
  } catch (error) { row.fields.wikidataMatch = failure(error); }
}

export function plotSection(sections: unknown): string | undefined {
  const simplified: Record<string, string> = { 劇: '剧', 簡: '简', 綱: '纲', 節: '节' };
  const heading = (value: unknown) => string(value).replace(/<[^>]*>/g, '').replace(/[劇簡綱節]/g, (c) => simplified[c]).trim();
  const section = array(sections).map(object).find((s) => /^(?:plot(?: summary)?|synopsis|premise|story|(?:剧情|故事)(?:大纲|简介|概要|梗概)?|情节)$/i.test(heading(s.line)));
  return section && typeof section.index === 'string' && /^\d+$/.test(section.index) ? section.index : undefined;
}
export async function wikipedia(client: Client, row: Row, language: 'en' | 'zh') {
  if (row.fields.wikidataMatch.status !== 'hit') return;
  const field = language === 'en' ? 'wikipediaEn' : 'wikipediaZh';
  const entity = object(object(row.details.wikidata).entity);
  const title = string(object(object(entity.sitelinks)[`${language}wiki`]).title);
  if (!title) { row.fields[field] = evidence(false, '没有对应语言文章'); return; }
  try {
    const api = `https://${language}.wikipedia.org/w/api.php`;
    const head = object(object((await client.get(endpoint(api, { action: 'parse', page: title, prop: 'sections|revid', redirects: '1', format: 'json' }))).data).parse);
    if (!Array.isArray(head.sections) || typeof head.revid !== 'number') throw new Error('Invalid article. 文章响应无效。');
    const section = plotSection(head.sections);
    if (section === undefined) { row.fields[field] = evidence(false, '文章没有已识别剧情小节'); return; }
    const body = object(object((await client.get(endpoint(api, { action: 'parse', oldid: String(head.revid), section, prop: 'wikitext', format: 'json' }))).data).parse);
    const text = string(object(body.wikitext)['*']);
    const rights = object(object((await client.get(endpoint(api, { action: 'query', meta: 'siteinfo', siprop: 'rightsinfo', format: 'json' }))).data).query).rightsinfo;
    row.fields[field] = evidence(Boolean(text.replace(/^=+.*?=+\s*/g, '').trim()), '固定修订剧情小节；页面附加署名待逐页核查');
    row.details[field] = { title, revision: head.revid, section, text, rights,
      articleUrl: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
      revisionUrl: `https://${language}.wikipedia.org/w/index.php?oldid=${head.revid}`,
      changes: 'Unmodified plot section in wikitext. 原样保留剧情小节 wikitext。',
    };
  } catch (error) { row.fields[field] = failure(error); }
}
export const newRow = (sample: Sample): Row => ({ sample, notes: [], details: { identity: 'unconfirmed' },
  fields: Object.fromEntries(FIELDS.map((field) => [field, { status: 'untested', reason: '前置匹配或来源尚未完成' }])),
});
