import type { Point } from './office-primitives';

/** Light for one hour of the day. The scene blends between two of these. */
export interface Daylight {
  background: string;
  ground: string;
  /** The site grid outside the room. */
  grid: string;
  ambient: string;
  ambientIntensity: number;
  hemisphere: number;
  sun: string;
  sunIntensity: number;
  sunPosition: Point;
  fill: string;
  fillIntensity: number;
  /** The sun or moon seen through the window wall. */
  disc: string;
  skyHeight: number;
  /** How hard the room's own lamps work, 0 at midday and 1 in the small hours. */
  interior: number;
  night: boolean;
}

type Keyframe = Daylight & { hour: number };

/** Four keyframes: night, morning, midday, evening. Anything between is interpolated. */
const KEYFRAMES: Keyframe[] = [
  {
    hour: 2,
    background: '#151d2a',
    ground: '#1e2634',
    grid: '#2e3a4d',
    // Warm lamplight inside, cool moonlight through the glazing.
    ambient: '#ffd6a2',
    ambientIntensity: 0.62,
    hemisphere: 0.22,
    sun: '#8fa9de',
    sunIntensity: 1.15,
    sunPosition: [-13, 11, 5],
    fill: '#5d7ba8',
    fillIntensity: 0.45,
    disc: '#eef3ff',
    skyHeight: 5.4,
    interior: 1,
    night: true,
  },
  {
    hour: 8,
    background: '#eef1e9',
    ground: '#f6f7ef',
    grid: '#b3c1ae',
    ambient: '#e3dcc9',
    ambientIntensity: 0.36,
    hemisphere: 0.66,
    sun: '#ffd9a8',
    sunIntensity: 3.1,
    sunPosition: [-14, 8, 7],
    fill: '#a9c9cd',
    fillIntensity: 1,
    disc: '#ffe3b0',
    skyHeight: 2.4,
    interior: 0.16,
    night: false,
  },
  {
    hour: 13,
    background: '#f1f4ee',
    ground: '#ffffff',
    grid: '#a7b6a3',
    ambient: '#ffffff',
    ambientIntensity: 0.38,
    hemisphere: 0.72,
    sun: '#ffe6ba',
    sunIntensity: 3.8,
    sunPosition: [-12, 14, 9],
    fill: '#a9c9cd',
    fillIntensity: 1.1,
    disc: '#fff6dd',
    skyHeight: 6.2,
    interior: 0,
    night: false,
  },
  {
    hour: 20,
    background: '#e7e3da',
    ground: '#efe7db',
    grid: '#b5a996',
    ambient: '#f0cfa6',
    ambientIntensity: 0.34,
    hemisphere: 0.52,
    sun: '#ffb072',
    sunIntensity: 2.4,
    sunPosition: [-15, 4.5, 4],
    fill: '#8fa6b5',
    fillIntensity: 0.8,
    disc: '#ffb478',
    skyHeight: 1.5,
    interior: 0.5,
    night: false,
  },
  {
    // Dusk: the sky has gone cold and the room is running on its own lamps.
    hour: 21,
    background: '#222c3c',
    ground: '#2a3342',
    grid: '#3b4759',
    ambient: '#ffcf9a',
    ambientIntensity: 0.58,
    hemisphere: 0.28,
    sun: '#7f9bd0',
    sunIntensity: 1.35,
    sunPosition: [-14, 7, 5],
    fill: '#5f7ca6',
    fillIntensity: 0.5,
    disc: '#e4ecff',
    skyHeight: 3.4,
    interior: 0.88,
    night: true,
  },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function mixColor(a: string, b: string, t: number): string {
  const parse = (value: string) => [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (from: number, to: number) =>
    Math.round(mix(from, to, t))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/**
 * The room's light for a local hour. Hours wrap, so 23:00 blends into the small
 * hours rather than jumping.
 */
export function daylight(hour: number): Daylight {
  const clock = ((hour % 24) + 24) % 24;
  let from = KEYFRAMES[KEYFRAMES.length - 1];
  let to = KEYFRAMES[0];
  for (let i = 0; i < KEYFRAMES.length; i++) {
    const current = KEYFRAMES[i];
    const next = KEYFRAMES[(i + 1) % KEYFRAMES.length];
    const span = (next.hour - current.hour + 24) % 24;
    const into = (clock - current.hour + 24) % 24;
    if (into < span) {
      from = current;
      to = next;
      break;
    }
  }
  const span = (to.hour - from.hour + 24) % 24;
  const t = span === 0 ? 0 : ((clock - from.hour + 24) % 24) / span;
  return {
    background: mixColor(from.background, to.background, t),
    ground: mixColor(from.ground, to.ground, t),
    grid: mixColor(from.grid, to.grid, t),
    ambient: mixColor(from.ambient, to.ambient, t),
    ambientIntensity: mix(from.ambientIntensity, to.ambientIntensity, t),
    hemisphere: mix(from.hemisphere, to.hemisphere, t),
    sun: mixColor(from.sun, to.sun, t),
    sunIntensity: mix(from.sunIntensity, to.sunIntensity, t),
    sunPosition: [
      mix(from.sunPosition[0], to.sunPosition[0], t),
      mix(from.sunPosition[1], to.sunPosition[1], t),
      mix(from.sunPosition[2], to.sunPosition[2], t),
    ],
    fill: mixColor(from.fill, to.fill, t),
    fillIntensity: mix(from.fillIntensity, to.fillIntensity, t),
    disc: mixColor(from.disc, to.disc, t),
    skyHeight: mix(from.skyHeight, to.skyHeight, t),
    interior: mix(from.interior, to.interior, t),
    night: t < 0.5 ? from.night : to.night,
  };
}
