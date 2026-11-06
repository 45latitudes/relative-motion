// The torn perforation between the ticket and its stub. Both halves are cut from the same edge
// line, so the fibres of one fit the other when the stub rejoins. Units are millimetres of the
// printed ticket: 83 mm tall, holes 1.1 mm wide every 83 / 30 mm, the tear inside a 2 mm strip.
export const ticketMm = { height: 83, main: 151, stub: 51, strip: 2 } as const;

const holes = 30;
const radius = 0.55;
const line = ticketMm.strip / 2;

// Small deterministic generator, so the edge is the same on every load.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Points of the torn edge between holes; x is the offset from the perforation line.
function edge() {
  const next = random(83);
  const period = ticketMm.height / holes;
  const segments: [number, number][][] = [];
  for (let i = 0; i <= holes; i += 1) {
    const from = i === 0 ? 0 : (i - 0.5) * period + radius;
    const to = i === holes ? ticketMm.height : (i + 0.5) * period - radius;
    const points: [number, number][] = [[0, from]];
    let x = 0;
    // Each bridge of paper tears unevenly: it leans one way, with fibre noise on top and now
    // and then a longer fibre pulled out of one side.
    const lean = (next() - 0.5) * 0.5;
    for (let y = from + 0.08; y < to - 0.06; y += 0.06 + next() * 0.08) {
      const t = (y - from) / (to - from);
      const bow = lean * Math.sin(Math.PI * t);
      x = x * 0.45 + (next() - 0.5) * 0.3 + (next() < 0.1 ? (next() - 0.5) * 0.7 : 0);
      points.push([Math.max(-0.85, Math.min(0.85, bow + x * Math.sin(Math.PI * t) ** 0.5)), y]);
    }
    points.push([0, to]);
    segments.push(points);
  }
  return segments;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// The tear line itself, top to bottom, with half of each punched hole bulging into this side.
function tearEdge(side: 'main' | 'stub') {
  const sweep = side === 'main' ? 0 : 1;
  let d = '';
  edge().forEach((points, index, segments) => {
    for (const [x, y] of points) d += `${d ? 'L' : 'M'}${round(line + x)} ${round(y)}`;
    if (index < segments.length - 1) {
      const end = points[points.length - 1][1] + radius * 2;
      d += `A${radius} ${radius} 0 0 ${sweep} ${line} ${round(end)}`;
    }
  });
  return d;
}

// Closed paper shape inside the strip: main keeps the left of the tear, the stub the right.
function tearShape(side: 'main' | 'stub') {
  const outer = side === 'main' ? 0 : ticketMm.strip;
  return `M${outer} 0L${tearEdge(side).slice(1)}L${outer} ${ticketMm.height}Z`;
}

const svg = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ticketMm.strip} ${ticketMm.height}' preserveAspectRatio='none'>${body}</svg>`,
  )}")`;

// The same tear laid across: for a ticket held upright, as on a phone, the main part sits above
// the tear and the stub below. Swapping x and y keeps it the very same edge.
const across = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ticketMm.height} ${ticketMm.strip}' preserveAspectRatio='none'><g transform='matrix(0 1 1 0 0 0)'>${body}</g></svg>`,
  )}")`;

// Mask shapes for each side, and a pale line of exposed fibre just inside the torn edge.
export function paperVariables(): Record<string, string> {
  const fibre = (side: 'main' | 'stub') => svg(`<path d='${tearEdge(side)}' fill='none' stroke='white' stroke-opacity='.55' stroke-width='.28'/>`);
  return {
    '--tear-main': svg(`<path d='${tearShape('main')}'/>`),
    '--tear-stub': svg(`<path d='${tearShape('stub')}'/>`),
    '--fibre-main': fibre('main'),
    '--fibre-stub': fibre('stub'),
    '--tear-main-across': across(`<path d='${tearShape('main')}'/>`),
    '--tear-stub-across': across(`<path d='${tearShape('stub')}'/>`),
  };
}

export function applyPaper(root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(paperVariables())) root.style.setProperty(name, value);
}
