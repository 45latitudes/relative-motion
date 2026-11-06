import { array, evidence, number, object, string, type Evidence, type ObjectValue, type Sample } from './model.ts';
import { directorSignal, evidenceVector, languageCode, MATCH_POLICY, type People } from './signals.ts';
import { textKey } from './names.ts';
import { filmMetadataView } from '../../shared/film-metadata.ts';

// Lenient keys ignore one leading English article ("Lord of the Rings: …" vs "The Lord of the Rings: …").
// They are a fallback only: "American Dream" and "The American Dream" are often different films.
const lenientKey = (title: string) => textKey(title.trim().replace(/^(?:the|a|an)\s+(?=\S)/i, ''));

export function titleMatches(sample: Sample, candidate: unknown, lenient = false): boolean {
  const titleKey = lenient ? lenientKey : textKey;
  const movie = object(candidate);
  const names = [movie.title, movie.original_title,
    ...array(object(movie.translations).translations).map((t) => object(object(t).data).title),
    ...array(object(movie.alternative_titles).titles).map((t) => object(t).title),
  ].map(string).map(titleKey).filter(Boolean);
  return [sample.originalTitle, sample.title, ...sample.aliases].filter((title): title is string => Boolean(title)).some((title) => names.includes(titleKey(title)));
}

// Airlines shorten titles: they drop a subtitle or "The Movie" ("Kallang Roar" / "Kallang Roar The
// Movie") or add a number to a first film ("Royal Tramp 1"). Such a title only counts together with a
// matching director, and never when the rest of the candidate title is a sequel number.
const sequelRest = /^(?:\d+|[ivx]+|part\b|chapter\b|vol(?:ume)?\b)/i;
export function shortenedTitle(sample: Sample, candidate: unknown): boolean {
  const movie = object(candidate);
  const names = [movie.title, movie.original_title, ...array(object(movie.alternative_titles).titles).map((t) => object(t).title)]
    .map(string).filter(Boolean);
  const plain = (title: string) => title.trim().replace(/^(?:the|a|an)\s+(?=\S)/i, '').toLowerCase();
  return [sample.title, ...sample.aliases].filter(Boolean).some((own) => {
    const base = plain(own).replace(/\s+(?:1|i|part (?:1|one))$/i, '');
    if (base.length < 4) return false;
    return names.some((name) => {
      const other = plain(name);
      if (textKey(other) === textKey(base)) return true;
      if (!other.startsWith(base)) return false;
      const rest = other.slice(base.length);
      const sub = /^\s*[:\-–—]\s*(.+)$/.exec(rest)?.[1] ?? /^\s+(the movie)$/i.exec(rest)?.[1];
      return sub !== undefined && !sequelRest.test(sub.trim());
    });
  });
}

const han = /\p{Script=Han}/u;
export function hanTitleMatches(sample: Sample, candidate: unknown): boolean {
  const titles = [sample.title, ...sample.aliases].filter((title) => han.test(title));
  return titles.length > 0 && titleMatches({ ...sample, title: titles[0], aliases: titles.slice(1), originalTitle: undefined }, candidate);
}

export function searchBlocker(candidateCount: number, truncated: boolean): Evidence | undefined {
  if (truncated) return { status: 'ambiguous', reason: '候选搜索不完整，未取得唯一明确导演佐证' };
  if (!candidateCount) return { status: 'miss', reason: '未找到片名或译名一致的候选' };
}

type TitleMode = 'strict' | 'article' | 'shortened';

export function chooseMovie(sample: Sample, candidates: unknown[], truncated = false, people: People = {}, lenient = false): ReturnType<typeof decide> {
  const strict = decide(sample, candidates, truncated, people, lenient ? 'article' : 'strict');
  const hasTitle = (result: typeof strict) => result.audit.candidates.some((c) => c.vector.title.state === 'match');
  // Looser titles apply only when no candidate shares the exact title, one step at a time.
  if (lenient || hasTitle(strict)) return strict;
  const relaxed = decide(sample, candidates, truncated, people, 'article');
  if (hasTitle(relaxed)) return relaxed;
  const shortened = decide(sample, candidates, truncated, people, 'shortened');
  return hasTitle(shortened) ? shortened : strict;
}

