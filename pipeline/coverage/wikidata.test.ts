import { expect, test } from 'vitest';
import { statement, rating, rules, itemSnak, sections } from '../../fixtures/coverage-wikidata.ts';
import { externalId, parseScore, selectRatings, wikidataFields } from './wikidata.ts';
import { plotSection } from './enrich.ts';

test('filters movie prefixes before rank and rejects conflicting IDs; 先筛电影前缀再选 rank 并拒绝冲突', () => {
  const entity = { claims: { P1258: [statement('tv/synthetic', 'preferred'), statement('m/synthetic'), statement('m/old', 'deprecated')] } };
  expect(externalId(entity, 'P1258', /^m\/.+/).value).toBe('m/synthetic');
  entity.claims.P1258.push(statement('m/other'));
  expect(externalId(entity, 'P1258', /^m\/.+/).evidence.status).toBe('ambiguous');
  entity.claims.P1258.push(statement('m/preferred', 'preferred'));
  expect(externalId(entity, 'P1258', /^m\/.+/).value).toBe('m/preferred');
});
test('keeps awards and nominations separate and preserves normal awards; 分离获奖提名并保留 normal 奖项', () => {
  const result = wikidataFields({ claims: {
    P166: [statement({ id: 'Q900010' }, 'preferred'), statement({ id: 'Q900011' }), statement({ id: 'Q900012' }, 'deprecated')],
    P1411: [statement({ id: 'Q900013' })],
  } }, rules);
  expect(result.awards).toHaveLength(2);
  expect(result.nominations).toHaveLength(1);
});
test('selects rank per publisher and method and then unique latest date; 按机构口径分组后选 rank 和唯一最新日期', () => {
  const result = selectRatings({ claims: { P444: [
    rating('60/100', { rank: 'preferred', date: '2026-01-01' }),
    rating('80/100', { rank: 'preferred', date: '2026-02-01' }),
    rating('90/100', { date: '2026-03-01' }),
    rating('7.2/10', { publisher: 'Q900003', method: 'Q900004' }),
    rating('99/100', { rank: 'deprecated' }),
  ] } }, rules);
  expect(result.selected.map((r) => [r.source, r.value, r.date, r.votes])).toEqual([
    ['synthetic-critic', 80, '2026-02-01', 123], ['synthetic-average', 7.2, undefined, 123],
  ]);
});
test('refuses ambiguous dates, scopes, mappings and scales; 拒绝歧义日期范围映射与量尺', () => {
  const cases = [
    [rating(), rating('90/100', { date: '2026-01-01' })],
    [rating('80/100', { date: '2026-01-01' }), rating('90/100', { date: '2026-01-01' })],
    [rating('80/100', { date: '2026-02-30' }), rating('90/100', { date: '2026-03-01' })],
    [rating('80/100', { date: '2026-01-01', precision: 10 }), rating('90/100', { date: '2026-03-01' })],
    [{ ...rating(), qualifiers: { ...rating().qualifiers, P518: [itemSnak('Q900020')] } }],
    [rating('8/10')], [rating('80')], [rating('80/100', { method: 'Q900099' })],
  ];
  for (const values of cases) {
    const result = selectRatings({ claims: { P444: values } }, rules);
    expect(result.selected).toHaveLength(0);
    expect(result.issues.length).toBeGreaterThan(0);
  }
  expect(parseScore('3.7/5')).toEqual({ value: 3.7, max: 5 });
  expect(parseScore('82%')).toEqual({ value: 82, max: 100 });
  expect(parseScore('120%')).toBeUndefined();
});
test('enforces one metric per source; 每个 source 只允许一个指标', () => {
  const result = selectRatings({ claims: { P444: [rating(), rating('7/10', { publisher: 'Q900003', method: 'Q900004' })] } },
    rules.map((r) => ({ ...r, source: 'synthetic' })));
  expect(result.selected).toHaveLength(0);
});
test('locates plot sections without mistaking cast for plot; 提取剧情章节并区分演职员表', () => {
  expect(plotSection(sections)).toBe('2');
  expect(plotSection([sections[1]])).toBeUndefined();
});
