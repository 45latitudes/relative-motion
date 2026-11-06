import type { AirlineCode } from './parse.ts';
import type { RoundEntry } from './rounds.ts';

// Catalogue addresses registered in docs/sources.md.
export const catalogueUrls: Record<AirlineCode, string[]> = {
  UA: Array.from({ length: 12 }, (_, index) =>
    `https://www.unitedprivatescreening.com/assets/local-content/all_content_${String(index + 1).padStart(2, '0')}.json`),
  // `/movies` only shows four 12-film carousels; the full catalogue is on `/catalog/movies`.
  CI: ['https://entertainment.china-airlines.com/catalog/movies'],
  CA: ['https://webresource.airchina.com.cn/zh-CN/content/travel_info/flight_experience/entertainment/'],
};

export const userAgent = 'RelativeMotion/0.1 (+https://github.com/45latitudes/relative-motion; contact: relativemotion@icloud.com)';
export const roundIntervalMs = 14 * 86_400_000;
export const domainGapMs = 2_000;

export interface CollectOptions {
  // Every earlier request to airline catalogues, from all rounds.
  history: RoundEntry[];
  now: () => number;
  wait: (ms: number) => Promise<unknown>;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  save: (airline: AirlineCode, index: number, body: string) => string;
  // Owner-approved during development only; the host gap and stop-on-failure still apply.
  ignoreInterval?: boolean;
}

export type CollectResult =
  | { airline: AirlineCode; status: 'skipped'; nextAllowedAt: string }
  | { airline: AirlineCode; status: 'collected' | 'failed'; entries: RoundEntry[] };

export function nextAllowedAt(history: RoundEntry[], airline: AirlineCode): number | undefined {
  const times = history.filter((entry) => entry.airline === airline).map((entry) => Date.parse(entry.fetchedAt));
  return times.length ? Math.max(...times) + roundIntervalMs : undefined;
}

// Signs that a site wants a human; the airline is stopped rather than worked around.
const blocked = (body: string) => /captcha|are you a robot|access denied|attention required/i.test(body);

// Collects one airline. A failure stops that airline only, and never retries or changes headers.
export async function collectAirline(airline: AirlineCode, options: CollectOptions, lastStart: Map<string, number>): Promise<CollectResult> {
  const allowed = nextAllowedAt(options.history, airline);
  if (!options.ignoreInterval && allowed !== undefined && options.now() < allowed) {
    return { airline, status: 'skipped', nextAllowedAt: new Date(allowed).toISOString() };
  }
  const entries: RoundEntry[] = [];
  for (const [index, url] of catalogueUrls[airline].entries()) {
    const host = new URL(url).hostname;
    const previous = lastStart.get(host);
    if (previous !== undefined) await options.wait(Math.max(0, domainGapMs - (options.now() - previous)));
    lastStart.set(host, options.now());
    const fetchedAt = new Date(options.now()).toISOString();
    try {
      const response = await options.fetcher(url, { headers: { 'User-Agent': userAgent }, redirect: 'manual' });
      const body = await response.text();
      if (response.status !== 200 || blocked(body)) {
        entries.push({ airline, url, fetchedAt, status: response.status });
        return { airline, status: 'failed', entries };
      }
      entries.push({ airline, url, fetchedAt, status: 200, file: options.save(airline, index, body) });
    } catch {
      entries.push({ airline, url, fetchedAt, status: 0 });
      return { airline, status: 'failed', entries };
    }
  }
  return { airline, status: 'collected', entries };
}