function decide(sample: Sample, candidates: unknown[], truncated: boolean, people: People, mode: TitleMode) {
  const unique = new Map<unknown, ObjectValue>();
  candidates.map(object).forEach((movie) => unique.set(movie.id ?? movie, movie));
  const ranked = [...unique.values()].map((movie) => {
    const title = mode === 'shortened'
      ? shortenedTitle(sample, movie) && directorSignal(sample, movie, people).state === 'match'
      : titleMatches(sample, movie, mode === 'article');
    const vector = evidenceVector(sample, movie, title, people);
    const score = Object.values(vector).reduce((total, signal) => total + signal.points, 0);
    const nearbyYear = vector.year.delta !== undefined && vector.year.delta <= 1;
    // Airlines sometimes credit the wrong director (a writer, a producer, another film's director).
    // Two shared cast members with the year and runtime outweigh that single conflict. Remakes and
    // sequels share cast too, but in the full catalogue all of them were ten or more years apart.
    const waived = vector.director.state === 'conflict' && vector.cast.points >= 3 && nearbyYear && vector.runtime.state === 'match'
      ? ['director'] : [];
    const conflicts = [vector.director.state === 'conflict' && !waived.length ? '导演信息冲突' : '',
      vector.originalTitle.state === 'conflict' ? '来源原语言片名与候选原名不符' : '',
      vector.year.state === 'different' && vector.director.state !== 'match' ? '年份相差超过三年且缺少明确导演佐证' : '',
    ].filter(Boolean);
    const independent = vector.originalTitle.state === 'match' || vector.language.state === 'match'
      || vector.cast.points > 0 || vector.country.state === 'match';
    // Sources with only a Chinese title and no year (Air China): an exact attested Chinese title plus
    // the runtime anchor the film. Simulated on 146 known answers: 129 right, 1 remake wrong.
    const chineseTitleOnly = sample.year === undefined && vector.runtime.state === 'match' && hanTitleMatches(sample, movie);
    const anchored = vector.director.state === 'match' || chineseTitleOnly
      || (vector.director.state === 'phonetic' && vector.runtime.state === 'match')
      || (nearbyYear && vector.runtime.state === 'match' && independent);
    const anchoredBy = vector.director.state === 'match' || !chineseTitleOnly ? undefined : 'chinese-title';
    return { movie, vector, score, conflicts, waived, anchored, anchoredBy, eligible: vector.title.state === 'match' && !conflicts.length && anchored };
  }).sort((a, b) => b.score - a.score || Number(a.movie.id ?? 0) - Number(b.movie.id ?? 0));
  const candidatesWithTitle = ranked.filter((c) => c.vector.title.state === 'match');
  const viable = candidatesWithTitle.filter((c) => !c.conflicts.length);
  const best = viable[0];
  const margin = best && viable[1] ? best.score - viable[1].score : null;
  const audit = { policy: MATCH_POLICY, searchTruncated: truncated, margin, viableCandidates: viable.length, excludedNamesakes: candidatesWithTitle.length - viable.length, candidates: ranked.map(({ movie, ...candidate }) => ({ id: movie.id, ...candidate })) };
  const blocked = searchBlocker(ranked.length, truncated);
  const uniqueDirector = best?.vector.director.state === 'match' && candidatesWithTitle.filter((c) => c.vector.director.state === 'match').length === 1;
  if (blocked && (!truncated || !uniqueDirector)) return { decision: 'unconfirmed' as const, match: blocked, audit };
  if (best?.eligible && (margin === null || margin >= MATCH_POLICY.margin)) return {
    decision: 'confirmed' as const, match: { status: 'hit', reason: `静态证据分 ${best.score}，${margin === null ? '无其他无冲突同名候选' : `候选领先 ${margin}`}；主要证据满足组合规则${best.anchoredBy === 'chinese-title' ? '；来源无年份，由中文片名与片长确认' : ''}${mode === 'shortened' ? '；航司片名为简写，由导演确认' : ''}${best.waived.length ? '；航司导演与资料不符，由演员、年份与片长确认' : ''}${truncated ? '；搜索截断，采用唯一明确导演锚点' : ''}` } as Evidence, movie: best.movie, waived: best.waived, audit,
  };
  return { decision: 'unconfirmed' as const, match: {
    status: candidatesWithTitle.length ? 'ambiguous' : 'miss',
    reason: !candidatesWithTitle.length ? '未找到片名或译名一致的候选' : !viable.length ? [...new Set(candidatesWithTitle.flatMap((c) => c.conflicts))].join('；')
      : best?.eligible ? '多个候选证据接近，未确认' : '独立身份依据不足，未确认',
  } as Evidence, audit };
}

