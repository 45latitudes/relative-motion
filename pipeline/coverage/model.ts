import { CoverageError } from './errors.ts';
export type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string => typeof value === 'string' ? value : '';
export const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const normalize = (value: string): string => value.normalize('NFKD').toLowerCase()
  .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');

export type Status = 'hit' | 'miss' | 'ambiguous' | 'untested' | 'error';
export interface Sample {
  id: string;
  title: string;
  aliases: string[];
  originalTitle?: string;
  year?: number;
  runtime?: number;
  directors: string[];
  cast?: string[];
  originalLanguage?: string;
  audioLanguages?: string[];
  productionCountryCodes?: string[];
  tags: string[];
  airline: string;
  source: string;
  sourceSha256: string;
  sourceRecord: string;
  observedAt: string;
  editionNote: string;
}
export interface Evidence {
  status: Status;
  reason: string;
}
export interface Row {
  sample: Sample;
  fields: Record<string, Evidence>;
  notes: string[];
  details: ObjectValue;
}
export const evidence = (present: boolean, reason = ''): Evidence => ({ status: present ? 'hit' : 'miss', reason });
export const FIELDS = [
  'tmdbMatch', 'englishTitle', 'originalTitle', 'chineseTitle', 'originalLanguage', 'year', 'runtime', 'directors',
  'cast', 'genres', 'overview', 'tmdbRating', 'poster', 'trailer',
  'wikidataMatch', 'imdbId', 'doubanId', 'rottenTomatoesId', 'metacriticId', 'letterboxdId',
  'awards', 'nominations', 'p444', 'p444Usable', 'p444Dated', 'wikipediaEn', 'wikipediaZh', 'imdbRating',
] as const;

export function parseSamples(input: unknown, expected = 20): Sample[] {
  if (!Array.isArray(input) || input.length !== expected) throw new CoverageError('Expected sample count. 样本数量不符。');
  const ids = new Set<string>();
  return input.map((value) => {
    const row = object(value);
    for (const field of ['id', 'title', 'airline', 'source', 'sourceSha256', 'sourceRecord', 'observedAt']) {
      if (!string(row[field]).trim()) throw new CoverageError('Missing sample provenance. 样本溯源字段缺失。');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(string(row.id)) || ids.has(string(row.id))) {
      throw new CoverageError('Invalid or duplicate sample ID. 样本编号无效或重复。');
    }
    if (!/^[a-f0-9]{64}$/.test(string(row.sourceSha256)) || /^(?:\/|[A-Z]:)/i.test(string(row.source))) {
      throw new CoverageError('Use a relative source path and SHA-256. 来源须使用相对路径及 SHA-256。');
    }
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(string(row.observedAt))) {
      throw new CoverageError('Invalid observation date. 观测日期无效。');
    }
    for (const field of ['aliases', 'directors', 'tags']) {
      if (!Array.isArray(row[field]) || array(row[field]).some((v) => !string(v).trim())) {
        throw new CoverageError('Invalid sample list. 样本列表字段无效。');
      }
    }
    for (const field of ['cast', 'audioLanguages', 'productionCountryCodes']) {
      if (row[field] !== undefined && (!Array.isArray(row[field]) || array(row[field]).some((v) => !string(v).trim()))) {
        throw new CoverageError('Invalid matching metadata list. 匹配资料列表无效。');
      }
    }
    for (const field of ['originalTitle', 'originalLanguage']) {
      if (row[field] !== undefined && !string(row[field]).trim()) throw new CoverageError('Invalid original metadata. 原片资料无效。');
    }
    for (const field of ['year', 'runtime']) {
      if (row[field] !== undefined && (!Number.isInteger(row[field]) || Number(row[field]) <= 0)) {
        throw new CoverageError('Invalid sample number. 样本数字字段无效。');
      }
    }
    ids.add(string(row.id));
    return row as unknown as Sample;
  });
}
