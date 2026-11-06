import { pinyin } from 'pinyin-pro';
import { Converter } from 'opencc-js';
import { normalize } from './model.ts';

const simplified = Converter({ from: 'tw', to: 'cn' });
const hongKong = Converter({ from: 'hk', to: 'cn' });
const japanese = Converter({ from: 'jp', to: 'cn' });
export const textKey = (value: string) => normalize(hongKong(simplified(value)));
// Japanese folding also merges distinct Chinese characters (芸→艺), so it only prevents conflicts. 日文字形折叠也会合并不同汉字（芸→艺），只用于避免误判冲突。
export const kanjiVariant = (left: string, right: string) => /\p{Script=Han}/u.test(left) && /\p{Script=Han}/u.test(right)
  && normalize(japanese(hongKong(simplified(left)))) === normalize(japanese(hongKong(simplified(right))));
export function writingSystem(value: string): string | undefined {
  if (/\p{Script=Hangul}/u.test(value)) return 'hangul';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'kana';
  if (/\p{Script=Han}/u.test(value)) return 'han';
  return ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Thai', 'Devanagari'].find((script) => new RegExp(`\\p{Script=${script}}`, 'u').test(value));
}
// Airlines also fill empty credits with sentences such as "No Director Available".
export const meaningfulName = (value: string) => /\p{L}/u.test(value)
  && !/^(?:undefined|null|n\/?a|unknown|none|-|no (?:\w+ ){0,2}available)$/i.test(value.trim());
export const personNames = (value: string) => value.replace(/\bN\/A\b/gi, '').split(/[,，/、]/).map((name) => name.trim()).filter(meaningfulName);
export function sameName(left: string, right: string): boolean {
  if (!meaningfulName(left) || !meaningfulName(right)) return false;
  if (textKey(left) === textKey(right)) return true;
  // Preserve whole given-name tokens when reversing family-name order. 调整姓氏顺序时保留完整名字词组。
  const tokens = (value: string) => /^[\p{Script=Latin}\p{M}\s'-]+$/u.test(value)
    ? value.trim().split(/\s+/).map(normalize) : [];
  const a = tokens(left), b = tokens(right);
  return a.length >= 2 && a.length <= 3 && a.length === b.length
    && a.every((token) => token.length > 1)
    && [b, [...b.slice(1), b[0]], [b.at(-1)!, ...b.slice(0, -1)]].some((order) => a.join('|') === order.join('|'));
}

const latinTokens = (value: string) => /^[\p{Script=Latin}\p{M}\s'.-]+$/u.test(value)
  ? value.trim().split(/[\s-]+/).map(normalize).filter(Boolean) : [];

// A shorter credit whose words all appear in order in a longer one, as in Hong Kong credits that
// add the Chinese given name ("Gigi Leung" / "Gigi Leung Wing-kei"). 港式署名常在英文名后附中文名拼音。
export function extendedName(left: string, right: string): boolean {
  const a = latinTokens(left), b = latinTokens(right);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2 || short.length === long.length) return false;
  let position = 0;
  for (const token of long) if (token === short[position]) position++;
  return position === short.length;
}

const editDistance = (a: string, b: string) => {
  // Optimal string alignment: an adjacent transposition ("McQuiod" / "McQuoid") counts once.
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

// Typos and short forms of one Latin name: "Antoine Fuque" / "Fuqua", "Joseph" / "Joe Pytka",
// "Hyn-jin Cho" / "Cho Hyeon-jin", "Ho Miu Ki" / "Ho Miu-Kei". Lossy, so it only prevents a conflict. 有损比较，只用于避免误判冲突。
export function spellingVariant(left: string, right: string): boolean {
  const a = latinTokens(left), b = latinTokens(right);
  if (a.length < 2 || b.length < 2) return false;
  const orders = (tokens: string[]) => [tokens, [...tokens.slice(1), tokens[0]], [tokens.at(-1)!, ...tokens.slice(0, -1)]];
  const joined = a.join('');
  if (orders(b).some((order) => {
    const other = order.join('');
    const shorter = Math.min(joined.length, other.length);
    return shorter >= 6 && editDistance(joined, other) <= (shorter >= 9 ? 2 : 1);
  })) return true;
  // A long form whose extra words are a middle or Chinese given name, with one letter off in a
  // matched word ("Frant Gwo" / "Frant Guo Fan", "Karan Sharmaa" / "Karan Shrikant Sharma").
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < long.length) {
    let position = 0, exact = 0;
    for (const token of long) {
      const wanted = short[position];
      if (wanted === undefined) break;
      if (token === wanted) { position++; exact++; }
      else if (Math.min(token.length, wanted.length) >= 3 && editDistance(token, wanted) <= 1) position++;
    }
    if (position === short.length && exact >= 1) return true;
  }
  // Same family name with a shortened given name ("Joseph" / "Joe").
  return a.length === b.length && a.at(-1) === b.at(-1) && a.at(-1)!.length >= 3
    && a[0].slice(0, 2) === b[0].slice(0, 2) && (a[0].startsWith(b[0]) || b[0].startsWith(a[0]) || editDistance(a[0], b[0]) <= 3);
}

// These lossy keys only prevent a conflict; they never award identity points. 有损转写键只阻止误报冲突，绝不加身份分。
export function uncertainRomanization(left: string, right: string): boolean {
  const keys = (name: string) => {
    if (!/^[a-zA-Z\s'-]+$/.test(name)) return [];
    const tokens = name.toLowerCase().trim().split(/[\s-]+/).map((token) => token.replaceAll("'", '')
      .replace(/^hs/, 'x').replace(/^(?:ch|zh|q|j)/, 'j').replace(/^(?:ts|c)/, 'z')
      .replace(/^k/, 'g').replace(/^p/, 'b').replace(/^t/, 'd').replace(/ung$/, 'ong').replace(/ih$/, 'i').replace(/ieh$/, 'ie'));
    if (tokens.length < 2 || tokens.length > 4) return [];
    return [tokens.join(''), [...tokens.slice(1), tokens[0]].join(''), [tokens.at(-1), ...tokens.slice(0, -1)].join('')];
  };
  const a = keys(left), b = keys(right);
  return a.some((key) => b.includes(key));
}

const compoundSurnames = new Set(['欧阳', '歐陽', '司马', '司馬', '上官', '诸葛', '諸葛', '东方', '東方', '皇甫', '尉迟', '尉遲', '公孙', '公孫', '慕容', '司徒', '司空', '夏侯', '令狐', '宇文', '长孙', '長孫', '南宫', '南宮']);

// Full-name phonetic evidence is weaker than an attested alias. 完整姓名的转写证据弱于有来源的别名。
export function phoneticName(left: string, right: string): boolean {
  const han = /^\p{Script=Han}{2,4}$/u;
  const chinese = han.test(left.trim()) ? left.trim() : han.test(right.trim()) ? right.trim() : '';
  const latin = chinese === left.trim() ? right : left;
  if (!chinese || !/^[a-zA-Z\s-]+$/.test(latin) || normalize(latin).length < 4) return false;
  const syllables = pinyin(chinese, { toneType: 'none', type: 'array', surname: 'head' });
  const surnameLength = compoundSurnames.has(chinese.slice(0, 2)) ? 2 : 1;
  const reordered = [...syllables.slice(surnameLength), ...syllables.slice(0, surnameLength)];
  return [syllables.join(''), reordered.join('')].map(normalize).includes(normalize(latin));
}
