import { expect, test } from 'vitest';
import { parseAirChina, parseChinaAirlines, parseUnited } from './parse.ts';

// Synthetic payloads shaped like each airline's saved response; no real catalogue data.
test('reads one United monthly programme, keeps its month and drops repeats and non-films', () => {
  const movie = {
    id: '901', template: 'movie', db_title: 'Paper Horizon', year: '2001', duration_minute: '102',
    db_director_list: 'Ari Example', db_cast_list: 'Casey Example, Dana Example', movie_language: ['eng'],
    subtitle_language: ['spa'], attributes: [{ type: 'genre', title: 'Drama' }, { type: 'classification', title: 'NR' }],
  };
  const shard = {
    programs: [{ name: 'XX2611', start_date: '2026-11-01', end_date: '2026-11-30' }],
    items: [movie, { ...movie }, { id: '902', template: 'tv_episode', db_title: 'Episode' }],
  };
  const [film, ...rest] = parseUnited(shard, '2026-10-30');
  expect(rest).toEqual([]);
  expect(film).toMatchObject({
    airline: 'UA', sourceId: '901', catalogMonth: '2026-11', title: 'Paper Horizon', year: 2001, runtime: 102,
    directors: ['Ari Example'], cast: ['Casey Example', 'Dana Example'], genres: ['Drama'],
    audioLanguages: ['eng'], subtitleLanguages: ['spa'],
  });
});

test('extracts China Airlines films from the embedded flight payload, once per record', () => {
  const record = {
    id: ['recSynthetic1'], slug: ['paper'], year: '2001', titleType: 'Film', languages: ['Mandarin'], subtitles: ['English'],
    runtime: 102, metadata: { en: { name: 'Paper Horizon', director: 'Ari Example', cast: 'Casey Example', genres: ['Drama'] },
      'zh-tw': { name: '紙上地平線' } },
  };
  const series = { ...record, id: ['recSynthetic2'], titleType: 'Series' };
  // The home page also lists its cycles as `record_id` objects.
  const payload = `0:{"items":[${JSON.stringify(record)},${JSON.stringify(series)}]}\n1:{"items":[${JSON.stringify(record)}]}`
    + `\n2:{"data":[{"record_id":"recCycle","Cycle":"CI Oct 2026"}]}`;
  const html = `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
  const films = parseChinaAirlines(html, '2026-10-30');
  expect(films).toHaveLength(1);
  expect(films[0]).toMatchObject({
    airline: 'CI', sourceId: 'recSynthetic1', title: 'Paper Horizon', titles: { en: 'Paper Horizon', 'zh-Hant': '紙上地平線' },
    year: 2001, runtime: 102, audioLanguages: ['Mandarin'], subtitleLanguages: ['English'],
  });
  expect(films[0]).not.toHaveProperty('catalogMonth');
});

test('decodes the entity-encoded Air China tables and reads labelled cells', () => {
  const cell = (text: string) => `<td>&nbsp;&nbsp;${text}</td>`;
  const table = `<table class="movie_content"><tr><td><img src="https://example.invalid/upload/123.jpg"/></td>${cell('片名：纸上地平线')}</tr>`
    + `<tr>${cell('类型：剧情')}</tr><tr>${cell('导演：甲某')}</tr><tr>${cell('主演：乙某 / 丙某')}</tr>`
    + `<tr>${cell('语言：英语')}</tr><tr>${cell('长度：102分钟')}</tr><tr>${cell('简介：结局：一个自造的故事。')}</tr></table>`;
  // The page embeds the table HTML, which itself contains `&nbsp;`, as escaped text.
  const encoded = table.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/ /g, '&#32;');
  const [film] = parseAirChina(`<div>${encoded}</div><table class="movie_content"><tr><td>音乐</td></tr></table>`, '2026-10-30');
  expect(film).toMatchObject({
    airline: 'CA', sourceId: 'image-123', title: '纸上地平线', runtime: 102, directors: ['甲某'],
    cast: ['乙某', '丙某'], genres: ['剧情'], audioLanguages: ['英语'],
  });
  expect(film.year).toBeUndefined();
});

test('reads the China Airlines full catalogue page with its cycle month', () => {
  const film = {
    record_id: 'recSynthetic3', 'Current Subs': 'Chinese Traditional,Chinese Traditional,English', 'Title (Chinese Traditional)': '紙上地平線',
    Title: 'Paper Horizon', 'Release Date': '2001-03-04', Runtime: 102, 'Director (Chinese Traditional)': '甲某',
    'Content Type': 'Film', Cast: 'Casey Example, Dana Example', 'Chinese Genre (Traditional)': ['劇情'], 'Current Audio': 'English, Japanese',
  };
  const payload = `0:{"data":[{"record_id":"recCycle","Display month":"Nov","Cycle":"XX Nov 2026"},{"record_id":"recCycle2","Cycle":"CI Nov 2026"}]}`
    + `\n1:{"films":[${JSON.stringify(film)},${JSON.stringify({ ...film, record_id: 'recSynthetic4', 'Content Type': 'Series' })}]}`;
  const [only, ...rest] = parseChinaAirlines(`<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`, '2026-11-04');
  expect(rest).toEqual([]);
  expect(only).toMatchObject({
    sourceId: 'recSynthetic3', catalogMonth: '2026-11', title: 'Paper Horizon', titles: { 'zh-Hant': '紙上地平線' }, year: 2001,
    runtime: 102, directors: ['甲某'], cast: ['Casey Example', 'Dana Example'], genres: ['劇情'],
    audioLanguages: ['English', 'Japanese'], subtitleLanguages: ['Chinese Traditional', 'English'],
  });
});
