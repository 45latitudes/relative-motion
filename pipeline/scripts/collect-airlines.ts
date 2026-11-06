import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { collectAirline } from '../airlines/collect.ts';
import type { AirlineCode } from '../airlines/parse.ts';
import { readManifest, roundsRoot, type RoundEntry } from '../airlines/rounds.ts';

// Collects the airline catalogues into a new round. Airlines inside their 14-day interval are skipped;
// one airline failing leaves the others and every earlier round untouched.
const { values } = parseArgs({
  // `pnpm <script> -- --flag` passes the separator through; drop it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { airline: { type: 'string', multiple: true }, 'ignore-interval': { type: 'boolean', default: false } },
  strict: true,
});
const airlines = (values.airline ?? ['UA', 'CI', 'CA']) as AirlineCode[];
const history: RoundEntry[] = existsSync(roundsRoot)
  ? readdirSync(roundsRoot).flatMap((id) => readManifest(join(roundsRoot, id))) : [];
const id = new Date().toISOString().replace(/[:.]/g, '-');
const directory = join(roundsRoot, id);
mkdirSync(directory, { recursive: true });

const entries: RoundEntry[] = [];
const lastStart = new Map<string, number>();
for (const airline of airlines) {
  const result = await collectAirline(airline, {
    history,
    ignoreInterval: values['ignore-interval'],
    now: Date.now,
    wait: (ms) => setTimeout(ms),
    fetcher: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    save: (code, index, body) => {
      const file = `${code}-${String(index + 1).padStart(2, '0')}.body`;
      writeFileSync(join(directory, file), body);
      return file;
    },
  }, lastStart);
  if (result.status === 'skipped') console.log(`${airline}: skipped, next round allowed from ${result.nextAllowedAt}`);
  else {
    entries.push(...result.entries);
    console.log(`${airline}: ${result.status} (${result.entries.length} requests)`);
  }
}
if (entries.length) writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`);
else rmSync(directory, { recursive: true });
