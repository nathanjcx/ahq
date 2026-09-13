/**
 * Every colour the 3D office draws, in one place.
 *
 * The office is the same product as the chrome around it (`app/globals.css`): a cool
 * off-white canvas, slate ink, and one accent blue. So the building is pale ash and
 * cool plaster rather than orange oak and sage, the soft furniture is in the accent
 * blue family, the plants stay green because a plant is green, and the daylight ramp
 * is blue-white at noon with amber kept for the low sun angles, so the day still has
 * a rhythm. Status colours stay outside that family, and stay distinct, because in a
 * signal the colour is the meaning.
 *
 * Nothing in `components/office` may hold a colour literal of its own: a second
 * definition of the same colour is how a room drifts out of the brand.
 */
export const C = {
  /* === The building: slab, floor, walls, glazing === */
  /** The chamfered edge under the room's plate. */
  plinth: '#222d3d',
  /** The plate the room stands on. */
  slab: '#2c3849',
  /** Pale ash boards: the floors' base tone. */
  floor: '#c9c7c1',
  /** The basement's sealed concrete. */
  floorStone: '#b4bcc7',
  /** The boardroom's pale stone. */
  floorPale: '#ccd3dc',
  /** The nosing along the room's open edge. */
  floorEdge: '#d7d4cd',
  /** The parquet run: six board tones laid at random. */
  planks: ['#cbc8c0', '#b7b3aa', '#d3d0c9', '#c1bdb4', '#c6c3bc', '#bcb8af'],
  /** Cool plaster. */
  wall: '#e6eaf1',
  /** The basement's darker plaster. */
  wallDeep: '#c7cfda',
  /** Skirting, mullions, reveals, window surrounds. */
  trim: '#f2f5fa',
  /** The balcony pickets along the open edge. */
  rail: '#8494a8',
  /** The window wall's tint. */
  glass: '#8fa9c4',
  /** The meeting room's near-clear partitions. */
  glassClear: '#d4dfea',
  /** The frosted privacy bands across the glass. */
  frost: '#b6cadd',
  /** The meeting room's dark frames. */
  mullion: '#2a394d',
  /** The thinner inner mullions. */
  mullionSoft: '#41536b',

  /* === Wood: pale ash for the surfaces, smoked ash for the dark joinery === */
  /** Desktops, shelves, worktops. Drives the wood grain map in office-primitives. */
  wood: '#c9c5bd',
  /** A desk's modesty panel and other secondary carcass. */
  woodEdge: '#b0aca3',
  /** Smoked ash: lecterns, the boardroom table, board frames, acoustic slats. */
  walnut: '#3f4757',
  /** Every third acoustic slat, so the run has a grain. */
  walnutLight: '#525d70',
  /** What the slats are mounted on. */
  walnutDark: '#2a3140',

  /* === Fabric: the accent blue family === */
  /** Task chairs and the armchairs. */
  seat: '#3b5f9c',
  /** The lighter upholstery, so a room's seating is not one flat blue. */
  seatSoft: '#7f97b8',
  /** The lounge sofa. */
  sofa: '#2f4d7d',
  /** The sofa's base, under the cushions. */
  sofaDeep: '#25406a',
  /** Scatter cushions and headrests. */
  cushion: '#c3cfdf',
  /** The second cushion, a shade down. */
  cushionSoft: '#a9bcd4',
  /** The woven rug, and its border. */
  rug: '#8c98aa',
  rugEdge: '#aab4c2',
  /** A high-visibility vest, and its reflective bands. */
  vest: '#e0cc4b',
  vestBand: '#c9ced2',

  /* === People: the kit a figure wears. Skin and hair are human, not brand. === */
  skinTones: ['#b98261', '#e2b48e', '#885e48', '#ce9a76', '#bc815e', '#e6bea0'],
  hairColors: ['#3d3029', '#76533b', '#272f2b', '#3c3029', '#9c7653', '#3b3431'],
  /** The auditor's long coat. */
  coat: '#333d4c',
  /** Trousers: the auditor's, and the two the rest of the floor wears. */
  trouserDark: '#39414a',
  trousers: ['#4e5563', '#33445c'],
  shoe: '#dfe3ea',

  /* === Metal: brushed steel hardware === */
  /** Pulls, lamp stems, inlay strips, door furniture. */
  metal: '#9daabb',
  /** Chair columns, castors, the darker fittings. */
  metalDeep: '#66727f',
  /** Feet, bases, and anything meant to disappear. */
  metalDark: '#4f5a68',
  /** Painted steel casework: filing cabinets and records shelving. */
  cabinet: '#7d8da3',
  cabinetDeep: '#5a6a80',

  /* === Plants: still green === */
  /** The leaves. */
  plant: '#2f6140',
  /** Every other leaf, so a plant has some depth. */
  plantLight: '#4e8355',
  /** The stems. */
  stem: '#4a6b45',
  /** The soil in the pot. */
  soil: '#4c4a46',
  /** The pot itself, and the stone one. */
  pot: '#d5d8de',
  potStone: '#b3aca4',

  /* === Paper and ink === */
  paper: '#f3f6fb',
  /** Alternating sheets in a stack, and a card's second tone. */
  paperShade: '#e4eaf3',
  /** A label or a tab that is not carrying any status. */
  paperDim: '#d7deea',
  /** A finished card: the same paper, gone quiet. */
  paperDone: '#dee4ee',
  /** Clock hands, keyboard legends, anything printed. */
  ink: '#1f2b3d',
  /** Ruled lines on a sheet, and the strings on the board. */
  inkSoft: '#94a1b4',
  /** The faintest rule, where a line is only there for texture. */
  inkFaint: '#b3becb',

  /** A shelf of book spines, and a run of sticky notes on a whiteboard. */
  books: ['#2f4d7d', '#7f97b8', '#3b5f9c', '#c4ccd8', '#4a6b8c'],
  stickies: ['#a6c2dd', '#e8cf95', '#bcb3d6', '#a8ccbb'],

  /* === Screens === */
  /** A laptop lid or a monitor's face, switched on. */
  screen: '#17293f',
  /** The bezel around it. */
  screenFrame: '#243447',
  /** A laptop's shell, its lighter trackpad, and its keyboard deck. */
  shell: '#aeb6c1',
  shellLight: '#c3cad3',
  shellDeep: '#697487',
  /** Lines of something on a screen: a live one, and the rest. */
  screenLive: '#8fd0b6',
  screenLine: '#7b93ab',

  /* === Lamps: warm tungsten, because an office lamp is warm === */
  /** A lit fitting's own glow. */
  lamp: '#fff1de',
  /** The halo it throws, and the light it casts. */
  lampHalo: '#ffeedb',
  /** The glass a window spills at night. */
  windowGlow: '#ffe3c3',

  /* === Scene lighting the ramp does not carry === */
  /** The hemisphere light's sky and ground, by day and by night. */
  hemiSky: '#dbe6f4',
  hemiSkyNight: '#8ea6c8',
  hemiGround: '#3c4656',
  hemiGroundNight: '#2a3340',

  /* === Status: outside the blue family, because colour is the meaning here === */
  /** Working, and the legend's Working dot. */
  working: '#6f9d63',
  /** Waiting on a person: the attention ring, the board's waiting cards, findings. */
  amber: '#d79a4a',
  /** Amber's brighter twin, for a lens or a lit lamp. */
  amberLit: '#e8b165',
  /** Blocked, and the incident beacon's red. */
  red: '#b4553c',
  /** The beacon's hot core and the emergency notice's bar. */
  beacon: '#ff8a5c',
  /** A claim in conflict. Nothing else on the shelves is near it. */
  contested: '#cf2b46',
  /** A provider that is up but struggling, and the sputter it flickers to. */
  degraded: '#c06a43',
  degradedDim: '#4a3427',
  /** Available, idle, and a done card's quiet grey. */
  idle: '#9aa4b1',
  done: '#97a0ad',

  /* === The accent, straight from the chrome === */
  /** --accent. Used where the office points at itself: a live screen, a scope band. */
  accent: '#2a68cd',
  accentDeep: '#1d4f9e',
} as const;

