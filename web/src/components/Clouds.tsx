import { useEffect, useRef, type RefObject } from 'react';
import { makeField, makeSea, makeStars, makeStreaks, paintField, paintSea, paintSky, paintStars, paintStreaks } from '../sky.ts';

// The view from the closed window: the board's own sky with cumulus in front of it. The camera
// drifts sideways while the window is closed; as it opens (progress 0 → 1) it flies forward
// through the cumulus, and the sky over the catalogue clears to show the stubs and the ticket.
interface Props {
  // Opening progress, written by the porthole every frame.
  progress: RefObject<number>;
}

const fade = (from: number, to: number, p: number) => {
  const t = Math.min(1, Math.max(0, (p - from) / (to - from)));
  return 1 - t * t * (3 - 2 * t);
};

export function Clouds({ progress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const stars = makeStars(90);
    const streaks = makeStreaks(context);
    const sea = makeSea();
    const field = makeField();
    let frame = 0;
    // Clouds are soft; half resolution is plenty and keeps every frame cheap.
    const resize = () => {
      canvas.width = Math.ceil(window.innerWidth / 2);
      canvas.height = Math.ceil(window.innerHeight / 2);
    };
    resize();
    const draw = (now: number) => {
      const seconds = now / 1000;
      const p = progress.current ?? 0;
      context.clearRect(0, 0, canvas.width, canvas.height);
      // The sky stays closed through the first half, so nothing behind shows until we are in the cloud.
      const cover = fade(0.5, 0.82, p);
      if (cover > 0) {
        context.globalAlpha = cover;
        paintSky(context, seconds);
        paintStars(context, stars, seconds, cover);
        paintStreaks(context, streaks, seconds, cover);
        paintSea(context, sea, seconds, 0, 1.01, cover);
      }
      paintField(context, field, seconds, 15 * p ** 1.4, fade(0.86, 0.99, p));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [progress]);

  return <canvas ref={canvasRef} className="clouds" aria-hidden="true" />;
}
