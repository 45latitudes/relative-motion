import { array, number, object, string, type ObjectValue, type Sample } from './model.ts';
import { extendedName, kanjiVariant, meaningfulName, phoneticName, sameName, spellingVariant, textKey, uncertainRomanization, writingSystem } from './names.ts';

export const MATCH_POLICY = { version: 'evidence-v4', margin: 12, yearWindow: 3, maxCandidates: 200, maxPages: 5 } as const;
export type SignalState = 'match' | 'near' | 'phonetic' | 'unknown' | 'different' | 'conflict';
export interface Signal { state: SignalState; points: number; delta?: number }
export type People = Record<string, { names: string[]; url: string; urls?: string[] }>;
const signal = (state: SignalState, points = 0, delta?: number): Signal => ({ state, points, ...(delta === undefined ? {} : { delta }) });
const languages: Record<string, string> = {
  en: 'en', eng: 'en', english: 'en', 英语: 'en', 英語: 'en',
  zh: 'zh', zho: 'zh', chi: 'zh', mandarin: 'zh', chinese: 'zh', 中文: 'zh', 普通话: 'zh', 國語: 'zh', 国语: 'zh',
  cn: 'cn', yue: 'cn', cantonese: 'cn', 粤语: 'cn', 廣東話: 'cn', 廣東语: 'cn',
  ja: 'ja', jpn: 'ja', japanese: 'ja', 日语: 'ja', 日語: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko', 韩语: 'ko', 韓語: 'ko',
  de: 'de', deu: 'de', ger: 'de', german: 'de', 德语: 'de',
  fr: 'fr', fra: 'fr', fre: 'fr', french: 'fr', 法语: 'fr',
  es: 'es', spa: 'es', spanish: 'es', 西班牙语: 'es',
  hi: 'hi', hin: 'hi', hindi: 'hi', 印地语: 'hi',
};
export const languageCode = (value: unknown): string | undefined => {
  const raw = string(value).trim().toLowerCase();
  return languages[raw] ?? (/^[a-z]{2}$/.test(raw) ? raw : undefined);
};
export const movieDirectors = (movie: ObjectValue) => array(object(movie.credits).crew).map(object).filter((p) => p.job === 'Director' && string(p.name));
export function directorSignal(sample: Sample, movie: ObjectValue, people: People = {}): Signal {
  const source = sample.directors.filter(meaningfulName);
  const directors = movieDirectors(movie);
  const names = directors.flatMap((p) => [string(p.name), ...(people[String(p.id)]?.names ?? [])]).filter(meaningfulName);
  if (!source.length || !names.length) return signal('unknown');
  if (source.some((s) => names.some((n) => sameName(s, n)))) return signal('match', 30);
  if (source.some((s) => names.some((n) => phoneticName(s, n)))) return signal('phonetic', 20);
  // Spelling variants and longer forms of one name earn no points but are not a conflict.
  if (source.some((s) => names.some((n) => extendedName(s, n) || spellingVariant(s, n)))) return signal('near');
  // Script alone cannot establish identity conflict across transliterations. 仅文字类别相同不能证明转写姓名冲突。
  const script = (s: string) => /^\p{Script=Han}{2,4}$/u.test(s) ? 'han'
    : /^\p{Script=Latin}+$/u.test(textKey(s)) ? 'latin' : 'other';
  if (source.some((s) => names.some((n) => uncertainRomanization(s, n) || kanjiVariant(s, n)))) return signal('unknown');
  // Han names of directors from outside Chinese and Japanese cinema are translations (安國鎮 / Ahn Gooc-jin)
  // and vary between sources, so they cannot show a conflict. 外国导演的汉字名是译名，各来源译法不一，不能证明冲突。
  const hanNative = ['zh', 'cn', 'ja'].includes(string(movie.original_language));
  const comparable = (a: string, b: string) => script(a) === script(b) && script(a) !== 'other' && (script(a) !== 'han' || hanNative);
  return source.every((s) => names.some((n) => comparable(s, n))) ? signal('conflict') : signal('unknown');
}
function castSignal(source: string[], movie: ObjectValue): Signal {
  const related = (a: string, b: string) => sameName(a, b) || phoneticName(a, b);
  const groups = (credits: ObjectValue[]) => {
    const result: { names: string[]; ids: number[] }[] = [];
    for (const person of credits) {
      const name = string(person.name), id = number(person.id);
      if (!meaningfulName(name)) continue;
      const group = { names: [name], ids: id === undefined ? [] : [id] };
      for (let i = result.length - 1; i >= 0; i--) {
        if (group.ids.some((id) => result[i].ids.includes(id)) || group.names.some((a) => result[i].names.some((b) => related(a, b)))) {
          group.names.push(...result[i].names); group.ids.push(...result[i].ids); result.splice(i, 1);
        }
      }
      result.push(group);
    }
    return result;
  };
  const left = groups(source.map((name) => ({ name }))), right = groups(array(object(movie.credits).cast).map(object));
  const pair = (i: number, j: number, compare: typeof sameName) => left[i].names.some((a) => right[j].names.some((b) => compare(a, b)));
  const owners = new Map<number, number>();
  const assign = (i: number, seen: Set<number>, compare: typeof sameName, locked: Set<number>): boolean => {
    for (let j = 0; j < right.length; j++) {
      if (locked.has(j) || seen.has(j) || !pair(i, j, compare)) continue;
      seen.add(j);
      const owner = owners.get(j);
      if (owner === undefined || assign(owner, seen, compare, locked)) { owners.set(j, i); return true; }
    }
    return false;
  };
  left.forEach((_, i) => assign(i, new Set(), sameName, new Set()));
  const exact = owners.size, locked = new Set(owners.keys()), matched = new Set(owners.values());
  // Weaker forms: full-pinyin readings and Hong Kong credits with the Chinese given name appended.
  const weaker = (a: string, b: string) => phoneticName(a, b) || extendedName(a, b);
  left.forEach((_, i) => { if (!matched.has(i)) assign(i, new Set(), weaker, locked); });
  const phonetic = owners.size - exact;
  return exact >= 2 ? signal('match', 5) : exact && !phonetic ? signal('match', 2)
    : phonetic ? signal('phonetic', exact + phonetic >= 2 ? 3 : 1) : signal('unknown');
}

