import { expect, test } from 'vitest';
import { catalogueUrls, collectAirline, domainGapMs, roundIntervalMs, type CollectOptions } from './collect.ts';
import type { RoundEntry } from './rounds.ts';

// Simulated clock and network; no request leaves the test.
function harness(responses: (url: string) => { status: number; body: string } | Error, history: RoundEntry[] = []) {
  let clock = Date.parse('2026-11-20T00:00:00Z');
  const requests: { url: string; at: number; agent: string }[] = [];
  const options: CollectOptions = {
    history,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    fetcher: async (url, init) => {
      requests.push({ url, at: clock, agent: new Headers(init.headers).get('User-Agent') ?? '' });
      clock += 300;
      const result = responses(url);
      if (result instanceof Error) throw result;
      return new Response(result.body, { status: result.status });
    },
    save: (airline, index) => `${airline}-${index}.body`,
  };
  return { options, requests };
}
const ok = () => ({ status: 200, body: '{}' });

test('refuses a new round within 14 days of the previous one', async () => {
  const last = '2026-11-10T00:00:00.000Z';
  const { options, requests } = harness(ok, [{ airline: 'CI', url: catalogueUrls.CI[0], fetchedAt: last, status: 200, file: 'x' }]);
  const result = await collectAirline('CI', options, new Map());
  expect(result).toEqual({ airline: 'CI', status: 'skipped', nextAllowedAt: new Date(Date.parse(last) + roundIntervalMs).toISOString() });
  expect(requests).toEqual([]);
});

test('spaces requests to one host by at least two seconds and names the project', async () => {
  const { options, requests } = harness(ok);
  const result = await collectAirline('UA', options, new Map());
  expect(result.status).toBe('collected');
  expect(requests).toHaveLength(12);
  for (let index = 1; index < requests.length; index++) {
    expect(requests[index].at - requests[index - 1].at).toBeGreaterThanOrEqual(domainGapMs);
  }
  expect(requests[0].agent).toContain('relativemotion@icloud.com');
});

test('stops an airline at the first failure or human check, without retrying', async () => {
  const challenge = harness((url) => (url.endsWith('02.json') ? { status: 200, body: '<title>Captcha</title>' } : ok()));
  const stopped = await collectAirline('UA', challenge.options, new Map());
  expect(stopped.status).toBe('failed');
  expect(challenge.requests).toHaveLength(2);
  const offline = harness(() => new Error('network down'));
  const failed = await collectAirline('CA', offline.options, new Map());
  expect(failed).toMatchObject({ status: 'failed', entries: [{ status: 0 }] });
  expect(offline.requests).toHaveLength(1);
});

test('collects inside the interval only when the owner asks to ignore it', async () => {
  const last = '2026-11-10T00:00:00.000Z';
  const { options, requests } = harness(ok, [{ airline: 'CI', url: catalogueUrls.CI[0], fetchedAt: last, status: 200, file: 'x' }]);
  const result = await collectAirline('CI', { ...options, ignoreInterval: true }, new Map());
  expect(result.status).toBe('collected');
  expect(requests).toHaveLength(1);
});
