import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SortKey } from '../catalog/controller.ts';
import type { FilmView } from '../catalog/view.ts';
import { StubFace } from './Stub.tsx';

// Three or four rings of stubs, like dials or growth rings, around one centre far below the screen,
// so neighbouring stubs lean only a few degrees apart. The rings turn slowly against each other;
// a finger dragged sideways turns the ring under it. Stubs lie landscape with the tear below.
interface Props {
  films: FilmView[];
  sort: SortKey;
  openKey?: string;
  onPick: (film: FilmView, key: string, element: HTMLElement) => void;
}

export interface RingPlacement { x: number; y: number; angle: number; width: number; height: number }
// Where each stub element currently sits on screen, for the flight out of the ring.
export const placements = new WeakMap<HTMLElement, RingPlacement>();

const maxRings = 4;
const gapX = 10; // px between neighbouring stubs along a ring
const top = 12; // px above the outer ring
const minGap = 14;
const maxGap = 34; // px between rings
const drift = 0.11; // stubs per second

interface Geometry { width: number; height: number; rows: number; stubW: number; stubH: number; outer: number; centreY: number; pitch: number; slots: number }

// Stubs on the rings are the size of the tidy layout's two columns, so switching between the
// two keeps every stub the same size.
export const columnWidth = (width: number) => (width - 16 * 2 - 12) / 2;

// As many rings as the wall has room for, four or three: the room is the wall's height less the
// cloud along the foot of the screen, which the last ring may dip into by an eighth of a stub,
// and less the curve's drop at the screen edges. If even three do not fit, the stubs shrink.
export function geometry(width: number, height: number, viewport = height): Geometry {
  const outer = Math.max(1500, width * 4.5);
  const sag = outer - Math.sqrt(outer * outer - (width / 2) ** 2);
  let stubW = columnWidth(width);
  let stubH = (stubW * 51) / 83;
  const room = () => height - top - sag - viewport * 0.11 + stubH * 0.12;
  const fits = (rows: number) => rows * stubH + (rows - 1) * minGap <= room();
  const rows = fits(maxRings) ? maxRings : 3;
  if (!fits(rows)) {
    const scale = Math.max(0.6, (height - top - sag - viewport * 0.11 - (rows - 1) * minGap) / (stubH * (rows - 0.12)));
    stubW *= scale;
    stubH *= scale;
  }
  const rowGap = Math.max(minGap, Math.min(maxGap, (room() - rows * stubH) / (rows - 1)));
  const centreY = stubH / 2 + top + outer;
  const slots = Math.ceil(width / (stubW + gapX)) + 4;
  return { width, height, rows, stubW, stubH, outer, centreY, pitch: stubH + rowGap, slots };
}

