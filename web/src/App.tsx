import { useEffect, useState } from 'react';
import { ReleaseSchema, type Release } from '../../shared/schema.ts';
import { Catalog } from './Catalog.tsx';
import { MobileCatalog } from './MobileCatalog.tsx';
import { useNarrow } from './useNarrow.ts';
import { Porthole } from './components/Porthole.tsx';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; release: Release }
  | { state: 'error'; message: string };

export default function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const narrow = useNarrow();
  useEffect(() => {
    const controller = new AbortController();
    // `latest.json` names the current month; each month's catalogue is its own file.
    const data = `${import.meta.env.BASE_URL}data/`;
    const get = (path: string) => fetch(`${data}${path}`, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    });
    get('latest.json')
      .then((index) => {
        const current = (index as { current?: unknown }).current;
        if (typeof current !== 'string' || !/^\d{4}-\d{2}$/.test(current)) throw new Error('No current month');
        return get(`${current}.json`);
      })
      .then((json) => {
        const parsed = ReleaseSchema.safeParse(json);
        setLoad(parsed.success
          ? { state: 'ready', release: parsed.data }
          : { state: 'error', message: '片单数据的格式与当前版本不符。' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'error', message: '没有找到片单数据。' });
      });
    return () => controller.abort();
  }, []);

  if (load.state === 'ready') {
    return <Porthole>{narrow ? <MobileCatalog release={load.release} /> : <Catalog release={load.release} />}</Porthole>;
  }
  return (
    <main className="status">
      <h1>相对运动</h1>
      <p>{load.state === 'loading' ? '正在载入片单…' : load.message}</p>
      {load.state === 'error' && import.meta.env.DEV && (
        <p className="hint">本地预览先运行 <code>pnpm export:catalog</code> 生成数据。</p>
      )}
    </main>
  );
}
