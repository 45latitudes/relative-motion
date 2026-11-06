import { useEffect, useRef } from 'react';
import { makeSea, makeStars, makeStreaks, paintSea, paintSky, paintStars, paintStreaks } from '../sky.ts';

// The board's sky. Behind: afterglow, faint stars, high streaks and the far rows of the sea of
// cloud. In front of the stubs: the near rows, so stubs rise out of the cloud and sink into it.
const split = 0.55;

export function Sky() {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const backCanvas = backRef.current;
    const frontCanvas = frontRef.current;
    const back = backCanvas?.getContext('2d');
    const front = frontCanvas?.getContext('2d');
    if (!backCanvas || !frontCanvas || !back || !front) return;
    const stars = makeStars(90);
    const streaks = makeStreaks(back);
    const sea = makeSea();
    let frame = 0;
    // Half resolution: the sky is soft, and the stars read as faint glints.
    const resize = () => {
      for (const canvas of [backCanvas, frontCanvas]) {
        canvas.width = Math.ceil(canvas.clientWidth / 2);
        canvas.height = Math.ceil(canvas.clientHeight / 2);
      }
    };
    resize();
    const draw = (now: number) => {
      const seconds = now / 1000;
      paintSky(back, seconds);
      paintStars(back, stars, seconds);
      paintStreaks(back, streaks, seconds);
      paintSea(back, sea, seconds, 0, split);
      front.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      paintSea(front, sea, seconds, split);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    observer.observe(backCanvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <canvas ref={backRef} className="sky-back" aria-hidden="true" />
      <canvas ref={frontRef} className="sky-front" aria-hidden="true" />
    </>
  );
}