export function StubRings({ films, sort, openKey, onPick }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry>(() => geometry(390, 600));
  const rings = useMemo(() => {
    const result: FilmView[][] = Array.from({ length: geo.rows }, () => []);
    films.forEach((film, index) => result[index % geo.rows].push(film));
    return result.filter((ring) => ring.length > 0);
  }, [films, geo.rows]);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  // Ring positions in stubs; the first slot shown in each ring (committed to the DOM).
  const positions = useRef<number[]>(Array.from({ length: maxRings }, (_, i) => i * 0.37));
  const [bases, setBases] = useState<number[]>(() => positions.current.map((p) => Math.floor(p) - 2));
  const basesRef = useRef(bases);
  basesRef.current = bases;
  // The stub elements on each ring by their place along it, so a stub keeps its element (and
  // its film) as the window of shown places moves on.
  const elements = useRef<Map<number, HTMLButtonElement>[]>(Array.from({ length: maxRings }, () => new Map()));
  const drag = useRef<{ ring: number; x: number; last: number; t: number; v: number; moved: number } | undefined>(undefined);
  const velocity = useRef<number[]>(Array.from({ length: maxRings }, () => 0));
  const paused = useRef(false);
  paused.current = openKey !== undefined;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setGeo(geometry(entry.contentRect.width || 390, entry.contentRect.height || 600, window.innerHeight)));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const radius = (ring: number) => geoRef.current.outer - ring * geoRef.current.pitch;
  // Where place n of a ring is now, relative to the rings' box.
  const placeOf = (ring: number, n: number) => {
    const g = geoRef.current;
    const r = radius(ring);
    const angle = (n - positions.current[ring]) * ((g.stubW + gapX) / r);
    return { x: g.width / 2 + r * Math.sin(angle), y: g.centreY - r * Math.cos(angle), angle };
  };
  const place = () => {
    const g = geoRef.current;
    elements.current.forEach((ring, i) => ring.forEach((element, n) => {
      const { x, y, angle } = placeOf(i, n);
      element.style.transform = `translate(${x - g.stubW / 2}px, ${y - g.stubH / 2}px) rotate(${angle}rad)`;
    }));
  };
  // Newly shown stubs are placed before they are painted.
  useLayoutEffect(place, [bases, geo, rings]);

  useEffect(() => {
    let last: number | undefined;
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, last === undefined ? 0 : (now - last) / 1000);
      last = now;
      const g = geoRef.current;
      const nextBases = [...basesRef.current];
      let changed = false;
      rings.forEach((_, i) => {
        const target = paused.current ? 0 : drift * (i % 2 === 0 ? 1 : -1);
        if (drag.current?.ring !== i) {
          velocity.current[i] += (target - velocity.current[i]) * (1 - Math.exp(-dt / 0.9));
          positions.current[i] += velocity.current[i] * dt;
        }
        const wanted = Math.floor(positions.current[i]) - Math.floor(g.slots / 2);
        if (wanted !== basesRef.current[i]) { nextBases[i] = wanted; changed = true; }
      });
      place();
      if (changed) setBases(nextBases);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [rings]);

  // A sideways drag turns the ring under the finger; a short touch is a tap on a stub.
  const suppressClick = useRef(false);
  const onPointerDown = (event: ReactPointerEvent) => {
    const g = geoRef.current;
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    const distance = Math.hypot(event.clientX - box.left - g.width / 2, event.clientY - box.top - g.centreY);
    const ring = Math.max(0, Math.min(rings.length - 1, Math.round((g.outer - distance) / g.pitch)));
    drag.current = { ring, x: event.clientX, last: event.clientX, t: event.timeStamp, v: 0, moved: 0 };
    velocity.current[ring] = 0;
    suppressClick.current = false;
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const g = geoRef.current;
      const dx = event.clientX - d.last;
      const dt = Math.max(1, event.timeStamp - d.t) / 1000;
      d.moved += Math.abs(dx);
      d.v = d.v * 0.6 + (-dx / (g.stubW + gapX) / dt) * 0.4;
      positions.current[d.ring] -= dx / (g.stubW + gapX);
      d.last = event.clientX;
      d.t = event.timeStamp;
      if (d.moved > 6) suppressClick.current = true;
    };
    const onUp = (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // Let go, the ring coasts on and eases back into its own slow turn; a finger that had
      // already come to rest lets go without a fling.
      const rested = event.timeStamp - d.t > 80;
      velocity.current[d.ring] = rested ? 0 : Math.max(-6, Math.min(6, d.v));
      drag.current = undefined;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const pick = (film: FilmView, key: string, ring: number, n: number, element: HTMLElement) => {
    const g = geoRef.current;
    const box = rootRef.current?.getBoundingClientRect();
    const { x, y, angle } = placeOf(ring, n);
    placements.set(element, { x: x + (box?.left ?? 0), y: y + (box?.top ?? 0), angle, width: g.stubW, height: g.stubH });
    onPick(film, key, element);
  };

  return (
    <div
      ref={rootRef}
      className={`stub-rings${openKey ? ' is-paused' : ''}`}
      style={{ fontSize: `${geo.stubW / 30}px` }}
      onPointerDown={onPointerDown}
      onClickCapture={(event) => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
      }}
    >
      {rings.map((ring, i) => Array.from({ length: geo.slots }, (_, k) => {
        const n = (bases[i] ?? 0) + k;
        const film = ring[((n % ring.length) + ring.length) % ring.length];
        const key = `${film.id}|ring${i}|${n}`;
        return (
          <button
            key={`${i}|${n}`}
            ref={(element) => {
              if (!element) return;
              const ringElements = elements.current[i];
              ringElements.set(n, element);
              return () => { if (ringElements.get(n) === element) ringElements.delete(n); };
            }}
            type="button"
            className={`stub${key === openKey ? ' is-out' : ''}`}
            aria-label={`${film.title}，查看详情`}
            onClick={(event) => pick(film, key, i, n, event.currentTarget)}
          >
            <StubFace film={film} sort={sort} />
          </button>
        );
      }))}
    </div>
  );
}
