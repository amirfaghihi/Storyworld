/**
 * Hobbiton at walking scale: the Hill with Bag End at the top, Bagshot Row below it, the Party
 * Field, The Water with Sandyman's mill and the bridge, Bywater and its Pool to the east, and
 * the village of Hobbiton-across-the-Water to the south. Coordinates in metres, +x east, +z south.
 * Written from the descriptions in The Hobbit and The Lord of the Rings.
 */
import type { PlaceDef, Hill, Spot } from '../types'
import type { Prop } from '@/world/schema'

const W = 480
const H = 400
const BASE = 6

type P = Partial<Prop>
/** A smial (hobbit-hole) facing `rot` (0 = door faces south). Returns the knoll behind it and the prop. */
function smial(x: number, z: number, rot: number, doorColor: string, extra: Record<string, unknown> = {}): { hill: Hill; prop: P & { at: [number, number] } } {
  const k = 6.5 // knoll centre sits behind the door
  const hx = x - Math.sin(rot) * k
  const hz = z - Math.cos(rot) * k
  return {
    hill: { x: hx, z: hz, r: 10.5, h: 4.2 },
    prop: { kind: 'smial', at: [x, z], rotation: rot, params: { doorColor, ...extra } },
  }
}

const BAGSHOT = [smial(203, 186, 0.15, '#c9542f', { wall: '#d8b98a' }), smial(221, 190, 0.05, '#d9a83a', { wall: '#c9a978' }), smial(239, 193, -0.1, '#3f6fb5', { wall: '#e0c9a0' })]
const ACROSS = [smial(168, 322, Math.PI - 0.2, '#7a3f8f'), smial(203, 334, Math.PI + 0.1, '#2f7a45', { wall: '#e0c9a0' }), smial(318, 326, Math.PI - 0.3, '#c9542f'), smial(352, 316, Math.PI - 0.6, '#d9a83a', { wall: '#d8b98a' })]

