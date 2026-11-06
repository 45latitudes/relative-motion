import { array, object, string, type ObjectValue } from '../coverage/model.ts';
import { item, qualifier, statementValue } from '../coverage/wikidata.ts';

// Award details from the Wikidata statements kept with each match: P166 (award received) and
// P1411 (nominated for), each with its year (P585) and named recipients (P1346). Names come
// from a separate label table read from Wikidata; an award without a known name is left out.
export interface AwardEntry { kind: 'win' | 'nomination'; award: string; year?: number; recipients: string[] }
export interface AwardItem { kind: 'win' | 'nomination'; award: string; year?: number; recipients?: string[] }

const yearOf = (statement: ObjectValue): number | undefined => {
  const dates = qualifier(statement, 'P585').map(object);
  if (dates.length !== 1 || Number(dates[0].precision) < 9) return undefined;
  const year = Number.parseInt(string(dates[0].time).replace(/^\+/, '').slice(0, 4), 10);
  return Number.isInteger(year) && year > 1800 ? year : undefined;
};

export function awardEntries(wikidata: ObjectValue): AwardEntry[] {
  const entries = (statements: unknown, kind: AwardEntry['kind']) => array(statements).map(object)
    .map((statement) => ({
      kind,
      award: item(statementValue(statement)),
      year: yearOf(statement),
      recipients: qualifier(statement, 'P1346').map(item).filter(Boolean),
    }))
    .filter((entry) => /^Q\d+$/.test(entry.award));
  return [...entries(wikidata.awards, 'win'), ...entries(wikidata.nominations, 'nomination')];
}

export const awardIds = (entries: AwardEntry[]): string[] =>
  [...new Set(entries.flatMap((entry) => [entry.award, ...entry.recipients]))];

// One display name per item: Simplified Chinese first, then any Chinese, then English.
export function preferredLabel(entity: unknown): string | undefined {
  const labels = object(object(entity).labels);
  for (const language of ['zh-hans', 'zh', 'zh-hant', 'en']) {
    const value = string(object(labels[language]).value).trim();
    if (value) return value;
  }
  return undefined;
}

// Wins before nominations, newest first. Statements for the same award in the same year (one per
// recipient, say) are listed once with all their recipients. `unnamed` counts the awards left
// out because their names could not be read.
export function awardItems(entries: AwardEntry[], labels: Record<string, string>): { items: AwardItem[]; unnamed: number } {
  const merged = new Map<string, AwardEntry>();
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.award}|${entry.year ?? ''}`;
    const kept = merged.get(key);
    if (kept) kept.recipients = [...new Set([...kept.recipients, ...entry.recipients])];
    else merged.set(key, { ...entry, recipients: [...entry.recipients] });
  }
  let unnamed = 0;
  const items: AwardItem[] = [];
  for (const entry of merged.values()) {
    const award = labels[entry.award];
    if (!award) { unnamed += 1; continue; }
    const recipients = entry.recipients.map((id) => labels[id]).filter((name): name is string => Boolean(name));
    items.push({ kind: entry.kind, award, year: entry.year, recipients: recipients.length ? recipients : undefined });
  }
  items.sort((a, b) => (a.kind === b.kind ? (b.year ?? 0) - (a.year ?? 0) : a.kind === 'win' ? -1 : 1));
  return { items, unnamed };
}
