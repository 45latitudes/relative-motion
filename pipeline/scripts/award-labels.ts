import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { awardEntries, awardIds, preferredLabel } from '../catalog/awards.ts';
import { createClient, endpoint } from '../coverage/client.ts';
import { object, type Row } from '../coverage/model.ts';

// Reads the names of the awards (and named recipients) in the matched films' Wikidata
// statements, 50 items per request, through the cached client. Names already in the labels file
// are kept and not asked for again, so a new film only adds requests for its new items and a
// failed or uncached batch never wipes names read before. `--offline` only uses the cache.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { offline: { type: 'boolean', default: false } },
  strict: true,
});
const rowsDir = 'local/catalog/match';
const responsesDir = 'local/catalog/responses';
const labelsFile = 'local/catalog/award-labels.json';

const ids = new Set<string>();
for (const name of readdirSync(rowsDir).filter((file) => file.endsWith('.json'))) {
  const row = JSON.parse(readFileSync(join(rowsDir, name), 'utf8')) as Row;
  const wikidata = object(row.details.wikidata);
  for (const id of awardIds(awardEntries(wikidata))) ids.add(id);
}

const known = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')) as Record<string, string> : {};
const labels: Record<string, string> = {};
for (const id of ids) if (known[id]) labels[id] = known[id];
const client = createClient(responsesDir, !values.offline, { gapMs: () => 0 });
const wanted = [...ids].filter((id) => !labels[id]).sort();
for (let start = 0; start < wanted.length; start += 50) {
  const batch = wanted.slice(start, start + 50);
  try {
    const response = await client.get(endpoint('https://www.wikidata.org/w/api.php', {
      // Language fallback converts names held only in Traditional Chinese into Simplified.
      action: 'wbgetentities', ids: batch.join('|'), props: 'labels', languages: 'zh-hans|en', languagefallback: '1', format: 'json',
    }));
    const entities = object(object(response.data).entities);
    for (const id of batch) {
      const label = preferredLabel(entities[id]);
      if (label) labels[id] = label;
    }
  } catch (error) {
    console.error(`Batch ${start / 50 + 1} failed; its names are left out. 第 ${start / 50 + 1} 批读取失败，名称从缺。`, error instanceof Error ? error.message : error);
  }
}
const sorted = Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
const missing = ids.size - Object.keys(sorted).length;
writeFileSync(labelsFile, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${ids.size} items, ${wanted.length} asked for, ${missing} without a name. 共 ${ids.size} 项，本次请求 ${wanted.length} 项，${missing} 项无名称。`);
for (const warning of client.warnings) console.warn(warning);
