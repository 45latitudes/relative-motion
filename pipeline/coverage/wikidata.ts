import { array, evidence, object, string, type Evidence, type ObjectValue } from './model.ts';

export function claims(entity: unknown, property: string): ObjectValue[] {
  return array(object(object(entity).claims)[property]).map(object).filter((s) => s.rank !== 'deprecated');
}
export function snakValue(snak: unknown): unknown {
  const value = object(snak);
  return value.snaktype === 'value' ? object(value.datavalue).value : undefined;
}
export const statementValue = (statement: ObjectValue): unknown => snakValue(statement.mainsnak);
export const qualifier = (statement: ObjectValue, property: string): unknown[] =>
  array(object(statement.qualifiers)[property]).map(snakValue).filter((v) => v !== undefined);
export const item = (value: unknown): string => string(object(value).id);

export function externalId(entity: unknown, property: string, pattern: RegExp): { evidence: Evidence; value?: string } {
  const valid = claims(entity, property).filter((s) => pattern.test(string(statementValue(s))));
  const preferred = valid.filter((s) => s.rank === 'preferred');
  const values = [...new Set((preferred.length ? preferred : valid).map((s) => string(statementValue(s))))];
  return values.length === 1 ? { evidence: evidence(true), value: values[0] }
    : { evidence: { status: values.length ? 'ambiguous' : 'miss', reason: values.length ? '同 rank 存在多个不同 ID' : '没有可用声明' } };
}
export function parseScore(raw: unknown): { value: number; max: number } | undefined {
  const match = string(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)|(%))$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const max = match[3] ? 100 : Number(match[2]);
  return max > 0 && value >= 0 && value <= max ? { value, max } : undefined;
}
export interface RatingRule { publisher: string; method: string; source: string; max: number }
export function dateQualifier(statement: ObjectValue): string | undefined {
  const dates = qualifier(statement, 'P585').map(object);
  if (dates.length !== 1 || Number(dates[0].precision) < 11) return undefined;
  const raw = string(dates[0].time);
  const day = raw.replace(/^\+/, '').slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day ? day : undefined;
}

export function selectRatings(entity: unknown, rules: RatingRule[]) {
  const groups = new Map<string, ObjectValue[]>();
  const issues: string[] = [];
  for (const statement of claims(entity, 'P444')) {
    const publishers = qualifier(statement, 'P447').map(item).filter(Boolean);
    const methods = qualifier(statement, 'P459').map(item).filter(Boolean);
    const qualifiers = object(statement.qualifiers);
    if (publishers.length !== 1 || methods.length !== 1 || array(qualifiers.P447).length !== 1
      || array(qualifiers.P459).length !== 1 || array(qualifiers.P518).length) {
      issues.push('P444 机构／口径不唯一、缺失或指定适用部分'); continue;
    }
    const key = `${publishers[0]}|${methods[0]}`;
    groups.set(key, [...groups.get(key) ?? [], statement]);
  }
  const selected: { source: string; value: number; max: number; date?: string; votes?: number; statement: ObjectValue }[] = [];
  for (const [key, all] of groups) {
    const mapped = rules.filter((rule) => `${rule.publisher}|${rule.method}` === key);
    if (mapped.length !== 1) { issues.push('P444 机构与口径映射待确认'); continue; }
    const rule = mapped[0];
    const preferred = all.filter((s) => s.rank === 'preferred');
    let pool = preferred.length ? preferred : all;
    if (pool.length > 1) {
      if (pool.some((s) => !dateQualifier(s))) { issues.push('P444 同 rank 多值缺完整日期'); continue; }
      const latest = pool.map((s) => dateQualifier(s)!).sort().at(-1);
      pool = pool.filter((s) => dateQualifier(s) === latest);
    }
    if (pool.length !== 1) { issues.push('P444 最新日期不能唯一消歧'); continue; }
    const statement = pool[0];
    const score = parseScore(statementValue(statement));
    if (!score || score.max !== rule.max) { issues.push('P444 量尺不明或不符映射'); continue; }
    const voteValues = qualifier(statement, 'P7887');
    const vote = voteValues.length === 1 ? Number(object(voteValues[0]).amount) : NaN;
    selected.push({ source: rule.source, ...score, date: dateQualifier(statement), votes: Number.isSafeInteger(vote) && vote >= 0 ? vote : undefined, statement });
  }
  const duplicateSources = new Set(selected.filter((r, i, all) => all.some((v, j) => j !== i && v.source === r.source)).map((r) => r.source));
  if (duplicateSources.size) issues.push('P444 多个口径映射到同一 source');
  return { selected: selected.filter((r) => !duplicateSources.has(r.source)), issues: [...new Set(issues)] };
}

export function wikidataFields(entity: unknown, rules: RatingRule[]) {
  const definitions: [string, string, RegExp][] = [
    ['imdbId', 'P345', /^tt\d+$/], ['doubanId', 'P4529', /^\d+$/], ['rottenTomatoesId', 'P1258', /^m\/.+/],
    ['metacriticId', 'P1712', /^movie\/.+/], ['letterboxdId', 'P6127', /^(?:film:[1-9]\d*|[a-z0-9]+(?:[-_][a-z0-9]+)*)$/],
  ];
  const fields: Record<string, Evidence> = {};
  const ids: Record<string, string> = {};
  for (const [field, property, pattern] of definitions) {
    const result = externalId(entity, property, pattern);
    fields[field] = result.evidence;
    if (result.value) ids[field] = result.value;
  }
  const awards = claims(entity, 'P166').filter((s) => item(statementValue(s)));
  const nominations = claims(entity, 'P1411').filter((s) => item(statementValue(s)));
  const ratings = selectRatings(entity, rules);
  Object.assign(fields, {
    awards: evidence(awards.length > 0), nominations: evidence(nominations.length > 0),
    p444: evidence(claims(entity, 'P444').length > 0),
    p444Usable: { status: ratings.selected.length ? 'hit' : ratings.issues.length ? 'ambiguous' : 'miss', reason: ratings.issues.join('；') },
    p444Dated: !ratings.selected.length && ratings.issues.length
      ? { status: 'ambiguous', reason: '评分口径尚未消歧，暂不判定可用日期覆盖' }
      : evidence(ratings.selected.some((r) => r.date)),
  });
  return { fields, ids, awards, nominations, ratings };
}
