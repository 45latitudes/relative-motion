import { useEffect, useRef, useState, type ReactNode } from 'react';
import { narrowQuery } from '../useNarrow.ts';
import { Clouds } from './Clouds.tsx';

// The opening: a cabin wall with one window and cloud outside it. Scrolling (or a click) widens
// the window and flies through the cloud; the catalogue behind it takes over for good.
const scrollDistance = 1.4; // screen heights of scrolling to open the window fully

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// On the board the page itself does not scroll, so an upward wheel gesture there goes back to the
// cover. Areas that can still scroll up (the tidy layout, the film details) take the wheel first,
// and nothing happens while a film is open.
function backOnScrollUp(goBack: () => void) {
  let pull = 0;
  let last = 0;
  // A gesture that began while something could still scroll up stays with that element, so
  // trackpad momentum that carries a list to its top does not spill over into going back.
  let held = false;
  const canScrollUp = (target: EventTarget | null) => {
    for (let element = target instanceof Element ? target : null; element && element !== document.body; element = element.parentElement) {
      if (element.scrollTop > 0 && element.scrollHeight > element.clientHeight) return true;
    }
    return false;
  };
  const onWheel = (event: WheelEvent) => {
    if (event.timeStamp - last > 250) {
      pull = 0;
      held = false;
    }
    last = event.timeStamp;
    if (canScrollUp(event.target)) held = true;
    if (event.deltaY >= 0 || held || document.querySelector('.has-open')) {
      pull = 0;
      return;
    }
    pull -= event.deltaY;
    if (pull > 60) goBack();
  };
  // On a touch screen: a downward pull, started where nothing can scroll up, goes back too.
  let touch: { x: number; y: number; held: boolean } | undefined;
  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0];
    touch = point && { x: point.clientX, y: point.clientY, held: canScrollUp(event.target) };
  };
  const onTouchMove = (event: TouchEvent) => {
    const point = event.touches[0];
    if (!touch || !point || touch.held || document.querySelector('.has-open')) return;
    const dy = point.clientY - touch.y;
    if (dy > 90 && dy > Math.abs(point.clientX - touch.x) * 1.6) {
      touch = undefined;
      goBack();
    }
  };
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
  };
}

export function Porthole({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const autoOpen = useRef(false);
  const progress = useRef(0);
  // Set when the reader scrolls back up from the board to the cover.
  const returning = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle('is-boarded', entered);
    if (entered) return backOnScrollUp(() => { returning.current = true; setEntered(false); });
    // Coming back, the window starts fully open and closes by itself back to the cover.
    let closing = returning.current;
    returning.current = false;
    autoOpen.current = false;
    let current = closing ? 1 : 0;
    let target = 0;
    let frame = 0;
    const apply = (p: number) => {
      progress.current = p;
      const e = smooth(p);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // On a phone the window takes a larger share of the narrow screen.
      const w0 = Math.min(vh * 0.42 * 0.68, vw * (window.matchMedia(narrowQuery).matches ? 0.56 : 0.3));
      const h0 = w0 / 0.68;
      const hole = windowRef.current;
      if (hole) {
        const w = lerp(w0, vw * 1.25, e);
        const h = lerp(h0, vh * 1.25, e);
        hole.style.width = `${w}px`;
        hole.style.height = `${h}px`;
        hole.style.borderRadius = `${lerp(w0 * 0.46, 0, e)}px`;
        hole.style.setProperty('--bezel', `${lerp(18, 0, e)}px`);
      }
      // The catalogue waits behind the cloud and settles into place as we come through it.
      if (viewRef.current) viewRef.current.style.transform = `scale(${lerp(1.15, 1, e)})`;
      // The title in front of the window and the words below it leave before the window grows.
      const out = smooth(clamp(p / 0.4));
      if (titleRef.current) {
        titleRef.current.style.opacity = String(1 - out);
        titleRef.current.style.transform = `translate(-50%, -50%) scale(${1 + 0.08 * out})`;
      }
      if (introRef.current) {
        introRef.current.style.opacity = String(1 - out);
        introRef.current.style.transform = `translate(-50%, ${28 * out}px)`;
      }
    };
    const tick = () => {
      current += (target - current) * (autoOpen.current || closing ? 0.08 : 0.14);
      if (Math.abs(target - current) < 0.0005) current = target;
      apply(current);
      if (closing && current === 0) closing = false;
      if (current >= 0.999) {
        setEntered(true);
        window.scrollTo(0, 0);
        return;
      }
      frame = current === target ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!frame) frame = requestAnimationFrame(tick); };
    const open = () => { autoOpen.current = true; target = 1; kick(); };
    // On a phone a half-open window does not stay half open: when the scrolling stops, past the
    // middle it carries on through the cloud, short of it it closes back to the cover.
    let settle = 0;
    const onScroll = () => {
      if (autoOpen.current || closing) return;
      target = clamp(window.scrollY / (window.innerHeight * scrollDistance));
      kick();
      if (!window.matchMedia(narrowQuery).matches) return;
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (autoOpen.current || closing || target <= 0.01 || target >= 0.99) return;
        if (target >= 0.4) open();
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 180);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    const onResize = () => apply(current);
    const hole = windowRef.current;
    apply(current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    hole?.addEventListener('click', open);
    if (closing) kick();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      hole?.removeEventListener('click', open);
    };
  }, [entered]);

  return (
    <>
      <div ref={viewRef} className="view" inert={!entered}>{children}</div>
      {!entered && (
        <>
          <Clouds progress={progress} />
          <div className="cabin">
            <div ref={windowRef} className="porthole" role="button" aria-label="打开舷窗，进入片单" tabIndex={0}>
              <span className="porthole-glare" aria-hidden="true" />
            </div>
          </div>
          <div ref={titleRef} className="cabin-title" aria-hidden="true">相对运动</div>
          <div ref={introRef} className="cabin-intro">
            <p className="cabin-name">相对运动<span lang="en">Relative Motion</span></p>
            <p>坐飞机有时有一种额外的乐趣：在面前那块小屏幕里，发现若干从没听说过的好电影。然而为了遇见它们，先把自己运到一万米的高处，想来有些周折。</p>
            <p>【相对运动】收集各家航司的片单，配上你熟悉的评分与影评，把“坐飞机才偶遇”的体验带到日常生活中，相对于掠过云端的椅背屏幕，在地面完成一次次光影间的飞行。</p>
            <p className="cabin-hint">向下滚动，或点舷窗</p>
          </div>
          <div className="cabin-track" style={{ height: `${(1 + scrollDistance) * 100}vh` }} aria-hidden="true" />
        </>
      )}
    </>
  );
}
