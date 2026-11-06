import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { array, object, parseSamples, string, type Sample } from './model.ts';
import { CoverageError } from './errors.ts';
import { personNames } from './names.ts';

// Selection is fixed before enrichment. 补全前固定选样，避免按命中结果选片。
const selection: [string, number, string[]][] = [
  ['CI', 1, ['热门']], ['CI', 3, ['热门']], ['CI', 4, ['冷门', '非英语']],
  ['CI', 15, ['冷门', '年份待核']], ['CI', 20, ['华语']], ['CI', 21, ['华语']],
  ['CI', 22, ['非英语']], ['CI', 32, ['华语', '非英语']],
  ['UA', 97, ['热门']], ['UA', 152, ['热门']], ['UA', 324, ['冷门']],
  ['UA', 438, ['非英语']], ['UA', 550, ['华语']], ['UA', 573, ['同名']],
  ['UA', 1033, ['同名', '华语']], ['UA', 494, ['热门', '片长差异待核']],
  ['UA', 894, ['热门']], ['UA', 879, ['非英语']],
  ['CA', 0, ['缺年份', '中文译名']], ['CA', 13, ['缺年份', '同名歧义']],
];
export function prepareSamples(root: string): Sample[] {
  const files: Record<string, string> = { CI: 'china-airlines.json', UA: 'united.json', CA: 'airchina.json' };
  const cached = new Map<string, { rows: unknown[]; sha: string }>();
  return parseSamples(selection.map(([airline, index, tags], position) => {
    const file = files[airline];
    if (!cached.has(file)) {
      let buffer: Buffer;
      try { buffer = readFileSync(join(root, 'samples', file)); }
      catch { throw new CoverageError(`Cannot read scout sample ${file}. 无法读取侦察样本 ${file}。`); }
      let rows: unknown;
      try { rows = JSON.parse(buffer.toString()); }
      catch { throw new CoverageError(`Invalid scout JSON ${file}. 侦察 JSON 无效：${file}。`); }
      if (!Array.isArray(rows)) throw new CoverageError(`Expected a scout array in ${file}. 侦察文件须为数组：${file}。`);
      cached.set(file, { rows, sha: createHash('sha256').update(buffer).digest('hex') });
    }
    const source = cached.get(file)!;
    const raw = object(source.rows[index]);
    const en = object(object(raw.metadata).en);
    const zh = object(object(raw.metadata)['zh-tw']);
    const sourceTitle = string(raw.db_title) || string(raw.title) || array(raw.title).map(string).join(' ');
    const title = airline === 'CI' ? string(en.name) : sourceTitle;
    const director = airline === 'CI' ? string(en.director) : airline === 'UA'
      ? string(raw.db_director_list) || string(raw.director_list) || array(raw.director_list).map(string).join(' ')
      : string(raw.director);
    const year = Number(raw.year) || undefined;
    const runtime = Number(airline === 'CI' ? raw.runtime : airline === 'UA' ? raw.duration_minute : string(raw.length).replace(/\D/g, '')) || undefined;
    const cast = airline === 'CI' ? string(en.cast) : airline === 'UA' ? string(raw.db_cast_list) : string(raw.cast);
    const audio = airline === 'CI' ? array(raw.languages).map(string) : airline === 'UA' ? array(raw.movie_language).map(string) : [string(raw.language)];
    return {
      id: `sample-${String(position + 1).padStart(2, '0')}`, airline, title,
      aliases: string(zh.name) ? [string(zh.name)] : [], year, runtime,
      directors: personNames(director), tags,
      cast: personNames(cast), audioLanguages: audio.filter(Boolean),
      source: `samples/${file}`, sourceSha256: source.sha,
      sourceRecord: `${index}:${string(raw.id) || array(raw.id).map(string).join('|') || title}`,
      observedAt: '2026-08-20', editionNote: '来源未明确标注航空删改版；片长差异仅作为待核线索',
    };
  }));
}
