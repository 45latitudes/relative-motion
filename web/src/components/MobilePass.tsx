import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { SortKey } from '../catalog/controller.ts';
import type { FilmView } from '../catalog/view.ts';
import { StubFace } from './Stub.tsx';
import { placements } from './StubRings.tsx';
import { TicketDetails } from './TicketDetails.tsx';

// The boarding pass held upright on a phone. The chosen stub leaves its ring, straightens and
// settles at the top; the body of the pass rises out of the cloud below and joins it along the
// tear. Closing reverses both: the body sinks back into the cloud, the stub returns to its ring.
export interface MobileFlight {
  film: FilmView;
  key: string;
  origin: HTMLElement;
  phase: 'leaving' | 'joined' | 'returning';
}

interface Props {
  flight: MobileFlight;
  sort: SortKey;
  onPhase: (phase: MobileFlight['phase']) => void;
  onGone: () => void;
}

// Where the stub was: its centre, size and lean, from the ring (or its box in the tidy list).
function originOf(element: HTMLElement) {
  const placed = placements.get(element);
  if (placed) return placed;
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, angle: 0, width: box.width, height: box.height };
}

export function MobilePass({ flight, sort, onPhase, onGone }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<DOMRect>();
  const [origin] = useState(() => originOf(flight.origin));
  const { film, phase } = flight;

  // The pass is laid out (hidden) first, so the stub's place at the top can be measured.
  useLayoutEffect(() => { setSlot(slotRef.current?.getBoundingClientRect()); }, []);
  useEffect(() => {
    const onResize = () => setSlot(slotRef.current?.getBoundingClientRect());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (!slot || phase !== 'leaving') return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => onPhase('joined')));
    return () => cancelAnimationFrame(frame);
  }, [slot, phase, onPhase]);
  useEffect(() => {
    if (phase !== 'returning') return;
    const timer = setTimeout(onGone, 1150);
    return () => clearTimeout(timer);
  }, [phase, onGone]);

  const close = () => { if (phase !== 'returning') onPhase('returning'); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let stub: CSSProperties | undefined;
  if (slot) {
    const atTop = phase === 'joined';
    const dx = slot.left + slot.width / 2 - origin.x;
    const dy = slot.top + slot.height / 2 - origin.y;
    stub = {
      left: origin.x - origin.width / 2,
      top: origin.y - origin.height / 2,
      width: origin.width,
      height: origin.height,
      fontSize: `${origin.width / 30}px`,
      transform: atTop ? `translate(${dx}px, ${dy}px) scale(${slot.width / origin.width})` : `rotate(${origin.angle}rad)`,
    };
  }

  return (
    <div className={`m-pass-layer is-${phase}${slot ? '' : ' is-measuring'}`} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="m-pass" role="dialog" aria-modal="true" aria-label={`《${film.title}》`}>
        <div ref={slotRef} className="m-slot" aria-hidden="true" />
        <article className="m-body">
          <div className="ticket-band">
            <span>相对运动</span>
            <button type="button" className="ticket-close" onClick={close}>收起 ✕</button>
          </div>
          <TicketDetails key={film.id} film={film} />
        </article>
      </div>
      {stub && (
        <button type="button" className={`stub m-flyer is-${phase}`} style={stub} aria-label="收起这部片" onClick={close}>
          <StubFace film={film} sort={sort} joined />
        </button>
      )}
    </div>
  );
}
