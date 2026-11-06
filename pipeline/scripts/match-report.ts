import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AirlineCode, ScoutAirline } from '../airlines/parse.ts';
import { scoutDate, scoutObservations } from '../airlines/scout.ts';
import { currentObservations, roundsRoot } from '../airlines/rounds.ts';
import { sampleId } from '../airlines/samples.ts';
import type { Row } from '../coverage/model.ts';
import { applyCorrections, differsOn, type AirlineCorrection } from '../catalog/build.ts';

// Offline: counts match outcomes and unconfirmed reasons for the current catalogues.
const { values } = parseArgs({
  // `pnpm <script> -- --flag` passes the separator through; drop it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    month: { type: 'string', default: new Date().toISOString().slice(0, 7) },
    out: { type: 'string' },
    scout: { type: 'boolean', default: false },
  },
  strict: true,
});
const rowsDir = values.scout ? 'local/scout/match' : 'local/catalog/match';
const out = values.out ?? (values.scout ? 'docs/scout-matching.md' : 'docs/catalog-matching.md');
const corrections = JSON.parse(readFileSync(new URL('../catalog/airline-corrections.json', import.meta.url), 'utf8')) as AirlineCorrection[];
const differing: string[] = [];
const lines: string[] = [];
const reasons = new Map<string, { count: number; examples: string[] }>();
const table: string[] = [];
let total = 0;
let confirmedTotal = 0;
for (const airline of (values.scout ? ['SQ', 'CX', 'EK'] : ['UA', 'CI', 'CA']) as (AirlineCode | ScoutAirline)[]) {
  const { round, observations } = values.scout
    ? { round: scoutDate, observations: scoutObservations(airline as ScoutAirline) }
    : currentObservations(roundsRoot, airline as AirlineCode, values.month);
  if (!round) { table.push(`| ${airline} | 无成功轮次 | — | — | — |`); continue; }
  let confirmed = 0;
  let pending = 0;
  for (const observation of observations) {
    const file = join(rowsDir, `${sampleId(observation)}.json`);
    if (!existsSync(file)) { pending++; continue; }
    // Counted as exported: recorded airline corrections apply.
    const row = applyCorrections(JSON.parse(readFileSync(file, 'utf8')) as Row, corrections, []);
    if (row.details.identity === 'confirmed') {
      confirmed++;
      if (differsOn(row)) differing.push(`${airline} ${observation.title}`);
      continue;
    }
    // Reasons can join several conflicts; each is counted on its own.
    for (const reason of (row.fields.tmdbMatch?.reason || '未记录原因').split('；')) {
      const entry = reasons.get(reason) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 5) entry.examples.push(`${airline} ${observation.title}`);
      reasons.set(reason, entry);
    }
  }
  const matched = observations.length - pending;
  total += matched;
  confirmedTotal += confirmed;
  const rate = matched ? `${((confirmed / matched) * 100).toFixed(1)}%` : '—';
  const month = observations[0]?.catalogMonth ?? '来源未注明';
  table.push(`| ${airline} | ${round.slice(0, 10)} | ${month} | ${observations.length} | ${matched} | ${confirmed}（${rate}） |`);
}

lines.push(values.scout ? '# 侦察包片单匹配统计' : '# 当期片单匹配统计', '', ...(values.scout ? [`未采集航司 ${scoutDate} 侦察包快照的离线验证，不代表当期片单，也不进入公开数据。`, ''] : []), '由 `pipeline/scripts/match-report.ts` 根据本地匹配结果生成，不手填；规则见 [静态匹配](matching.md)。', '');
lines.push('| 航司 | 采集轮次 | 片单月份 | 条目 | 已匹配 | 确认 |', '| --- | --- | --- | --- | --- | --- |', ...table, '');
lines.push(`合计已匹配 ${total} 部，确认 ${confirmedTotal} 部${total ? `（${((confirmedTotal / total) * 100).toFixed(1)}%）` : ''}。`, '');
lines.push(`其中 ${differing.length} 部航司所列导演与资料不符，靠演员、年份、片长或已记录的更正确认，页面以 ≈ 标出：${differing.join('；') || '无'}。`, '');
lines.push('## 未确认原因', '', '一条记录可能有多个原因，分别计数；示例最多 5 条。', '');
lines.push('| 原因 | 次数 | 示例 |', '| --- | --- | --- |');
for (const [reason, entry] of [...reasons].sort((a, b) => b[1].count - a[1].count)) {
  lines.push(`| ${reason} | ${entry.count} | ${entry.examples.join('；')} |`);
}
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${out}`);
