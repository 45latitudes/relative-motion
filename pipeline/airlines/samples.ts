import { createHash } from 'node:crypto';
import type { Sample } from '../coverage/model.ts';
import type { Observation } from './parse.ts';

export const sampleId = (o: Observation) => `${o.airline}-${o.sourceId}`.replace(/[^\w-]/g, '_');

// Extra titles hidden in airline formatting: a trailing year ("Moana (2026)") and a trailing
// parenthesis holding the original or romanised title ("Wild Heart (Ponyherz)").
export function titleVariants(title: string): string[] {
  const base = title.trim();
  const variants = new Set<string>();
  const withoutYear = base.replace(/\s*\((?:19|20)\d{2}\)$/, '').trim();
  variants.add(withoutYear);
  const parenthesis = /^(.+?)\s*\(([^()]+)\)$/.exec(withoutYear);
  if (parenthesis) {
    variants.add(parenthesis[1].trim());
    variants.add(parenthesis[2].trim());
  }
  variants.delete(base);
  return [...variants].filter(Boolean);
}

// Turns an airline observation into the input the T-05 matching rules expect.
export function sampleOf(o: Observation, round: string): Sample {
  return {
    id: sampleId(o), airline: o.airline, title: o.title,
    aliases: [...new Set([...Object.values(o.titles), ...Object.values(o.titles).flatMap(titleVariants)])]
      .filter((title) => title !== o.title),
    year: o.year, runtime: o.runtime, directors: o.directors, cast: o.cast, audioLanguages: o.audioLanguages, tags: [],
    source: `airlines/rounds/${round}`, sourceSha256: createHash('sha256').update(JSON.stringify(o.raw)).digest('hex'),
    sourceRecord: o.sourceId, observedAt: o.observedAt, editionNote: '',
  };
}
