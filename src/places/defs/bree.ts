/**
 * Bree at walking scale: the crossing of the ways out on the open road, the dike and its hedge,
 * the west gate, the street climbing the flank of Bree-hill past the houses of the Big Folk to
 * The Prancing Pony at the bend, the hobbit doors above the roofs, the brow of the hill, Staddle
 * on the far side, and the south gate with the last house beside it.
 *
 * Coordinates in metres, +x east, +z south. Written from the descriptions in The Lord of the
 * Ring. Bree is deliberately the opposite of Hobbiton: no water anywhere, one dominant hill, and
 * everything stacked in bands up one slope instead of spread over open country.
 */
import type { PlaceDef, Hill, Spot } from '../types'
import type { Prop } from '@/world/schema'

const W = 460
const H = 440
const BASE = 8

type P = Partial<Prop>
type At = P & { at: [number, number] }

/** Points along a circle, angles in degrees with 0 = east and 90 = south (+z). */
function arc(cx: number, cz: number, r: number, from: number, to: number, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r])
  }
  return out
}

/**
 * Hedge segments laid along an arc, each turned to its own tangent. The line form of `hedge`
 * registers colliders, so this is what actually keeps the traveller out of the fields and makes
 * them use a gate.
 */
function hedgeArc(cx: number, cz: number, r: number, from: number, to: number, n: number, height = 2.3): At[] {
  const out: At[] = []
  const step = (to - from) / n
  for (let i = 0; i < n; i++) {
    const mid = ((from + step * (i + 0.5)) * Math.PI) / 180
    const x = cx + Math.cos(mid) * r
    const z = cz + Math.sin(mid) * r
    const seg = (Math.abs(step) * Math.PI * r) / 180
    out.push({ kind: 'hedge', at: [x, z], rotation: Math.atan2(-Math.cos(mid), -Math.sin(mid)), params: { length: seg + 1.2, height } })
  }
  return out
}

/** A smial facing `rot` (0 = door faces south), with the knoll it is dug into. */
function smial(x: number, z: number, rot: number, doorColor: string, extra: Record<string, unknown> = {}): { hill: Hill; prop: At } {
  const k = 6.5
  return {
    hill: { x: x - Math.sin(rot) * k, z: z - Math.cos(rot) * k, r: 10, h: 3.6 },
    prop: { kind: 'smial', at: [x, z], rotation: rot, params: { doorColor, ...extra } },
  }
}

// the dike: out from the hill, round the west, and back to the hill, broken where the Road crosses
const DIKE = { x: 300, z: 268, r: 126 }
const HEDGE_R = DIKE.r - 5

/**
 * A point on the hedge line at `deg` (the angles `arc` uses), and the yaw that lays a gate across
 * the road there: the gate's posts follow the hedge, and its leaves open outward, away from the
 * town. Both gates are placed with this, so their posts stand in the hedge rather than out on the
 * causeway, and the hedge arcs below stop exactly at them.
 */
function onHedge(deg: number): { x: number; z: number; rot: number } {
  const a = (deg * Math.PI) / 180
  return { x: DIKE.x + Math.cos(a) * HEDGE_R, z: DIKE.z + Math.sin(a) * HEDGE_R, rot: Math.atan2(-Math.cos(a), -Math.sin(a)) }
}
// where the East Road crosses the hedge line on the way in, and where the street crosses it on the
// way out (the street's own line, so the road runs through the middle of the gate)
const WEST_GATE_DEG = -180
const SOUTH_GATE_DEG = -249.1
const WEST_GATE = onHedge(WEST_GATE_DEG)
const SOUTH_GATE = onHedge(SOUTH_GATE_DEG)
// A gate's posts stand 2.8 m either side of its middle, and a hedge piece reaches 0.6 m past the
// end of its arc, so stopping each arc this far short of a gate brings the hedge up to the post:
// the only way through is between the posts, not round the side of them.
const GATE_HALF_DEG = ((2.8 - 0.6) / HEDGE_R) * (180 / Math.PI)

// weathered, unpainted hobbit doors — Bree is older and plainer than the Shire
const HILL_DOORS = [
  smial(268, 248, -1.5, '#6b7f66'),
  // no garden fence: it would shut the only gap between this hole and the next one north, which
  // is where the lane comes up from the inn and goes on over the shoulder to Staddle
  smial(281, 256, -1.45, '#8a5a3f', { wall: '#bfae8e', fence: false }),
  // 2.5 m north of where it was first put, so the turf bank round its door ends short of the
  // straight way down from the hill's crown to the doors (its doorstep flat moved with it)
  smial(292, 237.5, -1.6, '#7d6f4a'),
  smial(276, 232, -1.52, '#5f6b7a', { wall: '#c4b89a' }),
]
const STADDLE_DOORS = [
  smial(392, 304, 0.5, '#4f6b4a'),
  smial(408, 296, 0.3, '#7a5a3a', { wall: '#c9a978' }),
  smial(400, 282, 0.1, '#6a6f7d'),
]

