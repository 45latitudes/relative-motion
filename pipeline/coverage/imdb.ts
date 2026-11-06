import { CoverageError } from './errors.ts';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

export interface ImdbRating { value: number; votes: number }
export async function readRatings(stream: Readable, wanted: Set<string>) {
  const values = new Map<string, ImdbRating>();
  const conflicts = new Set<string>();
  let rows = 0;
  let invalid = 0;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (rows++ === 0) {
        if (line.replace(/^\uFEFF/, '') !== 'tconst\taverageRating\tnumVotes') throw new CoverageError('Invalid IMDb header. IMDb 文件表头无效。');
        continue;
      }
      const cells = line.split('\t');
      if (cells.length !== 3 || !/^tt\d+$/.test(cells[0]) || !/^\d+(?:\.\d+)?$/.test(cells[1]) || !/^\d+$/.test(cells[2])
        || Number(cells[1]) < 1 || Number(cells[1]) > 10 || !Number.isSafeInteger(Number(cells[2]))) { invalid++; continue; }
      const [id, value, votes] = cells;
      if (!wanted.has(id) || conflicts.has(id)) continue;
      if (values.has(id)) { values.delete(id); conflicts.add(id); continue; }
      values.set(id, { value: Number(value), votes: Number(votes) });
    }
    if (!rows) throw new CoverageError('Empty IMDb file. IMDb 文件为空。');
    return { values, conflicts, rows: rows - 1, invalid };
  } finally { lines.close(); stream.destroy(); }
}
export async function readRatingsFile(file: string, wanted: Set<string>) {
  const input = createReadStream(file);
  const stream = file.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  if (stream !== input) input.on('error', (error) => stream.destroy(error));
  try { return await readRatings(stream, wanted); } finally { input.destroy(); }
}
