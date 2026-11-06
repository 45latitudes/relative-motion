import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { object } from './model.ts';
import { CoverageError } from './errors.ts';
import { writeJsonAtomic } from './storage.ts';

export const RATE_POLICY = 'registrable-domain-2100ms';

export interface ResponseRecord {
  url: string;
  fetchedAt: string;
  status: number;
  data: unknown;
  ratePolicy?: string;
}
export class SourceError extends CoverageError {
  kind: 'untested' | 'error';
  resourceMissing: boolean;
  constructor(kind: 'untested' | 'error', message: string, resourceMissing = false) {
    super(message); this.kind = kind; this.resourceMissing = resourceMissing;
  }
}
export function allowed(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.hostname === 'api.themoviedb.org') return /^\/3\/(configuration|search\/movie|movie\/\d+(?:\/videos)?|person\/\d+)$/.test(url.pathname);
  return ['www.wikidata.org', 'en.wikipedia.org', 'zh.wikipedia.org'].includes(url.hostname) && url.pathname === '/w/api.php';
}
const requestDomain = (host: string): string => host.endsWith('.wikipedia.org') ? 'wikipedia.org' : host;
const resourceMissing = (url: URL, response: ResponseRecord): boolean =>
  url.hostname === 'api.themoviedb.org' && /^\/3\/(?:movie\/\d+(?:\/videos)?|person\/\d+)$/.test(url.pathname)
  && response.status === 404 && object(response.data).status_code === 34;
export function createClient(directory: string, online: boolean, options: {
  token?: string; apiKey?: string; fetcher?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<unknown>;
  // Minimum gap between request starts per domain; requests are always sequential within one client.
  gapMs?: (domain: string) => number;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? setTimeout;
  const halted = new Set<string>();
  const lastStart = new Map<string, number>();
  const used = new Map<string, ResponseRecord>();
  const warnings = new Set<string>();
  mkdirSync(directory, { recursive: true });
  // Load clocks only before a live request. 时钟仅在实时请求前读取。
  const clockPath = join(directory, 'request-clock.json');
  let clockLoaded = false;
  let recoveredAt: number | undefined;
  function loadClock() {
    if (clockLoaded) return;
    clockLoaded = true;
    if (!existsSync(clockPath)) return;
    try {
      const saved: unknown = JSON.parse(readFileSync(clockPath, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error();
      for (const [host, at] of Object.entries(saved)) {
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > now()) throw new Error();
        lastStart.set(requestDomain(host), Math.max(at, lastStart.get(requestDomain(host)) ?? 0));
      }
    } catch {
      lastStart.clear();
      recoveredAt = now();
      warnings.add('Request clock invalid; wait a full interval before fetching. 请求时钟无效，抓取前等待完整间隔。');
    }
  }
  return {
    used, warnings,
    async get(urlText: string): Promise<ResponseRecord> {
      const url = new URL(urlText);
      if (!allowed(url) || url.searchParams.has('api_key')) throw new SourceError('error', 'Unregistered endpoint. 端点未登记。');
      const domain = requestDomain(url.hostname);
      const file = join(directory, `${createHash('sha256').update(url.href).digest('hex')}.json`);
      if (existsSync(file)) {
        const cached = JSON.parse(readFileSync(file, 'utf8')) as ResponseRecord;
        if (cached.url === url.href) used.set(url.href, cached);
        if (cached.url === url.href && resourceMissing(url, cached)) {
          throw new SourceError('error', 'Resource not found. 资源不存在。', true);
        }
        if (cached.url !== url.href || cached.status !== 200 || object(cached.data).error || object(cached.data).invalidJson || object(cached.data).success === false) {
          halted.add(domain);
          throw new SourceError('error', 'Cached request failed; inspect locally. 缓存请求失败，需本地核查。');
        }
        return cached;
      }
      // Halting blocks new requests; valid cached responses remain reusable. 停止仅阻止新增请求，仍可复用有效缓存。
      if (halted.has(domain)) throw new SourceError('error', 'Source halted after a failed request. 请求失败后已停止该来源。');
      if (!online) throw new SourceError('untested', 'Response not cached. 尚无本地响应。');
      const headers: Record<string, string> = {
        'User-Agent': 'RelativeMotion/0.1 (research; +https://github.com/45latitudes/relative-motion; contact: relativemotion@icloud.com)',
        Accept: 'application/json',
      };
      const requestUrl = new URL(url);
      if (url.hostname === 'api.themoviedb.org') {
        if (options.token) headers.Authorization = `Bearer ${options.token}`;
        else if (options.apiKey) requestUrl.searchParams.set('api_key', options.apiKey);
        else throw new SourceError('untested', 'TMDb credential required. 缺少 TMDb 凭据。');
      }
      loadClock();
      const last = Math.max(lastStart.get(domain) ?? -Infinity, recoveredAt ?? -Infinity);
      const gap = options.gapMs?.(domain) ?? 2100;
      if (Number.isFinite(last) && gap > 0) await wait(Math.max(0, gap - (now() - last)));
      lastStart.set(domain, now());
      writeJsonAtomic(clockPath, Object.fromEntries(lastStart));
      const result: ResponseRecord = { url: url.href, fetchedAt: new Date(now()).toISOString(), status: 0, data: null, ratePolicy: gap === 2100 ? RATE_POLICY : `sequential-${gap}ms` };
      try {
        const response = await fetcher(requestUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        result.status = response.status;
        const body = await response.text();
        try { result.data = JSON.parse(body); } catch { result.data = { invalidJson: true }; }
        writeJsonAtomic(file, result);
        used.set(url.href, result);
        if (resourceMissing(url, result)) throw new SourceError('error', 'Resource not found. 资源不存在。', true);
        if (!response.ok || object(result.data).error || object(result.data).invalidJson || object(result.data).success === false) {
          throw new SourceError('error', `HTTP ${result.status} or API failure. HTTP ${result.status} 或 API 错误。`);
        }
        return result;
      } catch (error) {
        if (!(error instanceof SourceError && error.resourceMissing)) halted.add(domain);
        writeJsonAtomic(file, result);
        // Never include a fetch exception or request headers in logs. 日志不包含 fetch 异常原文或请求头。
        throw error instanceof SourceError ? error : new SourceError('error', 'Network request failed. 网络请求失败。');
      }
    },
  };
}
export type Client = ReturnType<typeof createClient>;
export function endpoint(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}
