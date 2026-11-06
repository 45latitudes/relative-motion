import { expect, test } from 'vitest';
import { awardEntries, awardIds, awardItems, preferredLabel } from './awards.ts';

// Synthetic Wikidata statements; the IDs and names are made up.
const snak = (id: string) => ({ snaktype: 'value', datavalue: { value: { id } } });
const statement = (id: string, extra: Record<string, unknown> = {}) => ({ rank: 'normal', mainsnak: snak(id), ...extra });
const year = (y: number, precision = 9) => ({ P585: [{ snaktype: 'value', datavalue: { value: { time: `+${y}-00-00T00:00:00Z`, precision } } }] });

test('reads wins and nominations with their year and named recipients', () => {
  const wikidata = {
    awards: [statement('Q901', { qualifiers: { ...year(2001), P1346: [snak('Q951')] } }), statement('Q902')],
    nominations: [statement('Q903', { qualifiers: year(1999) }), { rank: 'normal', mainsnak: { snaktype: 'novalue' } }],
  };
  const entries = awardEntries(wikidata);
  expect(entries).toEqual([
    { kind: 'win', award: 'Q901', year: 2001, recipients: ['Q951'] },
    { kind: 'win', award: 'Q902', year: undefined, recipients: [] },
    { kind: 'nomination', award: 'Q903', year: 1999, recipients: [] },
  ]);
  expect(awardIds(entries).sort()).toEqual(['Q901', 'Q902', 'Q903', 'Q951']);
});

test('lists named awards once each, wins first and newest first, and counts the unnamed', () => {
  const entries = [
    { kind: 'nomination' as const, award: 'Q903', year: 2003, recipients: [] },
    { kind: 'win' as const, award: 'Q901', year: 2001, recipients: ['Q951', 'Q952'] },
    { kind: 'win' as const, award: 'Q901', year: 2001, recipients: ['Q953'] },
    { kind: 'win' as const, award: 'Q904', year: 2005, recipients: [] },
    { kind: 'win' as const, award: 'Q999', year: 2010, recipients: [] },
  ];
  const labels = { Q901: 'Prize A', Q903: 'Prize C', Q904: 'Prize D', Q951: 'Person One', Q953: 'Person Three' };
  expect(awardItems(entries, labels)).toEqual({
    items: [
      { kind: 'win', award: 'Prize D', year: 2005, recipients: undefined },
      { kind: 'win', award: 'Prize A', year: 2001, recipients: ['Person One', 'Person Three'] },
      { kind: 'nomination', award: 'Prize C', year: 2003, recipients: undefined },
    ],
    unnamed: 1,
  });
});

test('prefers a Simplified Chinese name, then Chinese, then English', () => {
  expect(preferredLabel({ labels: { en: { value: 'Prize' }, 'zh-hans': { value: '奖' } } })).toBe('奖');
  expect(preferredLabel({ labels: { en: { value: 'Prize' } } })).toBe('Prize');
  expect(preferredLabel({})).toBeUndefined();
});
