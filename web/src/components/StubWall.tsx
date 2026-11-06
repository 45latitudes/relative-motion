import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SortKey } from '../catalog/controller.ts';
import type { FilmView } from '../catalog/view.ts';
import { StubFace } from './Stub.tsx';

// A tilted wall of ticket stubs drifting in alternate directions, written for this project after
// the "drift wall" idea: columns loop endlessly, a hovered column slows to a stop, the pointer
// tilts the plane slightly. The whole wall eases to a stop while a film is open.
interface Props {
  films: FilmView[];
  sort: SortKey;
  // The tile key currently lifted out of the wall, hidden in place.
  openKey?: string;
  onPick: (film: FilmView, key: string, element: HTMLElement) => void;
}

// Stub size is set in CSS (the printed proportions); the wall measures it.
const gap = 22;
const speed = 26; // px per second

export function StubWall({ films, sort, openKey, onPick }: Props) {
  const columns = Math.max(1, Math.min(5, films.length));
  const lanes = useMemo(() => {
    const result: FilmView[][] = Array.from({ length: columns }, () => []);
    films.forEach((film, index) => result[index % columns].push(film));
    return result;
  }, [films, columns]);

  const rootRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [height, setHeight] = useState(900);
  const [tileHeight, setTileHeight] = useState(270);
  const hoveredLane = useRef(-1);
  const pointer = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const paused = useRef(false);
  paused.current = openKey !== undefined;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height || 900);
      const stub = root.querySelector<HTMLElement>('.stub');
      if (stub?.offsetHeight) setTileHeight(stub.offsetHeight);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const unit = tileHeight + gap;
  const meta = lanes.map((lane) => {
    const copyHeight = Math.max(unit, lane.length * unit);
    return { copyHeight, copies: Math.max(2, Math.ceil((height * 1.8) / copyHeight) + 1) };
  });
  const metaRef = useRef(meta);
  metaRef.current = meta;

  useEffect(() => {
    const offsets = lanes.map((_, c) => metaRef.current[c].copyHeight * ((c * 0.37) % 1));
    const velocities = lanes.map(() => 0);
    let last: number | undefined;
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, last === undefined ? 0 : (now - last) / 1000);
      last = now;
      const p = pointer.current;
      const damp = 1 - Math.exp(-dt / 0.15);
      p.dx += (p.x - p.dx) * damp;
      p.dy += (p.y - p.dy) * damp;
      if (planeRef.current) {
        planeRef.current.style.transform = `translate(-50%, -50%) rotateX(${14 - p.dy * 4}deg) rotateY(${-16 + p.dx * 5}deg) translateZ(-90px)`;
      }
      lanes.forEach((_, c) => {
        const m = metaRef.current[c];
        const track = trackRefs.current[c];
        if (!m || !track) return;
        const target = paused.current || hoveredLane.current === c ? 0 : speed * (c % 2 === 0 ? 1 : -1) * (1 + 0.25 * Math.sin(c * 1.7));
        velocities[c] += (target - velocities[c]) * (1 - Math.exp(-dt / (target === 0 ? 0.18 : 0.4)));
        offsets[c] = (((offsets[c] + velocities[c] * dt) % m.copyHeight) + m.copyHeight) % m.copyHeight;
        track.style.transform = `translate3d(0, ${-offsets[c]}px, 0)`;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [lanes]);

  return (
    <div
      ref={rootRef}
      className={`stub-wall${openKey ? ' is-paused' : ''}`}
      onPointerMove={(event) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect) pointer.current = { ...pointer.current, x: (event.clientX - rect.left) / rect.width - 0.5, y: (event.clientY - rect.top) / rect.height - 0.5 };
      }}
      onPointerLeave={() => { pointer.current = { ...pointer.current, x: 0, y: 0 }; hoveredLane.current = -1; }}
    >
      <div ref={planeRef} className="stub-plane" style={{ gap: `${gap}px` }}>
        {lanes.map((lane, c) => (
          <div
            key={c}
            className="stub-lane"
            onPointerEnter={() => { hoveredLane.current = c; }}
            onPointerLeave={() => { if (hoveredLane.current === c) hoveredLane.current = -1; }}
          >
            <div className="stub-track" ref={(element) => { trackRefs.current[c] = element; }} style={{ gap: `${gap}px` }}>
              {Array.from({ length: meta[c]?.copies ?? 2 }, (_, copy) => lane.map((film) => {
                const key = `${film.id}|${c}|${copy}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`stub${key === openKey ? ' is-out' : ''}`}
                    aria-label={`${film.title}，查看详情`}
                    onClick={(event) => onPick(film, key, event.currentTarget)}
                  >
                    <StubFace film={film} sort={sort} />
                  </button>
                );
              }))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
