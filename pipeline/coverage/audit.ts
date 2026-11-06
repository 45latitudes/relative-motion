import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_POLICY, type ResponseRecord } from './client.ts';

export function requestAudit(directory: string) {
  const records = readdirSync(directory).filter((f) => f.endsWith('.json') && f !== 'request-clock.json')
    .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as ResponseRecord);
  const markedFrom = records.filter((r) => r.ratePolicy === RATE_POLICY).map((r) => r.fetchedAt).sort()[0];
  const domains = ['api.themoviedb.org', 'www.wikidata.org', 'wikipedia.org'];
  const domain = (r: ResponseRecord) => { const host = new URL(r.url).hostname; return host.endsWith('.wikipedia.org') ? 'wikipedia.org' : host; };
  const minGap = (rows: ResponseRecord[]) => {
    const times = rows.map((r) => Date.parse(r.fetchedAt)).sort((a, b) => a - b);
    return times.length < 2 ? null : Math.min(...times.slice(1).map((at, i) => (at - times[i]) / 1000));
  };
  return { policy: RATE_POLICY, markedFrom, domains: domains.map((name) => {
    const all = records.filter((r) => domain(r) === name).sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const marked = all.filter((r) => r.ratePolicy === RATE_POLICY);
    const intervals = all.flatMap((r, i) => i > 0 && r.ratePolicy === RATE_POLICY
      ? [(Date.parse(r.fetchedAt) - Date.parse(all[i - 1].fetchedAt)) / 1000] : []);
    return { domain: name, requests: all.length, minGapSeconds: minGap(all), markedRequests: marked.length,
      unmarkedRequests: all.length - marked.length, markedMinGapSeconds: intervals.length ? Math.min(...intervals) : null };
  }) };
}
export type RequestAudit = ReturnType<typeof requestAudit>;