/** The six memory scopes on the records room's casework, kept apart by hue. */
export const SCOPE_COLORS: Record<string, string> = {
  workspace: C.accentDeep,
  floor: '#3f7f86',
  project: '#6a5aa8',
  agent: '#8a7a2b',
  task: '#5b7d86',
};

/** One stop on the daylight ramp. `daylight.ts` blends between two of these. */
export interface SkyStop {
  background: string;
  /** The site grid outside the room. */
  grid: string;
  ground: string;
  ambient: string;
  sun: string;
  fill: string;
  /** The sun or moon seen through the window wall. */
  disc: string;
}

/**
 * The ramp: slate at night, cool at the top of the day, amber only when the sun is
 * low enough for it to be true.
 */
export const sky: Record<'night' | 'morning' | 'noon' | 'evening' | 'dusk' | 'windowless', SkyStop> = {
  night: {
    background: '#141c2b',
    ground: '#1d2534',
    grid: '#2d3a4e',
    // Lamplight inside, moonlight through the glazing.
    ambient: '#ffeeda',
    sun: '#8fa9de',
    fill: '#5d7ba8',
    disc: '#eef3ff',
  },
  morning: {
    background: '#eaf0f8',
    ground: '#f4f8fd',
    grid: '#aebdd1',
    ambient: '#dfe5ef',
    // The sun is barely up: this is the one hour it is allowed to be amber.
    sun: '#ffd6a6',
    fill: '#a9c2d8',
    disc: '#ffdcb0',
  },
  noon: {
    background: '#f1f5fa',
    ground: '#ffffff',
    grid: '#a6b6cc',
    ambient: '#ffffff',
    sun: '#e8f0ff',
    fill: '#a9c2d8',
    disc: '#f2f7ff',
  },
  evening: {
    background: '#e6e4e4',
    ground: '#ece8e4',
    grid: '#aaa9a8',
    ambient: '#e9cdaf',
    sun: '#f0a878',
    fill: '#8fa6bb',
    disc: '#f0aa7e',
  },
  dusk: {
    background: '#1f2838',
    ground: '#27303f',
    grid: '#3a4558',
    ambient: '#ffe9d3',
    sun: '#7f9bd0',
    fill: '#5f7ca6',
    disc: '#e4ecff',
  },
  /** A room with no windows, such as the basement: no sun at all, on strip lighting. */
  windowless: {
    background: '#1b212b',
    ground: '#232a35',
    grid: '#333c4a',
    ambient: '#e9eff8',
    sun: '#b7bec8',
    fill: '#8f96a0',
    disc: '#eef3ff',
  },
};
