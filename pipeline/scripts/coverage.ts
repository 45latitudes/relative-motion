import { CoverageError, diagnostic } from '../coverage/errors.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createClient } from '../coverage/client.ts';
import { newRow, tmdb, wikidata, wikipedia } from '../coverage/enrich.ts';
import { readRatingsFile } from '../coverage/imdb.ts';
import { evidence, object, string } from '../coverage/model.ts';
import { prepareSamples } from '../coverage/samples.ts';
import { report } from '../coverage/report.ts';
import { requestAudit } from '../coverage/audit.ts';
import type { RatingRule } from '../coverage/wikidata.ts';

async function main() {
  const { values } = parseArgs({ options: { fetch: { type: 'boolean', default: false } }, strict: true });
  const directory = 'local/t05';
  const ratingsPath = existsSync(`${directory}/title.ratings.tsv.gz`)
    ? `${directory}/title.ratings.tsv.gz` : `${directory}/title.ratings.tsv`;
  // Validate required inputs before issuing any requests. 发请求前核对必需输入。
  const samples = prepareSamples('data/raw/ife-scout-20260820');
  if (!existsSync(ratingsPath)) throw new CoverageError('Missing local IMDb ratings. 缺少本地 IMDb ratings 文件。');
  if (values.fetch && !process.env.TMDB_READ_ACCESS_TOKEN && !process.env.TMDB_API_KEY) throw new CoverageError('Missing TMDb credential. 缺少 TMDb 凭据。');
  mkdirSync(directory, { recursive: true });
  const client = createClient(`${directory}/responses`, values.fetch, { token: process.env.TMDB_READ_ACCESS_TOKEN, apiKey: process.env.TMDB_API_KEY });
  const rules = JSON.parse(readFileSync(new URL('../coverage/rating-rules.json', import.meta.url), 'utf8')) as RatingRule[];
  const rows = samples.map(newRow);
  for (const row of rows) {
    await tmdb(client, row);
    await wikidata(client, row, rules);
    await wikipedia(client, row, 'en');
    await wikipedia(client, row, 'zh');
    writeFileSync(`${directory}/progress.json`, JSON.stringify(rows, null, 2));
    console.log(`${row.sample.id}: TMDb=${row.fields.tmdbMatch.status}, Wikidata=${row.fields.wikidataMatch.status}, Wikipedia=${row.fields.wikipediaEn.status}/${row.fields.wikipediaZh.status}`);
  }
  for (const warning of client.warnings) console.warn(warning);
  const wanted = new Set<string>();
  const ids = new Map<string, string>();
  for (const row of rows) {
    if (row.fields.tmdbMatch.status !== 'hit') continue;
    if (row.details.idConflict) { row.fields.imdbRating = { status: 'ambiguous', reason: '已关联实体外部 ID 冲突' }; continue; }
    const movie = object(object(row.details.tmdb).movie);
    const id = string(object(movie.external_ids).imdb_id);
    const wdId = string(object(object(row.details.wikidata).ids).imdbId);
    if (id && wdId && id !== wdId) { row.fields.imdbRating = { status: 'ambiguous', reason: 'TMDb 与 Wikidata IMDb ID 冲突' }; continue; }
    const selected = id || wdId;
    if (!/^tt\d+$/.test(selected)) { row.fields.imdbRating = evidence(false, '没有可用 IMDb ID'); continue; }
    ids.set(row.sample.id, selected); wanted.add(selected);
  }
  const ratings = await readRatingsFile(ratingsPath, wanted);
  for (const row of rows) {
    const id = ids.get(row.sample.id);
    if (!id) continue;
    row.fields.imdbRating = ratings.conflicts.has(id) ? { status: 'ambiguous', reason: 'ratings 文件 ID 重复' } : evidence(ratings.values.has(id), '按已确认 ID 本地查表');
    row.details.imdb = { id, rating: ratings.values.get(id) };
  }
  const dates = [...client.used.values()].map((r) => r.fetchedAt).sort();
  const metadata = { observedFrom: dates[0] ?? '未测', observedTo: dates.at(-1) ?? '未测', requestCount: client.used.size,
    ratingsSha256: createHash('sha256').update(readFileSync(ratingsPath)).digest('hex'), ratingsRows: ratings.rows, ratingsInvalid: ratings.invalid,
    requestAudit: requestAudit(`${directory}/responses`) };
  writeFileSync(`${directory}/results.json`, JSON.stringify({ metadata, rows }, null, 2));
  writeFileSync('docs/d0-coverage.md', report(rows, metadata));
  console.log(`Report generated for ${rows.length} samples. 已生成 ${rows.length} 部样本报告。`);
}
main().catch((error: unknown) => { console.error(diagnostic(error)); process.exitCode = 1; });
