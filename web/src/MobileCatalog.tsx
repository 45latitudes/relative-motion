import { useCallback, useState } from 'react';
import type { Release } from '../../shared/schema.ts';
import { useCatalogController } from './catalog/controller.ts';
import type { FilmView } from './catalog/view.ts';
import { AirlineChips, Credits, isPartial, partialNotice, SortChips } from './components/Filters.tsx';
import { MobilePass, type MobileFlight } from './components/MobilePass.tsx';
import { Sky } from './components/Sky.tsx';
import { StubGrid } from './components/StubGrid.tsx';
import { StubRings } from './components/StubRings.tsx';
import { Switch } from './components/Switch.tsx';

// The upright layout for phones. The same catalogue and the same paper, rearranged for a narrow
// screen: a slip with search and filters at the top, four rings of landscape stubs turning
// against each other below, and a boarding pass held upright when a film is opened.
export function MobileCatalog({ release }: { release: Release }) {
  const catalog = useCatalogController(release);
  const [tidy, setTidy] = useState(false);
  const [flight, setFlight] = useState<MobileFlight>();
  const open = flight && flight.phase !== 'returning';

  const pick = useCallback((film: FilmView, key: string, element: HTMLElement) => {
    if (flight) return;
    setFlight({ film, key, origin: element, phase: 'leaving' });
  }, [flight]);

  return (
    <div className={`m-board${open ? ' has-open' : ''}`}>
      <Sky />
      <header className="m-head">
        <h1>相对运动<span lang="en">Relative Motion</span></h1>
        <Switch checked={tidy} onChange={setTidy} label="整齐" />
      </header>

      <div className="m-slip" role="search" aria-label="搜索与筛选">
        <input
          type="search"
          className="m-search"
          value={catalog.state.query ?? ''}
          placeholder="搜索片名"
          aria-label="片名"
          onChange={(event) => { catalog.setQuery(event.target.value); if (event.target.value.trim()) setTidy(true); }}
        />
        <div className="m-chips">
          <AirlineChips catalog={catalog} onChoose={() => setTidy(true)} />
          <span className="m-chips-rule" aria-hidden="true" />
          <SortChips catalog={catalog} onChoose={() => setTidy(true)} />
        </div>
        {isPartial(release) && <p className="m-note">{partialNotice}</p>}
        <details className="m-about">
          <summary>关于与署名</summary>
          <Credits />
        </details>
      </div>

      <section className="m-wall" aria-label="片单">
        {catalog.films.length === 0
          ? <p className="wall-empty">没有符合条件的影片。</p>
          : tidy
            ? <StubGrid films={catalog.films} sort={catalog.state.sort} openKey={flight?.key} onPick={pick} />
            : <StubRings films={catalog.films} sort={catalog.state.sort} openKey={flight?.key} onPick={pick} />}
      </section>

      {flight && (
        <MobilePass
          flight={flight}
          sort={catalog.state.sort}
          onPhase={(phase) => setFlight((current) => (current ? { ...current, phase } : current))}
          onGone={() => setFlight(undefined)}
        />
      )}
    </div>
  );
}