const spots: Spot[] = [
  {
    id: 'the-crossing',
    displayName: 'The Crossing of the Ways',
    type: 'other',
    mapIcon: 'waymark',
    position: [112, 268],
    discoverRadius: 18,
    radius: 26,
    setting:
      'Two roads meet on open ground west of the village. The great road runs east and west and is still rutted with use; the other comes down out of the north between lines of half-sunk kerb stones and has grass growing over it. A leaning signpost stands where they cross.',
    vegetation: { density: 0.5 },
    props: [
      { kind: 'signpost', offset: [2, -2], rotation: 0.4, params: { boards: 2 } },
      { kind: 'standingStone', offset: [-6, 4], params: { height: 2.2 } },
      { kind: 'stones', offset: [8, 8], params: { count: 5, size: 0.7 } },
      { kind: 'cart', offset: [10, -6], rotation: 0.8, params: { load: 'hay' } },
      { kind: 'bigTree', offset: [-16, -14], params: { scale: 1.2 } },
    ],
    lore: {
      region: 'outside-the-dike',
      summary:
        'Bree stands at an old meeting of ways, and that is the whole character of the town: news from the north, south and east all arrived here, which is why "strange as news from Bree" was still a saying in the Shire long after anyone remembered why.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'That autumn the Bree-folk kept complaining of strangers coming up the old road out of the south and settling where nobody wanted them. It was the first sign, had anyone read it, that something had begun to move in the world.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Homeward Bound',
          text: 'West of here, on the way home at the end of everything, Gandalf turned off the Road to go and talk with Tom Bombadil, and the four hobbits rode the last stretch to the Shire alone.',
        },
      ],
      characters: ['Harry Goatleaf', 'Gandalf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree',
    },
  },
  {
    id: 'greenway',
    displayName: 'The Greenway',
    type: 'other',
    mapIcon: 'waymark',
    position: [102, 168],
    discoverRadius: 16,
    radius: 24,
    setting:
      'The old north road runs away through empty grass with nothing on it. Its ruts have gone soft, its kerb stones are half swallowed by turf, and a ring of cold fire-stones shows where someone camped and moved on.',
    vegetation: { density: 0.3 },
    props: [
      { kind: 'standingStone', offset: [-5, 6], params: { height: 1.6, fallen: true } },
      { kind: 'standingStone', offset: [6, -10], params: { height: 1.9 } },
      { kind: 'stones', offset: [0, 0], params: { count: 6, size: 0.5 } },
      { kind: 'bigTree', offset: [14, 10], params: { scale: 1.0, palette: 'dead' } },
    ],
    lore: {
      region: 'outside-the-dike',
      summary:
        'The North Road, grass-grown since the lands north of Bree went empty, and called the Greenway by the Bree-folk for exactly that reason. It is the road strangers came up, and nothing good arrived by it in the last years of the Third Age.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'Among the folk who had lately come up the Greenway was a squint-eyed southerner the Bree-folk took against on sight. He was in the common room the night Frodo vanished, and he was gone from the village before morning.',
        },
      ],
      characters: ['the squint-eyed Southerner'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Greenway',
    },
  },
  {
    id: 'west-gate',
    displayName: 'The West Gate',
    type: 'other',
    mapIcon: 'gate',
    position: [174, 268],
    discoverRadius: 16,
    radius: 24,
    setting:
      'The Road lifts onto a causeway between two ends of a deep dry ditch and passes through a gap cut in a hedge taller than a man. A heavy timber gate stands open against its posts, and a lodge with one lit window sits just inside, with a lantern on a post beside the door.',
    ground: { kind: 'village', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.2 },
    props: [
      // on the hedge line itself, 5 m in from the middle of the causeway, so the hedge closes on its posts
      { kind: 'townGate', offset: [WEST_GATE.x - 174, WEST_GATE.z - 268], rotation: WEST_GATE.rot, params: { width: 5, height: 2.8, open: 0.85, boardColor: '#cbb98e' } },
      { kind: 'cottage', offset: [11, 9], rotation: -Math.PI / 2, params: { width: 5, length: 6.5, height: 3.4, wall: '#ded2b4', roof: '#6a5a44' } },
      { kind: 'lamp', offset: [7, 6], color: '#ffd9a0' },
      { kind: 'fence', offset: [12, -8], rotation: 0, params: { length: 12 } },
      // a cart left outside for the night, on the level causeway beside the road: inside the gate
      // the road climbs between banks and there is nowhere to stand one out of the way
      { kind: 'cart', offset: [-6, -7], rotation: 0.15, params: { load: 'barrels' } },
    ],
    lore: {
      region: 'outside-the-dike',
      summary:
        'The way into Bree from the Shire. The gate is shut at nightfall and the gatekeeper comes out with a lantern to look over whoever is standing on the far side of it, which is the first thing the four hobbits ever learned about the world outside their own country.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'The hobbits reached Bree after dark and found the gate shut. The keeper came out with a lantern and wanted to know what business four hobbits had on the road at that hour before he would let them through.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'As they went on up the street, someone climbed quickly over the gate behind them and slipped away into the dark. The watch on the gate, it turned out, worked in both directions.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Homeward Bound',
          text: 'Coming back a year later in the rain they found the gate barred and guarded, and had to be recognised before they were let in. Bree had fought ruffians in their absence and buried its dead.',
        },
      ],
      characters: ['Harry Goatleaf', 'Frodo Baggins', 'Aragorn'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree',
    },
  },
  {
    id: 'the-dike',
    displayName: 'The Dike and the Hedge',
    type: 'other',
    // no mapIcon: 'fortress' made the legend and screen readers call an earthwork and a hedge a fortress
    position: [198, 206],
    discoverRadius: 16,
    radius: 26,
    setting:
      'A deep dry ditch curves away north with the hedge standing along its inner lip, thick and far higher than a man. Inside it the ground is all small fields and garden plots, hayricks and gates, with the hill rising beyond them.',
    vegetation: { density: 0.5 },
    props: [
      { kind: 'gardenPlot', offset: [10, 12], rotation: 0.2, params: { width: 7, depth: 4 } },
      // the plot with the scarecrow and the ricks stand on the gentlest ground inside the hedge
      // (grade about 0.3); nearer the ditch the field falls away at 0.4 to 0.6
      { kind: 'gardenPlot', offset: [22, 4], rotation: -0.1, params: { width: 5, depth: 3.5, scarecrow: true } },
      { kind: 'haystack', offset: [16, -4], params: { radius: 1.8 } },
      { kind: 'haystack', offset: [20, -8], params: { radius: 1.4 } },
      { kind: 'fence', offset: [14, 32], rotation: 0.3, params: { length: 22, gap: 3 } },
    ],
    lore: {
      region: 'bree-fields',
      summary:
        'On the west side a deep dike runs in more than half a circle, out from the hill and back to it, with a thick hedge planted along its inner side. The hill closes the rest, so Bree only ever had to defend the side the roads came in on.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'The dike and hedge were old work, raised long before anyone living could remember, and the Bree-folk kept them up out of habit rather than fear. In the year of the Ring they turned out to be worth the trouble.',
        },
      ],
      characters: [],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree',
    },
  },
  {
    id: 'the-road',
    displayName: 'The Road under the Hill',
    type: 'other',
    mapIcon: 'village',
    position: [212, 278],
    discoverRadius: 16,
    radius: 30,
    setting:
      'The road climbs eastward between the houses of the Big Folk, built up above it on benches cut into the slope, every window turned west into the evening. They are stone-footed and tall and look very strange indeed to anyone who grew up in a hole.',
    ground: { kind: 'village', blend: 0.75, inner: 0.35 },
    vegetation: { density: 0.25 },
    props: [
      { kind: 'cottage', offset: [-8, -11], rotation: -Math.PI / 2 + 0.1, params: { width: 6.5, length: 8.5, height: 4.6, storeys: 2, wall: '#cfc8b4', roof: '#6a5340' } },
      { kind: 'cottage', offset: [6, -14], rotation: -Math.PI / 2 - 0.08, params: { width: 6.5, length: 8.5, height: 4.4, storeys: 2, wall: '#c4bda6', roof: '#584433' } },
      { kind: 'cottage', offset: [-14, 9], rotation: -Math.PI / 2 + 0.25, params: { width: 6, length: 8, height: 4.2, storeys: 2, wall: '#d6cdb6', roof: '#6a5340' } },
      { kind: 'cottage', offset: [4, 12], rotation: -Math.PI / 2 - 0.2, params: { width: 6.5, length: 8.5, height: 4.4, storeys: 2, wall: '#c9c0a8', roof: '#5e4a34' } },
      { kind: 'lamp', offset: [-2, 1], color: '#ffd9a0' },
      { kind: 'well', offset: [10, 2] },
      // along the front of the lower house's bench, off the street and parallel to the house
      { kind: 'fence', offset: [-15, 4], rotation: 0.26, params: { length: 9 } },
    ],
    lore: {
      region: 'bree-street',
      summary:
        'About a hundred houses of the Big Folk stand mostly above the Road, nestling on the hillside with their windows facing west. The Men of Bree are brown-haired, broad and short, cheerful, independent, and far more used to Hobbits, Dwarves and Elves than Big People usually are.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'A Knife in the Dark',
          text: 'Half the village turned out along this road to watch the strange company leave in the late morning, hanging out of windows and standing in doorways. News of their going was all over Bree by noon, and well beyond it by nightfall.',
        },
      ],
      characters: ['Barliman Butterbur', 'Bill Ferny', 'Mugwort'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree',
    },
  },
  {
    id: 'prancing-pony',
    displayName: 'The Prancing Pony',
    type: 'inn',
    position: [243, 292],
    discoverRadius: 18,
    radius: 30,
    setting:
      'A tall three-storey inn stands at the bend where the road turns south around the foot of the hill, with two wings running back into the slope behind it. A lamp burns over the archway between them, and under the lamp swings a board painted with a fat white pony rearing on its hind legs.',
    ground: { kind: 'village', blend: 0.8, inner: 0.4 },
    vegetation: { density: 0.15 },
    props: [
      { kind: 'cottage', offset: [0, -2], rotation: -Math.PI / 2, params: { width: 9, length: 12, height: 7.2, storeys: 3, inn: true, sign: '#efe7d3', wall: '#e0d6bc', roof: '#6a4a30' } },
      { kind: 'cottage', offset: [13, -10], rotation: 0, params: { width: 7, length: 11, height: 5.6, storeys: 2, wall: '#d8cdb2', roof: '#6a4a30' } },
      { kind: 'cottage', offset: [13, 9], rotation: 0, params: { width: 7, length: 11, height: 5.6, storeys: 2, wall: '#d8cdb2', roof: '#6a4a30' } },
      { kind: 'lamp', offset: [7, 0], color: '#ffce7a' },
      { kind: 'lamp', offset: [-6, 8], color: '#ffd9a0' },
      // at the fork where the lane to the hobbit doors leaves the road, beside the inn's corner
      { kind: 'signpost', offset: [-5.5, -9], rotation: 1.2, params: { boards: 1 } },
      { kind: 'bigTree', offset: [-12, -12], params: { scale: 1.1 } },
    ],
    lore: {
      region: 'bree-street',
      summary:
        'The inn at the bend of the Road, kept by Barliman Butterbur: three storeys, many windows, a wide arch into the courtyard, and a few rooms built low on purpose for hobbit guests. Everything that mattered in Bree happened under this roof in one night.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'The hobbits rode in under the arch and Butterbur came bustling out to take them in. Frodo gave his name as Underhill, which was the name he had agreed on and almost the last sensible thing he did that evening.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'In the common room Pippin began telling the whole room about Bilbo’s farewell party. Frodo climbed on a table to cut him off with a song, came off it badly, and vanished in front of everyone with the Ring on his finger.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Strider',
          text: 'A weather-stained traveller had been listening from the shadows all evening. In the little parlour afterwards he offered to guide them to Rivendell, and Butterbur finally produced the letter Gandalf had left months before and never found anyone to carry.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Homeward Bound',
          text: 'A year later Butterbur did not recognise the four hobbits who rode up to his door armed and grown. He poured out all his troubles to them without ever realising who he was talking to.',
        },
      ],
      characters: ['Barliman Butterbur', 'Frodo Baggins', 'Peregrin Took', 'Aragorn', 'Nob', 'Bob'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Prancing_Pony',
    },
  },
  {
    id: 'inn-yard',
    displayName: 'The Inn-yard and Stables',
    type: 'other',
    // no mapIcon: an inn pictogram here sat beside the Prancing Pony's own and read as a second inn
    position: [268, 296],
    discoverRadius: 14,
    radius: 22,
    setting:
      'Through the passage, a yard closed on three sides with straw trodden into the ground and a bank of cut earth at the back where the hillside was dug away. A stable range runs along one side, and a pony stands at the end of it with nothing much to do.',
    ground: { kind: 'village', blend: 0.8, inner: 0.45 },
    vegetation: { density: 0.05 },
    props: [
      { kind: 'cottage', offset: [4, 9], rotation: Math.PI / 2, params: { width: 6, length: 12, height: 3.4, chimney: false, wall: '#cfc3a4', roof: '#5e4a34' } },
      { kind: 'well', offset: [-2, 0] },
      { kind: 'pony', offset: [6, 4], rotation: 2.1, params: { coat: '#9b7246' } },
      { kind: 'pony', offset: [9, 1], rotation: 1.4, params: { coat: '#6e5742', mane: '#2e241c' } },
      { kind: 'cart', offset: [-8, 7], rotation: 1.9, params: { load: 'barrels' } },
      { kind: 'haystack', offset: [10, -6], params: { radius: 1.6 } },
      { kind: 'lamp', offset: [-6, -5], color: '#ffd9a0' },
    ],
    lore: {
      region: 'bree-street',
      summary:
        'The courtyard behind the inn, with stables off it and an ostler to mind the beasts. The stable doors can be opened from outside in the night, which is exactly what happened on the one night it mattered.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'A Knife in the Dark',
          text: 'Before dawn every horse and pony at the inn was let out and driven off into the empty country. The travellers woke to broken fastenings, an empty stable and no quick way to leave Bree.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Homeward Bound',
          text: 'Bill the pony, lost long before in the mountains, had found his own way back here and was waiting in the stable. It was close to the only good news in Bree that year.',
        },
      ],
      characters: ['Bill the pony', 'Samwise Gamgee', 'Bob'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Prancing_Pony',
    },
  },
  {
    id: 'hill-doors',
    displayName: 'The Hobbit Doors',
    type: 'home',
    position: [280, 246],
    discoverRadius: 16,
    radius: 28,
    setting:
      'Above the roofs of the Men the slope is cut into short benches, and round doors are set into the turf along them, broader and lower than the holes of the Shire and gone grey-green with weather rather than painted. Low fences, a few gardens, and every chimney smoking straight up.',
    vegetation: { density: 0.4, flowers: 'garden' },
    props: [
      // the gardens are on the bench above the doors, where the shoulder levels out (grade < 0.25);
      // the slope in front of the doors is too steep for a bed and carries the lanes
      { kind: 'gardenPlot', offset: [20, 14], rotation: 0.2, params: { width: 5, depth: 3.5 } },
      { kind: 'gardenPlot', offset: [18, -22], rotation: -0.3, params: { width: 4.5, depth: 3 } },
      { kind: 'fence', offset: [20, 18], rotation: 0.2, params: { length: 14, gap: 3 } },
      { kind: 'well', offset: [-10, -2] },
      { kind: 'lamp', offset: [-5, 2], color: '#ffd9a0' },
    ],
    lore: {
      region: 'bree-hill',
      summary:
        'The hill is burrowed with hobbit-holes, lived in especially on the higher slopes above the houses of the Men. The Bree-hobbits claim theirs is the oldest hobbit settlement anywhere, and they are right: Bree is older than the Shire.',
      storyEvents: [
        {
          book: 'The Lord of the Rings',
          chapter: 'Prologue: Concerning Hobbits',
          text: 'The Shire was founded by hobbits who set out from Bree — the brothers Marcho and Blanco, who crossed the Brandywine with the king’s leave and settled the country beyond it.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'Big Folk and Little Folk live side by side here and nowhere else in the world, each minding their own affairs in their own way, and both counting themselves Bree-folk.',
        },
      ],
      characters: ['Marcho', 'Blanco', 'Mugwort'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree-hobbits',
    },
  },
  {
    id: 'bree-hill',
    displayName: 'The Top of Bree-hill',
    type: 'hill',
    position: [345, 212],
    discoverRadius: 20,
    radius: 30,
    setting:
      'Short turf, one old wind-bent tree and a scatter of grey stones on the crown of the hill. Every roof in the town lies below you on the western flank; eastward the land runs away into the Chetwood and the empty country beyond it.',
    vegetation: { density: 0.15 },
    props: [
      { kind: 'bigTree', offset: [4, -6], params: { scale: 1.3, palette: 'old' } },
      // north-west of the crown, clear of the way down toward the hobbit doors
      { kind: 'stones', offset: [-6, -7], params: { count: 6, size: 1.2 } },
      { kind: 'standingStone', offset: [10, 8], params: { height: 2.6 } },
      { kind: 'stones', offset: [14, -10], params: { count: 4, size: 0.7 } },
    ],
    lore: {
      region: 'bree-hill',
      summary:
        'A single large hill standing alone out of low, empty country, with the town on its western flank and the hill itself serving as the town’s eastern wall. Coming along the Road at dusk it reads as one dark mass against the sky.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Fog on the Barrow-downs',
          text: 'They rode east into a falling night over ground that dipped and rose, watching the lights ahead appear and vanish and appear again. At last the hill itself stood up to block the way.',
        },
      ],
      characters: [],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree-hill',
    },
  },
  {
    id: 'staddle',
    displayName: 'Staddle',
    type: 'village',
    position: [398, 298],
    discoverRadius: 18,
    radius: 30,
    setting:
      'On the sheltered side of the hill, a handful of round doors with gardens and a well between them, and no ditch or hedge anywhere near. Most of Bree-land’s hobbits live over here, out of sight of the road and perfectly content about it.',
    ground: { kind: 'meadow', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.6, flowers: 'garden' },
    props: [
      { kind: 'gardenPlot', offset: [-2, -8], rotation: 0.2, params: { width: 6, depth: 4, scarecrow: true } },
      { kind: 'gardenPlot', offset: [10, 6], rotation: -0.2, params: { width: 5, depth: 3.5 } },
      { kind: 'well', offset: [2, 2] },
      { kind: 'haystack', offset: [-12, 8], params: { radius: 1.7 } },
      { kind: 'fence', offset: [6, 14], rotation: 0.2, params: { length: 18, gap: 3 } },
      { kind: 'cart', offset: [-13, 1], rotation: 2.4, params: { load: 'pumpkins' } },
      { kind: 'bigTree', offset: [16, -12], params: { scale: 1.1 } },
    ],
    lore: {
      region: 'staddle',
      summary:
        'The second of the four villages of the Bree-land, on the far side of the hill from Bree itself, and home to most of the Bree-hobbits. Combe lies in a deep valley further east and Archet at the edge of the Chetwood north of it.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'At the Sign of The Prancing Pony',
          text: 'Around Bree-hill and its four villages lies a small country of fields and tamed woodland only a few miles broad, and outside that narrow ring the land is empty. Bree-land is an island, and its people know it.',
        },
      ],
      characters: [],
      sourceUrl: 'https://tolkiengateway.net/wiki/Staddle',
    },
  },
  {
    id: 'ferny',
    displayName: 'The Last House',
    type: 'home',
    position: [258, 352],
    discoverRadius: 14,
    radius: 22,
    setting:
      'The last house before the south gate stands back from the road behind a crooked fence, grey and unpainted, its ridge sagging and a shutter hanging loose. A churned paddock beside it holds one bony pony that nobody would buy at a fair price.',
    ground: { kind: 'village', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.3 },
    props: [
      // the house stands back east of the street on its own platform (see flats), and the fence
      // Ferny leaned on runs along the street in front of it, with a gap for the path to the door
      { kind: 'cottage', offset: [8, -4], rotation: -Math.PI / 2 - 0.12, params: { width: 6, length: 8, height: 4, wall: '#a49a88', roof: '#4e4438', doorColor: '#55504a' } },
      { kind: 'fence', offset: [1.8, -2], rotation: -Math.PI / 2 + 0.124, params: { length: 14, gap: 3 } },
      { kind: 'fence', offset: [9, 7], rotation: -0.2, params: { length: 12 } },
      { kind: 'pony', offset: [6, 10], rotation: 0.6, params: { coat: '#8a7a62', mane: '#4a4238' } },
      // in the yard between the house and the paddock, on the house's level platform
      { kind: 'cart', offset: [10, 2.5], rotation: 2.9, params: { load: 'junk' } },
    ],
    lore: {
      region: 'bree-street',
      summary:
        'Bill Ferny’s house, the last one in the village and plainly the shabbiest. Ferny leaned over this fence to watch travellers go by, and sold the Company the only animal left in Bree at a shameful price.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'A Knife in the Dark',
          text: 'With every other beast in Bree driven off in the night, the only animal for sale was Ferny’s half-starved pony, and he charged three times what it was worth. Sam named it Bill and it turned out to be worth a great deal more.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'A Knife in the Dark',
          text: 'As they passed the fence on the way out Sam threw an apple that caught Ferny square on the nose, which Sam considered a waste of a good apple and nobody else did.',
        },
      ],
      characters: ['Bill Ferny', 'Samwise Gamgee', 'Bill the pony'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bill_Ferny',
    },
  },
  {
    id: 'south-gate',
    displayName: 'The South Gate',
    type: 'other',
    mapIcon: 'gate',
    position: [257, 386],
    discoverRadius: 16,
    radius: 24,
    setting:
      'The road runs out of the village here through a second gap in the hedge, over another causeway between two ends of the ditch, with a lodge and a lantern beside it. Beyond the gate the hedgerows begin and a field track turns off into the country.',
    ground: { kind: 'village', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.25 },
    props: [
      { kind: 'townGate', offset: [SOUTH_GATE.x - 257, SOUTH_GATE.z - 386], rotation: SOUTH_GATE.rot, params: { width: 5, height: 2.8, open: 0.6, boardColor: '#c4b48a' } },
      { kind: 'cottage', offset: [9, -10], rotation: -Math.PI / 2, params: { width: 5, length: 6, height: 3.4, wall: '#d6cdb6', roof: '#5e4a34' } },
      { kind: 'lamp', offset: [5, -5], color: '#ffd9a0' },
      { kind: 'signpost', offset: [7, -6], rotation: -0.4, params: { boards: 1 } },
      { kind: 'fence', offset: [10, 8], rotation: 0.1, params: { length: 14 } },
    ],
    lore: {
      region: 'bree-street',
      summary:
        'The southern gate, where the Road leaves Bree again. The Company went out this way on foot in the late morning with one bony pony and half the village watching, and once clear of the fields Strider took them off the Road entirely.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'A Knife in the Dark',
          text: 'They left late, on foot, with a crowd standing along the hedge to watch. A mile or two out Strider led them off the highway and north-east into the woods, cutting across country toward the far line of hills.',
        },
      ],
      characters: ['Aragorn', 'Frodo Baggins', 'Bill Ferny'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bree',
    },
  },
]