export function evidenceVector(sample: Sample, movie: ObjectValue, title: boolean, people: People = {}) {
  const candidateYear = /^\d{4}-\d{2}-\d{2}$/.test(string(movie.release_date)) ? Number(string(movie.release_date).slice(0, 4)) : undefined;
  const yearDelta = sample.year && candidateYear ? Math.abs(sample.year - candidateYear) : undefined;
  const year = yearDelta === undefined ? signal('unknown') : yearDelta > MATCH_POLICY.yearWindow ? signal('different', 0, yearDelta)
    : signal(yearDelta === 0 ? 'match' : 'near', yearDelta === 0 ? 10 : yearDelta === 1 ? 8 : 4, yearDelta);
  const runtime = number(movie.runtime);
  const runtimeDelta = (sample.runtime ?? 0) > 0 && (runtime ?? 0) > 0 ? Math.abs(sample.runtime! - runtime!) : undefined;
  const tolerance = runtimeDelta === undefined ? 5 : Math.min(5, Math.max(1, Math.min(sample.runtime!, runtime!) * 0.05));
  const duration = runtimeDelta === undefined ? signal('unknown') : signal(runtimeDelta <= tolerance ? 'match' : 'different', runtimeDelta <= tolerance ? 20 : 0, runtimeDelta);
  const director = directorSignal(sample, movie, people);
  const cast = castSignal(sample.cast ?? [], movie);
  const original = languageCode(movie.original_language);
  const sourceOriginal = languageCode(sample.originalLanguage);
  const audio = (sample.audioLanguages ?? []).map(languageCode).filter(Boolean);
  const language = original && sourceOriginal ? signal(original === sourceOriginal ? 'match' : 'different', original === sourceOriginal ? 3 : 0)
    : original && audio.includes(original) ? signal('near', 1) : signal('unknown');
  // Compare only explicit standardized codes, without inferring territorial mappings. 只比较来源明确给出的标准代码，不推断地域映射。
  const sourceCodes = (sample.productionCountryCodes ?? []).filter((c) => /^[A-Z]{2}$/.test(c));
  const countries = array(movie.production_countries).map((c) => string(object(c).iso_3166_1)).filter((c) => /^[A-Z]{2}$/.test(c));
  const country = sourceCodes.some((c) => countries.includes(c)) ? signal('match', 2) : signal('unknown');
  // Different writing systems are not comparable without an attested translation. 不同文字系统在没有来源译名时不可比较。
  const ownTitle = sample.originalTitle ?? '', candidateTitle = string(movie.original_title);
  const comparableTitles = writingSystem(ownTitle) !== undefined && writingSystem(ownTitle) === writingSystem(candidateTitle)
    && !kanjiVariant(ownTitle, candidateTitle);
  const originalTitle = !ownTitle || !candidateTitle ? signal('unknown') : textKey(ownTitle) === textKey(candidateTitle) ? signal('match')
    : comparableTitles ? signal('conflict') : signal('unknown');
  return { originalTitle, title: signal(title ? 'match' : 'different', title ? 30 : 0), director, runtime: duration, year, cast, language, country };
}
