import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Release } from '../../shared/schema.ts';
import { sortOptions, useCatalogController } from './catalog/controller.ts';
import type { FilmView } from './catalog/view.ts';
import { AirlineChips, Credits, isPartial, partialNotice, SortChips } from './components/Filters.tsx';
import { Sky } from './components/Sky.tsx';
import { StubFace } from './components/Stub.tsx';
import { StubGrid } from './components/StubGrid.tsx';
import { StubWall } from './components/StubWall.tsx';
import { Switch } from './components/Switch.tsx';
import { TicketDetails } from './components/TicketDetails.tsx';
import { formatDate } from './format.ts';
import { ticketMm } from './paper.ts';

// A stub is 30 em tall in CSS; the joined one is set to the ticket's height.
const stubEm = 30;

interface Flight {
  film: FilmView;
  key: string;
  // The stub in the wall it came from; the way back is measured from it.
  origin: HTMLElement;
  from: DOMRect;
  phase: 'leaving' | 'joined' | 'returning';
}

export function Catalog({ release }: { release: Release }) {
  const catalog = useCatalogController(release);
  const ticketRef = useRef<HTMLElement>(null);
  const [flight, setFlight] = useState<Flight>();
  const [target, setTarget] = useState<DOMRect>();
  // Drifting by default; any search, filter or sort lays the stubs out in order.
  const [tidy, setTidy] = useState(false);
  const open = flight && flight.phase !== 'returning' ? flight.film : undefined;

  const close = useCallback(() => {
    setFlight((current) => (current && current.phase !== 'returning' ? { ...current, phase: 'returning' } : current));
  }, []);
  const pick = useCallback((film: FilmView, key: string, element: HTMLElement) => {
    // While a film is open, the dimmed wall is a place to click away from it.
    if (flight) { close(); return; }
    setTarget(ticketRef.current?.getBoundingClientRect());
    setFlight({ film, key, origin: element, from: element.getBoundingClientRect(), phase: 'leaving' });
  }, [flight, close]);

  // Start the flight on the frame after the stub is drawn at its old place.
  useEffect(() => {
    if (flight?.phase !== 'leaving') return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      setFlight((current) => (current?.phase === 'leaving' ? { ...current, phase: 'joined' } : current));
    }));
    return () => cancelAnimationFrame(frame);
  }, [flight?.phase]);

  // The way back normally ends on transitionend; this covers a missed event.
  useEffect(() => {
    if (flight?.phase !== 'returning') return;
    const timer = setTimeout(() => setFlight(undefined), 900);
    return () => clearTimeout(timer);
  }, [flight?.phase]);

  // The ticket is sized from the window; keep the joined stub on its edge when the window changes.
  const flying = flight !== undefined;
  useEffect(() => {
    if (!flying) return;
    const onResize = () => {
      setTarget(ticketRef.current?.getBoundingClientRect());
      setFlight((current) => (current && current.origin.isConnected ? { ...current, from: current.origin.getBoundingClientRect() } : current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [flying]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const sortLabel = sortOptions.find((option) => option.key === catalog.state.sort)?.label;
  const partial = isPartial(release);

  let joinedStyle: CSSProperties | undefined;
  if (flight && target) {
    // One printed millimetre at the current size. The stub overlaps the ticket by the tear strip,
    // so the two torn edges meet on the same line.
    const mm = target.height / ticketMm.height;
    const left = target.right - ticketMm.strip * mm;
    const atRest = flight.phase === 'joined';
    const scale = flight.from.height / target.height;
    joinedStyle = {
      left,
      top: target.top,
      fontSize: `${target.height / stubEm}px`,
      transform: atRest ? 'none' : `translate(${flight.from.left - left}px, ${flight.from.top - target.top}px) scale(${scale})`,
    };
  }

  return (
    <div className={`board${open ? ' has-open' : ''}`}>
      <Sky />
      <section className="board-left">
        <header className="masthead">
          <h1>相对运动<span lang="en">Relative Motion</span></h1>
        </header>

        <div className="filters" role="search" aria-label="搜索与筛选">
          <label className="search">
            <span className="field-label">片名<span lang="en">Title</span></span>
            <input
              type="search"
              value={catalog.state.query ?? ''}
              placeholder="中文名、原名或航司片单上的名字"
              onChange={(event) => { catalog.setQuery(event.target.value); if (event.target.value.trim()) setTidy(true); }}
            />
          </label>
          <div className="filter-row" role="group" aria-label="航司">
            <span className="field-label">航司<span lang="en">Carrier</span></span>
            <AirlineChips catalog={catalog} onChoose={() => setTidy(true)} />
          </div>
          <div className="filter-row" role="group" aria-label="排序">
            <span className="field-label">排序<span lang="en">Order</span></span>
            <SortChips catalog={catalog} onChoose={() => setTidy(true)} />
          </div>
        </div>

        <div className="ticket-shadow">
          <article ref={ticketRef} className="ticket" aria-live="polite">
            <div className="ticket-band">
              <span>相对运动</span>
              {open
                ? <button type="button" className="ticket-close" onClick={close} aria-label="收起这部片">收起 ✕</button>
                : <span lang="en">Relative Motion · Catalogue</span>}
            </div>
            {open ? (
              <TicketDetails key={open.id} film={open} />
            ) : (
              <div className="ticket-summary">
                <dl className="fields">
                  <div><dt>观测<span lang="en">Observed</span></dt><dd>{catalog.observedAt ? formatDate(catalog.observedAt) : '—'}</dd></div>
                  <div><dt>航司<span lang="en">Carriers</span></dt><dd>{catalog.airlines.length} 家</dd></div>
                  <div><dt>片数<span lang="en">Films</span></dt><dd>{catalog.films.length} / {catalog.total}</dd></div>
                  <div><dt>排序<span lang="en">Order</span></dt><dd>{sortLabel}</dd></div>
                </dl>
                <p className="ticket-hint">点右侧任意一张票根，看这部片的资料。票根上的分数跟随所选排序，缺少这项分数的影片排在最后。</p>
                {partial && <p className="ticket-hint">{partialNotice}</p>}
              </div>
            )}
          </article>
        </div>

        <footer className="fine-print">
          <Credits />
        </footer>
      </section>

      <section className="board-right" aria-label="片单">
        <div className="wall-controls">
          <Switch checked={tidy} onChange={(value) => { close(); setTidy(value); }} label="整齐排列" />
        </div>
        {catalog.films.length === 0
          ? <p className="wall-empty">没有符合条件的影片。</p>
          : tidy
            ? <StubGrid films={catalog.films} sort={catalog.state.sort} openKey={flight?.key} onPick={pick} />
            : <StubWall films={catalog.films} sort={catalog.state.sort} openKey={flight?.key} onPick={pick} />}
      </section>

      {flight && joinedStyle && (
        <button
          type="button"
          className={`stub is-joined is-${flight.phase}`}
          style={joinedStyle}
          aria-label="收起这部片"
          onClick={close}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'transform' && flight.phase === 'returning') setFlight(undefined);
          }}
        >
          <StubFace film={flight.film} sort={catalog.state.sort} joined />
        </button>
      )}
    </div>
  );
}
