import { useEffect, useState } from 'react';

// Phones and narrow windows get the upright layout; the breakpoint is where the side-by-side
// ticket and stub wall no longer fit.
export const narrowQuery = '(max-width: 720px)';

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(narrowQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(narrowQuery);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}
