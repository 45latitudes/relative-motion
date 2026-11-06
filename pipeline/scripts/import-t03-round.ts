import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { roundsRoot, type RoundEntry } from '../airlines/rounds.ts';
import type { AirlineCode } from '../airlines/parse.ts';

// One-off: files the catalogue responses saved during the 2026-10-30 access review as the
// first collection round. Copies local files only; makes no requests.
const audit = 'local/t03-audit-20261030';
const airlineOf = (url: string): AirlineCode | undefined =>
  /unitedprivatescreening\.com\/assets\/local-content\/all_content_\d+\.json$/.test(url) ? 'UA'
    : url === 'https://entertainment.china-airlines.com/movies' ? 'CI'
      : url === 'https://webresource.airchina.com.cn/zh-CN/content/travel_info/flight_experience/entertainment/' ? 'CA'
        : undefined;

const ledger = readFileSync(join(audit, 'ledger.jsonl'), 'utf8').trim().split('\n')
  .map((line) => JSON.parse(line) as { url: string; ts: number; status: number | string; slug: string });
const picked = ledger.filter((entry) => airlineOf(entry.url));
const first = new Date(Math.min(...picked.map((entry) => entry.ts)) * 1000).toISOString();
const directory = join(roundsRoot, first.replace(/[:.]/g, '-'));
if (existsSync(directory)) throw new Error(`${directory} already exists`);
mkdirSync(directory, { recursive: true });
const entries: RoundEntry[] = picked.map((entry, index) => {
  const file = `${String(index + 1).padStart(2, '0')}.body`;
  copyFileSync(join(audit, 'raw', `${entry.slug}.body`), join(directory, file));
  return { airline: airlineOf(entry.url)!, url: entry.url, fetchedAt: new Date(entry.ts * 1000).toISOString(), status: Number(entry.status), file };
});
writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Filed ${entries.length} responses as round ${directory}`);
