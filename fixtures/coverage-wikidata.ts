// Every identifier and score in these builders is synthetic. 以下构造器的编号与分数均为自造。
export const valueSnak = (value: unknown) => ({ snaktype: 'value', datavalue: { value } });
export const itemSnak = (id: string) => valueSnak({ id });
export const statement = (value: unknown, rank = 'normal') => ({ rank, mainsnak: valueSnak(value) });
export const rating = (score = '80/100', options: { publisher?: string; method?: string; date?: string; rank?: string; precision?: number } = {}) => ({
  ...statement(score, options.rank ?? 'normal'),
  qualifiers: {
    P447: [itemSnak(options.publisher ?? 'Q900001')], P459: [itemSnak(options.method ?? 'Q900002')],
    ...(options.date ? { P585: [valueSnak({ time: `+${options.date}T00:00:00Z`, precision: options.precision ?? 11 })] } : {}),
    P7887: [valueSnak({ amount: '+123' })],
  },
});
export const rules = [
  { publisher: 'Q900001', method: 'Q900002', source: 'synthetic-critic', max: 100 },
  { publisher: 'Q900003', method: 'Q900004', source: 'synthetic-average', max: 10 },
];
export const sections = [{ line: 'Synopsis', index: '2' }, { line: 'Cast', index: '3' }];
export const conflictingEntity = { id: 'Q900001', claims: {
  P4947: [statement('900001')], P345: [statement('tt9000002')],
} };
