// Fictional metadata variations exercise identity evidence without real responses. 虚构资料变化用于身份匹配验证，不使用真实响应。
export const matchingCases = [
  { name: 'adjacent year and runtime; 相邻年份与片长', sample: { directors: [] }, movie: { release_date: '2002-01-01', credits: {} }, status: 'ambiguous' },
  { name: 'previous year and runtime; 前一年与片长', sample: { directors: [] }, movie: { release_date: '2000-01-01', credits: {} }, status: 'ambiguous' },
  { name: 'director with missing runtime; 导演佐证且缺片长', sample: {}, movie: { release_date: '2002-01-01', runtime: null }, status: 'hit' },
  { name: 'director within three years; 三年内同名同导演', sample: {}, movie: { release_date: '2004-01-01', runtime: null }, status: 'hit' },
  { name: 'unique director with distant year; 唯一同导演但年份较远', sample: {}, movie: { release_date: '2010-01-01' }, status: 'hit' },
  { name: 'missing year with corroboration; 缺年份但有佐证', sample: { year: undefined }, movie: {}, status: 'hit' },
  { name: 'missing year and director; 同时缺年份与导演', sample: { year: undefined, directors: [], aliases: [] }, movie: {}, status: 'ambiguous' },
  { name: 'missing year and runtime; 同时缺年份与片长', sample: { year: undefined, runtime: undefined }, movie: { runtime: null }, status: 'hit' },
  { name: 'director contradiction; 导演矛盾', sample: {}, movie: { credits: { crew: [{ job: 'Director', name: 'Other Person' }] } }, status: 'ambiguous' },
  { name: 'edition duration; 版本片长差异', sample: {}, movie: { runtime: 140 }, status: 'hit' },
  { name: 'runtime outside tolerance without director; 无导演佐证且片长超差', sample: { directors: [] }, movie: { runtime: 106 }, status: 'ambiguous' },
  { name: 'short film tolerance; 短片容差', sample: { runtime: 20, directors: [] }, movie: { runtime: 24 }, status: 'ambiguous' },
  { name: 'missing runtime stays missing; 零片长不作匹配证据', sample: { directors: [] }, movie: { runtime: 0 }, status: 'ambiguous' },
];
export const personAliases = { '900010': { names: ['Ari Example', '艾莉示例'], url: 'https://api.themoviedb.org/3/person/900010?language=en-US' } };
export const syntheticMetadata = { originalLanguage: 'zh', productionCountries: [{ code: 'HK', name: 'Synthetic region. 自造地区。' }] };
export const sourceAudio = ['eng', 'Mandarin', 'jpn'];
export const sourceCast = ['Casey Example', 'Jordan Example'];
export const phoneticCases: [string, string, boolean][] = [
  ['林青', 'Qing Lin', true], ['林青', 'Lin Qing', true], ['欧阳明', 'Ming Ouyang', true],
  ['王明', 'M Wang', false], ['王明', 'Wang', false], ['王明', 'Wong Ming', false], ['林青', '林清', false],
];
export const translatedEntity = { id: 'Q900001', claims: { P4947: [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: '900001' } } }] } };

// Invented names and metadata for binary identity tests. 二元身份测试的虚构姓名与资料。
export const nameVariants: [string, string, boolean][] = [
  ['宮青駿', '宫青骏', true], ['葉曉雲', '叶晓云', true], ['衞青雲', '卫青云', true],
  ['Joon-ho Park', 'Park Joon-ho', true], ['Ari Lee Example', 'Example Ari Lee', true],
  ['A Example', 'Example A', false], ['林青', '林清', false], ['Ari Example', 'Other Person', false],
  ['Ari G. Example', 'Other Person', false],
];
export const romanizedDirector = { source: 'Ching Lin', name: 'Qing Lin', language: 'zh' };
export const binaryTitles = { translated: '纸上地平线', original: 'Paper Horizon', other: 'Folded Sky', variant: '紙上地平線' };
// Invented kanji forms and writing-system variants. 虚构的日文字形与跨文字系统变体。
export const kanjiNames = { japanese: '黒沢青', chinese: '黑泽青', distinct: ['王芸', '王艺'] as const };
export const scriptTitles = { otherHan: '折疊天空', kana: 'ペーパー地平線', hangul: '종이 지평선', kanji: '黒沢地平線', simplifiedKanji: '黑泽地平线' };
export const duplicateCast = ['林青', 'Qing Lin', '林青', 'undefined', 'null', 'N/A'];
export const placeholders = ['undefined', 'null', 'N/A', 'na', '', 'unknown', '-'];
export const boundedSearchResults = (page: number) => Array.from({ length: 20 }, (_, i) => ({ id: 900100 + page * 20 + i }));
