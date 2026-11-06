import { array, object, string, type ObjectValue } from '../coverage/model.ts';
import { personNames } from '../coverage/names.ts';

export type AirlineCode = 'UA' | 'CI' | 'CA';
// Airlines known only from the 2026-08-20 scout package; never collected.
export type ScoutAirline = 'SQ' | 'CX' | 'EK';

// One film as an airline published it in one catalogue. Parsers read saved responses only.
export interface Observation {
  airline: AirlineCode | ScoutAirline;
  // The airline's own record ID, or a stable key when the source has none.
  sourceId: string;
  // `YYYY-MM` only when the source states the catalogue period.
  catalogMonth?: string;
  // UTC date of the response the observation came from.
  observedAt: string;
  title: string;
  // Titles by the language tag the source uses.
  titles: Record<string, string>;
  year?: number;
  runtime?: number;
  directors: string[];
  cast: string[];
  genres: string[];
  audioLanguages: string[];
  subtitleLanguages: string[];
  // The full source record, kept so later rules can reparse it.
  raw: unknown;
}

const positive = (value: unknown) => {
  const parsed = Number.parseInt(string(value) || String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const strings = (value: unknown) => array(value).map(string).map((item) => item.trim()).filter(Boolean);

// United: each static shard is one monthly programme with explicit start and end dates.
export function parseUnited(shard: unknown, observedAt: string): Observation[] {
  const data = object(shard);
  const programme = object(array(data.programs)[0]);
  const start = string(programme.start_date);
  const catalogMonth = /^\d{4}-\d{2}-01$/.test(start) ? start.slice(0, 7) : undefined;
  const seen = new Set<string>();
  const result: Observation[] = [];
  for (const item of array(data.items).map(object)) {
    const id = string(item.id);
    if (item.template !== 'movie' || !id || seen.has(id)) continue;
    seen.add(id);
    const title = string(item.db_title).trim() || strings(item.title).join(' ');
    if (!title) continue;
    result.push({
      airline: 'UA', sourceId: id, catalogMonth, observedAt, title, titles: { en: title },
      year: positive(item.year), runtime: positive(item.duration_minute),
      directors: personNames(string(item.db_director_list)), cast: personNames(string(item.db_cast_list)),
      genres: array(item.attributes).map(object).filter((a) => a.type === 'genre').map((a) => string(a.title)).filter(Boolean),
      audioLanguages: strings(item.movie_language), subtitleLanguages: strings(item.subtitle_language), raw: item,
    });
  }
  return result;
}

// Reads the Next.js flight payload that China Airlines embeds in its catalogue page.
function flightPayload(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((match) => JSON.parse(`"${match[1]}"`) as string).join('');
}

function balancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return undefined;
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const splitList = (value: unknown) => [...new Set(string(value).split(',').map((item) => item.trim()).filter(Boolean))];

// The full catalogue page (`/catalog/movies`): flat records plus the cycle they belong to, e.g. "CI Nov 2026".
function parseChinaAirlinesCatalogue(flight: string, observedAt: string): Observation[] {
  const records = new Map<string, ObjectValue>();
  let catalogMonth: string | undefined;
  for (const match of flight.matchAll(/\{"record_id":"(rec\w+)"/g)) {
    const text = balancedObject(flight, match.index);
    if (!text) continue;
    const record = object(JSON.parse(text));
    const cycle = /^CI (\w{3}) (\d{4})$/.exec(string(record.Cycle));
    if (cycle && monthNames.includes(cycle[1])) {
      catalogMonth = `${cycle[2]}-${String(monthNames.indexOf(cycle[1]) + 1).padStart(2, '0')}`;
    }
    if (record['Content Type'] === 'Film' && string(record.Title).trim() && !records.has(match[1])) records.set(match[1], record);
  }
  return [...records].map(([id, record]) => {
    const titles: Record<string, string> = { en: string(record.Title).trim() };
    const chinese = string(record['Title (Chinese Traditional)']).trim();
    if (chinese) titles['zh-Hant'] = chinese;
    return {
      airline: 'CI' as const, sourceId: id, catalogMonth, observedAt, title: titles.en, titles,
      year: positive(string(record['Release Date']).slice(0, 4)), runtime: positive(record.Runtime),
      // The catalogue gives directors only in Traditional Chinese.
      directors: personNames(string(record['Director (Chinese Traditional)'])), cast: personNames(string(record.Cast)),
      genres: strings(record['Chinese Genre (Traditional)']),
      audioLanguages: splitList(record['Current Audio']), subtitleLanguages: splitList(record['Current Subs']), raw: record,
    };
  });
}

// China Airlines: the full catalogue page, or the home page whose carousels repeat records.
export function parseChinaAirlines(html: string, observedAt: string): Observation[] {
  const flight = flightPayload(html);
  // The home page also carries `record_id` objects (its cycles), so fall back when no film is found.
  const catalogue = parseChinaAirlinesCatalogue(flight, observedAt);
  if (catalogue.length) return catalogue;
  const records = new Map<string, ObjectValue>();
  for (const match of flight.matchAll(/\{"id":\["(rec\w+)"\]/g)) {
    if (records.has(match[1])) continue;
    const text = balancedObject(flight, match.index);
    if (!text) continue;
    const record = object(JSON.parse(text));
    if (record.titleType === 'Film') records.set(match[1], record);
  }
  return [...records].map(([id, record]) => {
    const metadata = object(record.metadata);
    const en = object(metadata.en);
    const zh = object(metadata['zh-tw']);
    const titles: Record<string, string> = {};
    if (string(en.name).trim()) titles.en = string(en.name).trim();
    if (string(zh.name).trim()) titles['zh-Hant'] = string(zh.name).trim();
    return {
      airline: 'CI' as const, sourceId: id, observedAt, title: titles.en ?? titles['zh-Hant'] ?? id, titles,
      year: positive(record.year), runtime: positive(record.runtime),
      directors: personNames(string(en.director)), cast: personNames(string(en.cast)), genres: strings(en.genres),
      audioLanguages: strings(record.languages), subtitleLanguages: strings(record.subtitles), raw: record,
    };
  });
}

const decodeEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// Air China: the catalogue is an HTML table encoded twice as entities inside a static page.
export function parseAirChina(html: string, observedAt: string): Observation[] {
  const page = decodeEntities(decodeEntities(html));
  const result: Observation[] = [];
  for (const table of page.match(/<table class="movie_content"[\s\S]*?<\/table>/g) ?? []) {
    const fields = new Map<string, string>();
    for (const cell of table.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []) {
      const text = cell.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const match = /^([一-鿿]{2})：(.*)$/u.exec(text);
      if (match && !fields.has(match[1])) fields.set(match[1], match[2].trim());
    }
    const title = fields.get('片名');
    if (!title) continue;
    const image = /src="[^"]*\/(\d+)\.(?:jpg|png)/.exec(table)?.[1];
    result.push({
      airline: 'CA', sourceId: image ? `image-${image}` : `title-${title}`, observedAt, title, titles: { 'zh-Hans': title },
      runtime: positive((fields.get('长度') ?? '').replace(/\D/g, '')),
      directors: personNames(fields.get('导演') ?? ''), cast: personNames(fields.get('主演') ?? ''),
      genres: personNames(fields.get('类型') ?? ''), audioLanguages: personNames(fields.get('语言') ?? ''),
      subtitleLanguages: [], raw: Object.fromEntries(fields),
    });
  }
  return result;
}