const spots: Spot[] = [
  {
    id: 'bag-end',
    displayName: 'Bag End',
    type: 'home',
    position: [240, 150],
    discoverRadius: 16,
    radius: 22,
    setting:
      'The finest hole in Hobbiton, dug into the top of the Hill with a perfectly round green door and a brass knob in the exact middle. Round windows look south over the garden, the Party Field and the Water, and the best rooms are all on the left going in.',
    vegetation: { density: 0.25, flowers: 'garden' },
    props: [
      { kind: 'smial', offset: [0, 0], rotation: 0, params: { doorColor: '#2f7a45', width: 7, wall: '#d8b98a', path: 7, turf: '#86c25a' } },
      // the vegetable beds are below the hedge, where the Hill levels out toward the field (grade
      // about 0.1); between the door and the hedge it falls at 0.5-0.6, too steep for a bed
      { kind: 'gardenPlot', offset: [6, 23], rotation: 0.1, params: { width: 6, depth: 4, scarecrow: true } },
      { kind: 'gardenPlot', offset: [-6, 22], rotation: -0.1, params: { width: 5, depth: 3.5 } },
      { kind: 'hedge', offset: [0, 12.5], rotation: 0, params: { length: 22, height: 1.1, gap: 3 } },
      { kind: 'lamp', offset: [2.4, 11], color: '#ffe0a0' },
      // The tree builder moves a tree off ground too steep for its root (findLevel); authored on the
      // Hill's flank at [12, -4] it was moved to (258.6, 156), onto the lane over the Hill. Here it
      // stands where it is put, at the foot of the knoll east of the lane.
      { kind: 'bigTree', offset: [25, 8], params: { scale: 1.1 } },
    ],
    lore: {
      region: 'the-hill',
      summary:
        'Bilbo Baggins’ home, built by his father Bungo for Belladonna Took. Gandalf scratched a sign on this door before an unexpected party, Bilbo left the Ring here for Frodo, and Sam Gamgee lived here with Rosie after the story ends.',
      storyEvents: [
        { book: 'The Hobbit', chapter: 'An Unexpected Party', text: 'Thirteen dwarves and a wizard arrive for tea, eat Bilbo out of house and home, and hire him as their burglar.' },
        { book: 'The Fellowship of the Ring', chapter: 'A Long-expected Party', text: 'After his birthday speech Bilbo slips the Ring into an envelope on the mantelpiece and walks out of the Shire for good, leaving Bag End to Frodo.' },
        { book: 'The Fellowship of the Ring', chapter: 'The Shadow of the Past', text: 'By the study fire Gandalf tells Frodo the true history of the Ring and throws it into the flames to reveal the fiery letters.' },
        { book: 'The Return of the King', chapter: 'The Grey Havens', text: 'After the Scouring, Frodo returns here to write the Red Book; when he sails west, Sam comes home to Rosie and Elanor: “Well, I’m back.”' },
      ],
      characters: ['Bilbo Baggins', 'Frodo Baggins', 'Gandalf', 'Samwise Gamgee', 'Lobelia Sackville-Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bag_End',
    },
  },
  {
    id: 'bagshot-row',
    displayName: 'Bagshot Row',
    type: 'home',
    position: [221, 194],
    discoverRadius: 16,
    radius: 30,
    setting:
      'A row of smaller hobbit-holes cut into the lower slope of the Hill along the lane, each with its own bright door, vegetable patch and washing line. Number 3 belongs to the Gamgees; the Gaffer’s potatoes are famous.',
    vegetation: { density: 0.2, flowers: 'garden' },
    props: [
      { kind: 'gardenPlot', offset: [-14, 8], rotation: 0.1, params: { width: 5, depth: 3 } },
      { kind: 'gardenPlot', offset: [4, 9], rotation: -0.05, params: { width: 5, depth: 3, scarecrow: true } },
      // pulled off the lane onto the verge below it
      { kind: 'cart', offset: [26, 10], rotation: 0.6, params: { load: 'barrels' } },
    ],
    lore: {
      region: 'the-hill',
      summary:
        'Home of Hamfast “the Gaffer” Gamgee and his son Sam, who tended Bag End’s garden. In Lotho’s time the Row was dug up for a gravel pit; after the Scouring it was rebuilt as New Row, which the Gaffer called Sharkey’s End.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'A Long-expected Party', text: 'At the Ivy Bush the Gaffer defends Mr. Bilbo against the gossips and reminds everyone who taught Sam his letters.' },
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'The hobbits return to find Bagshot Row a quarry and the Gaffer moved to an ugly new house; Sam vows to put things right.' },
      ],
      characters: ['Hamfast Gamgee', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bagshot_Row',
    },
  },
  {
    id: 'party-tree',
    displayName: 'The Party Field',
    type: 'tree',
    position: [270, 226],
    discoverRadius: 24,
    radius: 42,
    setting:
      'A wide flat meadow between the Hill and the Water, with one great tree in the middle where the pavilion goes up for parties. Trestle tables, lanterns in the boughs, and grass cropped short by ponies.',
    ground: { kind: 'meadow', blend: 0.45, inner: 0.35 },
    vegetation: { density: 0.15 },
    props: [
      { kind: 'partyTree', offset: [0, 0], params: { lanterns: 16 } },
      { kind: 'pavilion', offset: [-19, -4], params: { radius: 9 } },
      { kind: 'tables', offset: [-19, -4], rotation: 0.2, params: { rows: 3, length: 7 } },
      // south of the Bywater road where it leaves the field, not across it
      { kind: 'tables', offset: [6, 19], rotation: -0.4, params: { rows: 2, length: 8 } },
      { kind: 'cart', offset: [-8, 16], rotation: 1.2, params: { load: 'barrels' } },
      { kind: 'lamp', offset: [-30, 8], color: '#ffe0a0' },
      { kind: 'lamp', offset: [16, -12], color: '#ffe0a0' },
    ],
    lore: {
      region: 'party-field',
      summary:
        'Where Bilbo held his eleventy-first birthday party, with a pavilion built around the Party Tree, fireworks by Gandalf and a speech that ended with the host vanishing. The tree was later cut down by Sharkey’s men, and Sam planted Galadriel’s mallorn seed in its place.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'A Long-expected Party', text: 'Gandalf’s dragon firework roars over the field, 144 guests sit down to dinner, and Bilbo tells them he does not know half of them half as well as he should like.' },
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'The Party Tree lies felled in the field; Sam weeps to see it.' },
        { book: 'The Return of the King', chapter: 'The Grey Havens', text: 'Sam plants the silver nut from Galadriel’s box here; by spring a mallorn tree with golden flowers grows, the only one west of the Mountains and east of the Sea.' },
      ],
      characters: ['Bilbo Baggins', 'Gandalf', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Party_Tree',
    },
  },
  {
    id: 'the-mill',
    displayName: 'Sandyman’s Mill',
    type: 'mill',
    position: [271, 291],
    discoverRadius: 16,
    radius: 22,
    setting:
      'The old mill stands on the south bank of the Water just below the bridge, its wooden wheel turning slowly in the stream. Flour dust, the smell of the river and the clatter of the wheel.',
    vegetation: { density: 0.3 },
    props: [
      { kind: 'waterMill', offset: [0, 0], rotation: Math.PI / 2 },
      { kind: 'cart', offset: [9, 6], rotation: -0.4, params: { load: 'barrels' } },
      { kind: 'haystack', offset: [-8, 15] },
      { kind: 'fence', offset: [3, 13], rotation: 0.1, params: { length: 14, gap: 3 } },
    ],
    lore: {
      region: 'across-the-water',
      summary:
        'Sandyman’s mill on the Water. Under Lotho it was torn down and replaced with a great brick mill full of wheels and foreign contraptions that fouled the stream, exactly as Sam had seen in the Mirror of Galadriel. It was pulled down again after the Scouring.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'The Mirror of Galadriel', text: 'In the Mirror Sam sees the old mill gone and a tall red brick building in its place, with hobbits hard at work.' },
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'Ted Sandyman sneers from the new mill’s doorway as the travellers return; Sam tells him the mill will not stand much longer.' },
      ],
      characters: ['Ted Sandyman', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Old_Mill',
    },
  },
  {
    id: 'the-water',
    displayName: 'The Bridge over the Water',
    type: 'water',
    position: [250, 276],
    discoverRadius: 14,
    radius: 26,
    setting:
      'A hump-backed stone bridge carries the lane from Hobbiton over the Water. Willows lean over the banks, ducks paddle in the shallows and the mill wheel turns just downstream.',
    vegetation: { density: 0.6, palette: 'willow' },
    props: [
      { kind: 'bridge', offset: [0, 0], rotation: Math.PI / 2, params: { length: 32, arc: 0.07 }, color: '#a39d90' },
      { kind: 'boat', offset: [-14, 2], rotation: 0.3 },
      { kind: 'lamp', offset: [-3, -16], color: '#ffe0a0' },
    ],
    lore: {
      region: 'across-the-water',
      summary:
        'The Water is the small river that runs east through Hobbiton and Bywater to the Brandywine. Frodo, Sam and Pippin crossed it here on the evening they left Bag End, and it is the river Sam saw fouled by Sharkey’s new mill.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'Three is Company', text: 'Frodo takes a last look at the lights of Hobbiton twinkling below the Hill, then sets off with Sam and Pippin along the road by the Water.' },
      ],
      characters: ['Frodo Baggins', 'Samwise Gamgee', 'Peregrin Took'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Water',
    },
  },
  {
    id: 'green-dragon',
    displayName: 'The Green Dragon',
    type: 'inn',
    position: [400, 212],
    discoverRadius: 16,
    radius: 24,
    setting:
      'The inn at Bywater, on the road above the Pool: a long low timbered house with a sign of a green dragon, lanterns by the door, a smell of beer and roasting, and a taproom full of talk.',
    vegetation: { density: 0.2 },
    props: [
      { kind: 'cottage', offset: [0, 0], rotation: 0.64, params: { width: 8, length: 13, height: 3.6, inn: true, sign: '#3f8a46', wall: '#e6dcc4', roof: '#7a5230' } },
      { kind: 'fence', offset: [8, 9], rotation: 0.64, params: { length: 12, gap: 2.6 } },
      { kind: 'cart', offset: [-8, 6], rotation: 2.2, params: { load: 'barrels' } },
      { kind: 'well', offset: [10, -4] },
      { kind: 'bigTree', offset: [-12, -8], params: { scale: 1.2 } },
    ],
    lore: {
      region: 'bywater',
      summary:
        'The Green Dragon at Bywater, where Sam Gamgee and Ted Sandyman argued about walking trees and Elves sailing west. The Battle of Bywater, the last battle fought in the Shire, was won on the road nearby.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'The Shadow of the Past', text: 'Over a pint Sam insists his cousin Hal saw a tree-man walking up beyond the North Moors, and Ted Sandyman laughs at him.' },
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'Merry and Pippin lead the hobbits of Bywater against Sharkey’s ruffians; nearly seventy Men fall and nineteen hobbits, whose names are remembered on a Roll.' },
      ],
      characters: ['Samwise Gamgee', 'Ted Sandyman', 'Meriadoc Brandybuck', 'Peregrin Took'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Green_Dragon',
    },
  },
  {
    id: 'bywater-pool',
    displayName: 'Bywater Pool',
    type: 'water',
    position: [428, 250],
    discoverRadius: 22,
    radius: 40,
    setting:
      'The Water widens here into a broad, reedy pool where the village of Bywater keeps its boats. Mallards, dragonflies and the reflections of the houses along the north bank.',
    vegetation: { density: 0.5, flowers: 'reeds' },
    props: [
      { kind: 'boat', offset: [-10, -4], rotation: 0.9 },
      { kind: 'boat', offset: [8, 8], rotation: -1.4, color: '#5a7a3a' },
      // The jetty runs straight out from the north-west shore with its landward end at the
      // waterline. Every slab then stands over water, so the whole deck is level at 1.0 m, and the
      // bank where it starts is only 0.2 m lower than the deck. Laid along the bank, as it was, its
      // slabs followed the bank down in 1.2 m steps, too tall to climb.
      { kind: 'quay', offset: [-18, -16.35], rotation: -0.74, params: { length: 10, width: 3 }, color: '#8a6a4a' },
    ],
    lore: {
      region: 'bywater',
      summary:
        'The Pool of Bywater, fed by the Water, with the village of Bywater along its north shore and the Bywater Road running east to the Great Road. It is the local hobbits’ idea of a large body of water.',
      storyEvents: [
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'The travellers come home along the Bywater Road and find the trees felled along the Pool’s banks and a row of ugly new houses where the road runs by the water.' },
      ],
      characters: [],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bywater',
    },
  },
  {
    id: 'across-the-water',
    displayName: 'Hobbiton-across-the-Water',
    type: 'village',
    position: [240, 318],
    discoverRadius: 22,
    radius: 44,
    setting:
      'The village proper, on the south side of the river: a scatter of hobbit-holes in low banks and a few cottages for the taller folk, gardens, a well on the green, hay carts and a lane winding off toward the Great East Road.',
    vegetation: { density: 0.3, flowers: 'garden' },
    props: [
      { kind: 'cottage', offset: [0, -4], rotation: 0.15, params: { width: 6, length: 8, wall: '#efe4cd', roof: '#8a5a3a' } },
      { kind: 'cottage', offset: [36, 6], rotation: -0.5, params: { width: 5.5, length: 7, wall: '#d8c8a8', roof: '#6a4a30' } },
      { kind: 'well', offset: [12, 6] },
      { kind: 'cart', offset: [-12, 2], rotation: 0.4, params: { load: 'pumpkins' } },
      { kind: 'haystack', offset: [48, 14] },
      { kind: 'haystack', offset: [52, 9], params: { radius: 1.2 } },
      { kind: 'gardenPlot', offset: [-24, 10], rotation: 0.2, params: { width: 7, depth: 4, scarecrow: true } },
      { kind: 'gardenPlot', offset: [24, -2], rotation: -0.1, params: { width: 5, depth: 3.5 } },
      { kind: 'fence', offset: [-2, 10], rotation: 0.05, params: { length: 20, gap: 3 } },
      { kind: 'lamp', offset: [8, -10], color: '#ffe0a0' },
    ],
    lore: {
      region: 'across-the-water',
      summary:
        'The houses of Hobbiton lie mostly on the south side of the Water, facing the Hill. In Lotho’s day rows of tarred sheds and a Shirriff-house went up here; after the Scouring the hobbits pulled them down and used the bricks to mend old holes.',
      storyEvents: [
        { book: 'The Return of the King', chapter: 'The Scouring of the Shire', text: 'Coming over the bridge, Frodo and his friends find Hobbiton half-ruined: the chestnuts gone, the banks broken, and hobbits too frightened to look out of their doors.' },
        { book: 'The Return of the King', chapter: 'The Grey Havens', text: 'The Shire is set to rights in a single year; 1420 is remembered for its sunshine, its harvest and its beer.' },
      ],
      characters: ['Lotho Sackville-Baggins', 'Frodo Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Hobbiton',
    },
  },
  {
    id: 'the-hill',
    displayName: 'The Hill',
    type: 'hill',
    position: [240, 96],
    discoverRadius: 20,
    radius: 30,
    setting:
      'The top of the Hill above Bag End: short turf, a wide sky, and the whole of Hobbiton laid out below, with the Water shining beyond the Party Field and the road running away east toward Bywater.',
    vegetation: { density: 0.35 },
    props: [
      // beside the lane over the top, not on it
      { kind: 'bigTree', offset: [5, -3], params: { scale: 1.4 } },
      { kind: 'stones', offset: [10, 6], params: { count: 4, size: 0.8 } },
    ],
    lore: {
      region: 'the-hill',
      summary:
        'The Hill gives Hobbiton its shape: Bag End at the top, Bagshot Row along its foot, and Overhill on the far side. From up here Bilbo used to watch the road and think about mountains.',
      storyEvents: [
        { book: 'The Fellowship of the Ring', chapter: 'A Long-expected Party', text: 'Bilbo tells Gandalf he wants to see mountains again, and find somewhere quiet to finish his book.' },
      ],
      characters: ['Bilbo Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Hill',
    },
  },
]

export const def: PlaceDef = {
  id: 'hobbiton',
  name: 'Hobbiton',
  parentWorldId: 'middle-earth',
  size: [W, H],
  cell: 2,
  seed: 4201,
  seaLevel: 0,
  palette: {
    sky: '#8cc6f0',
    horizon: '#e6eef4',
    water: '#5aa0dc',
    waterDeep: '#3a78b8',
    sand: '#d9c79a',
    grass: '#7fbc5a',
    grassDry: '#a8b85a',
    grassLush: '#4f9a5c',
    meadow: '#9ed35e',
    forest: '#3f8a46',
    forestDark: '#2f6a44',
    rock: '#8d8478',
    rockWarm: '#a68b6a',
    snow: '#f4f4f8',
    ash: '#5b524f',
    marsh: '#6f8f5a',
    road: '#c9b48a',
  },
  base: { height: BASE, roll: 1.6, wavelength: 70 },
  rim: { width: 42, height: 20 },
  hills: [
    // the Hill and its shoulders
    { x: 240, z: 92, r: 88, h: 26 },
    { x: 195, z: 70, r: 52, h: 7 },
    { x: 300, z: 80, r: 48, h: 6 },
    { x: 240, z: 140, r: 30, h: 5 },
    // gentle country
    { x: 90, z: 150, r: 60, h: 6 },
    { x: 130, z: 240, r: 45, h: 4 },
    { x: 380, z: 120, r: 55, h: 6 },
    { x: 110, z: 340, r: 40, h: 5 },
    { x: 400, z: 330, r: 45, h: 6 },
    ...BAGSHOT.map((s) => s.hill),
    ...ACROSS.map((s) => s.hill),
  ],
  flats: [
    { x: 268, z: 226, r: 44, h: BASE + 0.6 },
    { x: 400, z: 212, r: 16, h: BASE + 1.0 },
    { x: 240, z: 318, r: 14 },
    // Sandyman's mill. Authored at 2.3 when the river valley was dug after the flats and
    // lowered it to ~0.45; flats are now levelled after the valley, so the floor is given directly
    // (at 2.3 the wheel stood in a dry bank 1.75 m above the race).
    { x: 272, z: 287, r: 10, h: 0.45 },
  ],
  rivers: [
    {
      points: [
        [0, 306],
        [60, 296],
        [120, 288],
        [180, 281],
        [250, 276],
        [320, 273],
        [380, 266],
        [420, 258],
        [480, 244],
      ],
      width: 13,
      depth: 1.8,
      bank: 10,
      valley: { width: 42, depth: 2.6 },
    },
  ],
  ponds: [{ x: 428, z: 250, r: 32, depth: 2.4 }],
  lanes: [
    // the lane from the bridge up to Bag End, ending at the gap in the garden hedge
    { points: [[250, 262], [246, 240], [238, 212], [232, 200], [250, 199], [262, 178], [256, 167], [241, 165.5]], width: 3.2 },
    // Bagshot Row front
    { points: [[196, 199], [232, 200]], width: 2.6 },
    // Bywater road: from the party field east to the inn and the pool
    { points: [[262, 236], [300, 238], [340, 233], [380, 226], [396, 221]], width: 3.4 },
    // south of the river: village lane and the road out of Hobbiton
    { points: [[250, 290], [250, 302], [200, 308], [160, 312]], width: 3 },
    { points: [[250, 302], [300, 300], [340, 306]], width: 3 },
    { points: [[250, 302], [250, 358]], width: 3.4 },
    // up over the Hill toward Overhill: it leaves the Bag End lane below the garden hedge and climbs
    // round the east side of the hole and its knoll (and east of the big tree), not through them
    { points: [[256, 167], [259, 150], [249, 134], [240, 118], [240, 96], [232, 60]], width: 2.2 },
  ],
  woods: [
    { x: 240, z: 10, r: 60 },
    { x: 60, z: 70, r: 50 },
    { x: 430, z: 70, r: 42 },
    { x: 50, z: 250, r: 34 },
    { x: 130, z: 190, r: 22 },
    { x: 340, z: 150, r: 24 },
  ],
  spawn: [250, 344],
  spawnYaw: 0,
  cameraDistance: 10,
  speedScale: 0.75,
  fog: [130, 430],
  exit: { x: 250, z: 353, radius: 6, label: 'Back to the Shire' },
  returnOffset: [0, 14],
  // Map lettering anchors (`label`, tried before the map's own picks), in open country clear of the
  // markers: Bywater over the village on the north shore of the Pool. The other three repeat a
  // place's name, so the map leaves them unlettered for now; their anchors are there for when it does not.
  regions: [
    { id: 'the-hill', displayName: 'The Hill', polygon: [[120, 0], [360, 0], [360, 205], [120, 205]], label: [300, 60] },
    { id: 'party-field', displayName: 'The Party Field', polygon: [[228, 190], [312, 190], [312, 262], [228, 262]], label: [292, 214] },
    { id: 'bywater', displayName: 'Bywater', polygon: [[350, 150], [480, 150], [480, 300], [350, 300]], label: [430, 200] },
    { id: 'across-the-water', displayName: 'Hobbiton-across-the-Water', polygon: [[120, 262], [350, 262], [350, 400], [120, 400]], label: [200, 368] },
  ],
  spots,
  props: [
    ...BAGSHOT.map((s) => s.prop),
    ...ACROSS.map((s) => s.prop),
    // hedgerows along the lane: this one follows the lane up from the bridge on its west side
    // (rotation -1.29 lies along the lane; 3.5 m out from its middle leaves the whole lane clear)
    { kind: 'hedge', at: [239.2, 229], rotation: -1.29, params: { length: 24, height: 1.1 } },
    { kind: 'hedge', at: [300, 244], rotation: -0.05, params: { length: 30, height: 1.0 } },
    { kind: 'fence', at: [216, 262], rotation: 0.1, params: { length: 40 } },
    // the gate out of Hobbiton
    { kind: 'gateArch', at: [250, 353], rotation: 0, params: { width: 3.6, ring: 3 } },
    { kind: 'signpost', at: [247, 336], rotation: 0.3, params: { boards: 2 } },
    { kind: 'lamp', at: [253, 330], color: '#ffe0a0' },
    { kind: 'fence', at: [238, 350], rotation: 0, params: { length: 18 } },
    { kind: 'fence', at: [262, 350], rotation: 0, params: { length: 18 } },
    // trees with character
    { kind: 'bigTree', at: [180, 262], params: { scale: 1.2, palette: 'willow' } },
    { kind: 'bigTree', at: [330, 262], params: { scale: 1.0, palette: 'willow' } },
    { kind: 'bigTree', at: [160, 200], params: { scale: 1.3 } },
    { kind: 'bigTree', at: [310, 200], params: { scale: 1.1 } },
    // up on the level meadow above the south bank; the bank itself falls at 0.7 into the water
    { kind: 'haystack', at: [136, 308] },
    { kind: 'haystack', at: [142, 304], params: { radius: 1.3 } },
  ],
}