export const def: PlaceDef = {
  id: 'bree',
  name: 'Bree',
  parentWorldId: 'middle-earth',
  size: [W, H],
  cell: 2,
  seed: 4307,
  seaLevel: 0,
  palette: {
    sky: '#8cc0ea',
    horizon: '#e4ebf2',
    water: '#5aa0dc',
    waterDeep: '#3a78b8',
    sand: '#d4c296',
    grass: '#86b45c',
    grassDry: '#aab35c',
    grassLush: '#5d9a5a',
    meadow: '#a0c95e',
    forest: '#3e8248',
    forestDark: '#2d6442',
    rock: '#8d8478',
    rockWarm: '#a68b6a',
    snow: '#f4f4f8',
    ash: '#5b524f',
    marsh: '#6f8f5a',
    road: '#c3ad83',
  },
  base: { height: BASE, roll: 1.4, wavelength: 80 },
  // a low wooded rim: Bree-land is a few miles of tame country, and empty land beyond it
  rim: { width: 36, height: 14 },
  hills: [
    // Bree-hill itself, spilling off the east edge so it reads as going on toward Combe
    { x: 345, z: 215, r: 205, h: 50 },
    // the shoulder the village is built on
    { x: 250, z: 285, r: 90, h: 10 },
    // two low mounds on the western approach, so the lights appear, vanish and appear again
    { x: 140, z: 276, r: 34, h: 4.5 },
    { x: 72, z: 272, r: 30, h: 4 },
    // shoulders carrying the Chetwood, so the hill is not a cone
    { x: 330, z: 55, r: 95, h: 12 },
    { x: 355, z: 375, r: 90, h: 10 },
    ...HILL_DOORS.map((s) => s.hill),
    ...STADDLE_DOORS.map((s) => s.hill),
  ],
  // Every building is placed at the height of the ground under its ORIGIN and is then rigid, so
  // anything standing on a slope buries one end of itself. These are the cut platforms that stop
  // that: one per building, sized to its footprint, each levelled to the ground already there.
  flats: [
    // the inn, its two wings, the yard and the stable range, all on one cut platform
    { x: 257, z: 296, r: 40, h: 34.5, strength: 0.97 },
    // the gate causeways, so the road rises over the ditch instead of dipping into it
    { x: 174, z: 268, r: 16, h: 10.6, strength: 0.75 },
    { x: 257, z: 386, r: 16, h: 8.6, strength: 0.75 },
    // Staddle on the far shoulder, and the crossroads out on the open road
    { x: 398, z: 298, r: 24, h: 34.5, strength: 0.72 },
    { x: 112, z: 268, r: 24, h: 8.3, strength: 0.5 },
    // benches for the houses of the Big Folk, each its own step in the hillside
    { x: 204, z: 267, r: 12, h: 22.6, strength: 0.95 },
    { x: 218, z: 264, r: 12, h: 25.7, strength: 0.95 },
    { x: 198, z: 287, r: 12, h: 17.6, strength: 0.95 },
    { x: 216, z: 290, r: 12, h: 25.1, strength: 0.95 },
    { x: 222, z: 280, r: 5, h: 26.4, strength: 0.9 },
    // the gate lodges, the last house and the well above the roofs
    { x: 185, z: 277, r: 10, h: 12.4, strength: 0.95 },
    { x: 266, z: 376, r: 10, h: 10.5, strength: 0.95 },
    // the last house, set back east of the street so the street passes in front of it, not through it
    { x: 266, z: 348, r: 11, h: 15.3, strength: 0.95 },
    { x: 270, z: 244, r: 5, h: 46.3, strength: 0.9 },
    // doorsteps for the round doors: small enough that the knoll behind each one is untouched
    { x: 268, z: 248, r: 6.5, h: 45.7, strength: 0.9 },
    { x: 281, z: 256, r: 6.5, h: 48.2, strength: 0.9 },
    { x: 292, z: 237.5, r: 6.5, h: 50.3, strength: 0.9 },
    { x: 276, z: 232, r: 6.5, h: 47.7, strength: 0.9 },
    { x: 400, z: 282, r: 6.5, h: 37.4, strength: 0.9 },
  ],
  rivers: [
    // The dike: a dry ditch, not a stream. `valley` does the digging; the channel is disabled by
    // putting its bed above the ground (a negative depth), so no water is ever carved.
    { points: arc(DIKE.x, DIKE.z, DIKE.r, -65, -171, 15), width: 0.4, depth: -6, bank: 0, valley: { width: 15, depth: 3.2 } },
    { points: arc(DIKE.x, DIKE.z, DIKE.r, -189, -241, 9), width: 0.4, depth: -6, bank: 0, valley: { width: 15, depth: 3.2 } },
    { points: arc(DIKE.x, DIKE.z, DIKE.r, -259, -292, 6), width: 0.4, depth: -6, bank: 0, valley: { width: 15, depth: 3.2 } },
  ],
  ponds: [],
  lanes: [
    // the East Road: in from the west, through the gate, climbing to the bend in front of the inn.
    // The inn's front wall is at x 237; the bend stays a metre clear of it, so the road visibly turns
    // past the door rather than running into the building. It starts 4 m in from the map's west
    // edge, the nearest the traveller is let go (Heightfield.clampX), so the whole road can be walked.
    { points: [[4, 276], [56, 270], [112, 268], [174, 268], [204, 274], [226, 284], [234, 290]], width: 4 },
    // the street turning south around the foot of the hill, past the inn's front, out of the south gate
    { points: [[234, 290], [234.5, 300], [252, 320], [256, 350], [257, 386], [258, 428]], width: 4 },
    // the Greenway, broken where the turf has taken it
    { points: [[112, 268], [108, 230], [105, 198]], width: 2.6 },
    { points: [[100, 152], [96, 96], [92, 36]], width: 2.4 },
    // up to the hobbit doors, leaving the road at the bend and going round the north end of the
    // inn and its wing, then on past the doors and over the shoulder to Staddle. The lanes pass
    // between the lower doors and north of the middle one's knoll, never through a hole's garden.
    { points: [[232, 288.5], [235, 281], [246, 276], [262, 268], [276, 251]], width: 2.4 },
    { points: [[276, 251], [287, 249], [300, 251], [312, 258], [350, 276], [384, 292], [398, 298]], width: 2.6 },
  ],
  woods: [
    // the Chetwood on the hill's north and east side
    { x: 352, z: 52, r: 82 },
    { x: 432, z: 128, r: 66 },
    { x: 438, z: 340, r: 58 },
    // tame woodland in the corners of Bree-land
    { x: 60, z: 66, r: 42 },
    { x: 44, z: 392, r: 44 },
    { x: 182, z: 120, r: 28 },
  ],
  spawn: [88, 272],
  spawnYaw: -Math.PI / 2, // facing east, with the hill and the gate ahead
  cameraDistance: 11,
  speedScale: 0.75,
  fog: [140, 450],
  exit: { x: 258, z: 404, radius: 7, label: 'Out of Bree' },
  returnOffset: [6, 14],
  // Map lettering anchors (`label`, tried before the map's own picks): each name sits where it
  // reads as that part of the town. Left to itself the map wrote 'Outside the Dike' in the empty
  // north-west corner, far from any dike; here it is on the road in from the west, where the
  // traveller is outside it. ('Staddle' is not lettered while a place carries the same name.)
  regions: [
    { id: 'outside-the-dike', displayName: 'Outside the Dike', polygon: [[0, 0], [170, 0], [170, 440], [0, 440]], label: [110, 300] },
    { id: 'bree-fields', displayName: 'The Fields of Bree', polygon: [[170, 100], [290, 100], [290, 250], [170, 250]], label: [245, 185] },
    { id: 'bree-street', displayName: 'Bree', polygon: [[170, 250], [300, 250], [300, 440], [170, 440]], label: [240, 335] },
    { id: 'bree-hill', displayName: 'Bree-hill', polygon: [[260, 120], [460, 120], [460, 280], [260, 280]], label: [361, 190] },
    { id: 'staddle', displayName: 'Staddle', polygon: [[350, 260], [460, 260], [460, 360], [350, 360]], label: [420, 325] },
  ],
  spots,
  props: [
    ...HILL_DOORS.map((s) => s.prop),
    ...STADDLE_DOORS.map((s) => s.prop),
    // the hedge along the inner lip of the dike, broken only by the two gates
    ...hedgeArc(DIKE.x, DIKE.z, HEDGE_R, -65, WEST_GATE_DEG + GATE_HALF_DEG, 14),
    ...hedgeArc(DIKE.x, DIKE.z, HEDGE_R, WEST_GATE_DEG - GATE_HALF_DEG, SOUTH_GATE_DEG + GATE_HALF_DEG, 8),
    ...hedgeArc(DIKE.x, DIKE.z, HEDGE_R, SOUTH_GATE_DEG - GATE_HALF_DEG, -292, 5),
    // kerb stones of the old north road, half swallowed
    { kind: 'stones', at: [96, 236], params: { count: 4, size: 0.5 } },
    { kind: 'stones', at: [112, 212], params: { count: 3, size: 0.45 } },
    { kind: 'stones', at: [94, 124], params: { count: 4, size: 0.5 } },
    { kind: 'standingStone', at: [108, 190], params: { height: 1.4, fallen: true } },
    // fields and hedgerows inside the dike
    { kind: 'fence', at: [214, 170], rotation: 0.2, params: { length: 34 } },
    { kind: 'fence', at: [240, 200], rotation: 1.5, params: { length: 26 } },
    { kind: 'hedge', at: [196, 150], rotation: 0.3, params: { length: 30, height: 1.2 } },
    { kind: 'hedge', at: [230, 128], rotation: -0.2, params: { length: 24, height: 1.1 } },
    { kind: 'haystack', at: [222, 158] },
    { kind: 'haystack', at: [227, 152], params: { radius: 1.3 } },
    // on the one gentle step of the hill's flank inside the hedge; nearer the hedge it is 0.4-0.55
    { kind: 'gardenPlot', at: [282, 172], rotation: 0.1, params: { width: 8, depth: 5 } },
    // hedgerows out past the south gate, where the Company left the Road
    { kind: 'hedge', at: [232, 404], rotation: 0.1, params: { length: 28, height: 1.3 } },
    { kind: 'hedge', at: [286, 408], rotation: -0.15, params: { length: 26, height: 1.3 } },
    { kind: 'gateArch', at: [258, 404], rotation: 0, params: { width: 3.6, ring: 3 } },
    // trees with some age on them
    { kind: 'bigTree', at: [196, 300], params: { scale: 1.2 } },
    { kind: 'bigTree', at: [300, 320], params: { scale: 1.1, palette: 'old' } },
    { kind: 'bigTree', at: [324, 150], params: { scale: 1.3, palette: 'old' } },
    { kind: 'bigTree', at: [150, 330], params: { scale: 1.0 } },
  ],
}