export function movieFields(movie: ObjectValue, imageBase?: string): { fields: Record<string, Evidence>; details: ObjectValue } {
  const translations = array(object(movie.translations).translations).map(object);
  const chinese = translations.filter((t) => t.iso_639_1 === 'zh').map((t) => string(object(t.data).title)).find(Boolean)
    || translations.filter((t) => t.iso_639_1 === 'cn').map((t) => string(object(t.data).title)).find(Boolean)
    || (['zh', 'cn'].includes(string(movie.original_language)) ? string(movie.original_title) : '');
  const english = translations.filter((t) => t.iso_639_1 === 'en').map((t) => string(object(t.data).title)).find(Boolean)
    || (movie.original_language === 'en' ? string(movie.original_title) : '');
  const crew = array(object(movie.credits).crew).map(object);
  const trailer = array(object(movie.videos).results).map(object).find((v) =>
    v.type === 'Trailer' && ((v.site === 'YouTube' && /^[\w-]+$/.test(string(v.key)))
      || (v.site === 'Vimeo' && /^\d+$/.test(string(v.key)))));
  const posterPath = string(movie.poster_path);
  const poster = imageBase?.startsWith('https://image.tmdb.org/') && /^\/[\w.-]+$/.test(posterPath)
    ? `${imageBase}w500${posterPath}` : undefined;
  const trailerUrl = trailer ? trailer.site === 'YouTube' ? `https://www.youtube.com/watch?v=${trailer.key}` : `https://vimeo.com/${trailer.key}` : undefined;
  const metadata = { originalLanguage: languageCode(movie.original_language), productionCountries: array(movie.production_countries).map(object)
    .map((c) => ({ code: string(c.iso_3166_1), name: string(c.name) })).filter((c) => c.code || c.name) };
  return { fields: {
    originalLanguage: evidence(Boolean(metadata.originalLanguage)),
    englishTitle: evidence(Boolean(english)), originalTitle: evidence(Boolean(string(movie.original_title))),
    chineseTitle: evidence(Boolean(chinese)), year: evidence(/^\d{4}-\d{2}-\d{2}$/.test(string(movie.release_date))),
    runtime: evidence((number(movie.runtime) ?? 0) > 0), directors: evidence(crew.some((p) => p.job === 'Director' && string(p.name))),
    cast: evidence(array(object(movie.credits).cast).some((p) => string(object(p).name).length > 0)),
    genres: evidence(array(movie.genres).some((g) => string(object(g).name).length > 0)), overview: evidence(Boolean(string(movie.overview).trim())),
    tmdbRating: evidence(number(movie.vote_average) !== undefined && Number(movie.vote_count) > 0),
    poster: evidence(Boolean(poster)), trailer: evidence(Boolean(trailerUrl)),
  }, details: { movie, posterUrl: poster, trailerUrl, publicMetadata: filmMetadataView(metadata, 'public'), localMetadata: filmMetadataView(metadata, 'local') } };
}
