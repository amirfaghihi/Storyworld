// Landmark dressings for Middle-earth: how the land should look around each place, from the books.
// `setting` is written in our own words from the descriptions in The Hobbit and The Lord of the Rings.
// Offsets are metres from the landmark: +x east, +z south. Props snap to the terrain at runtime.
import type { Dressing } from '../build-world.ts'

const WHITE = '#efe9dc'
const STONE = '#8f8d86'
const DARK_STONE = '#4a4a50'
const BLACK = '#1e1c22'
const IRON = '#2a2a2e'
const GOLD = '#d9a83a'
const WOOD = '#7a5230'
const DARK_WOOD = '#4a3626'
const HEDGE = '#4c8a3f'
const RUIN = '#a39d90'

export const dressings: Record<string, Dressing> = {
  'grey-havens': {
    radius: 70,
    aura: 'seasilver',
    setting:
      'Mithlond lies on the Gulf of Lune where the river meets the sea: grey quays, slender towers and white swan-ships waiting at anchor. The Elves depart from here into the West, so the place is quiet, salt-aired and a little sad.',
    ground: { kind: 'stone', blend: 0.85, inner: 0.35 },
    vegetation: { density: 0.15 },
    props: [
      { kind: 'quay', offset: [-14, 0], rotation: 0, params: { length: 36, width: 5 } },
      { kind: 'quay', offset: [-14, -18], rotation: 0.5, params: { length: 22, width: 4 } },
      { kind: 'ship', offset: [-30, 6], rotation: 0.3, color: WHITE, params: { length: 14 } },
      { kind: 'ship', offset: [-38, -14], rotation: -0.4, color: WHITE, params: { length: 12 } },
      { kind: 'tower', offset: [6, -10], color: '#d8d6cf', params: { height: 26, radius: 2.2, roof: 'cone', roofColor: '#7a8fa8' } },
      { kind: 'tower', offset: [10, 12], color: '#d8d6cf', params: { height: 18, radius: 1.8, roof: 'cone', roofColor: '#7a8fa8' } },
      { kind: 'hall', offset: [18, 0], rotation: 0.2, color: '#c9c6bd', params: { width: 9, length: 16, height: 5, roofColor: '#6b7f96' } },
      { kind: 'lamp', offset: [-6, -6] },
      { kind: 'lamp', offset: [-6, 8] },
    ],
  },
  hobbiton: {
    radius: 60,
    setting:
      'A hobbit village on the Water: round doors set into green hillsides, hedges, gardens, a mill by the stream and the great Party Tree in the field below Bag End. Neat, comfortable and thoroughly lived in.',
    ground: { kind: 'meadow', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.9, flowers: 'garden' },
    props: [
      { kind: 'hobbitHole', offset: [4, -12], rotation: 2.9, color: '#2f7a45', params: { doorColor: '#2f7a45' } },
      { kind: 'hobbitHole', offset: [-10, -6], rotation: 2.4, params: { doorColor: '#c9542f' } },
      { kind: 'hobbitHole', offset: [14, -4], rotation: 3.5, params: { doorColor: '#d9a83a' } },
      { kind: 'hobbitHole', offset: [-18, 6], rotation: 1.6, params: { doorColor: '#3f6fb5' } },
      { kind: 'hobbitHole', offset: [22, 8], rotation: 4.2, params: { doorColor: '#7a3f8f' } },
      { kind: 'bigTree', offset: [-10, 26], params: { scale: 2.6 } },
      { kind: 'hedge', offset: [0, -2], rotation: 0, params: { length: 30, height: 1.1 } },
      { kind: 'hedge', offset: [-12, 14], rotation: 1.2, params: { length: 14, height: 1 } },
      { kind: 'mill', offset: [14, 30], rotation: 0.4 },
      { kind: 'fence', offset: [12, 16], rotation: 0.4, params: { length: 18 } },
    ],
  },
  'old-forest': {
    radius: 50,
    aura: 'deepwood',
    weather: 'misty',
    setting:
      'Old, tangled and hostile trees that crowd the paths and lean over travellers. The air is close and the wood seems to listen. Old Man Willow sits in the Withywindle valley.',
    vegetation: { density: 1.6, palette: 'willow' },
    ground: { kind: 'darkForest', blend: 0.7, inner: 0.4 },
    props: [{ kind: 'bigTree', offset: [6, 4], params: { scale: 2.2, palette: 'willow' } }],
  },
  'barrow-downs': {
    radius: 55,
    aura: 'barrow',
    weather: 'misty',
    setting:
      'Bare green downs rolling under a wide sky, crowned with rings of standing stones and the grass-covered mounds of ancient kings. Fog gathers here suddenly; the barrows are not safe after dark.',
    ground: { kind: 'downs', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.05 },
    props: [
      { kind: 'stoneRing', offset: [0, 0], params: { radius: 9, count: 9, height: 3.2 } },
      { kind: 'barrow', offset: [-20, 10], params: { radius: 7 } },
      { kind: 'barrow', offset: [18, -14], params: { radius: 6 } },
      { kind: 'barrow', offset: [22, 16], params: { radius: 5 } },
      { kind: 'standingStone', offset: [-14, -18], params: { height: 4.5 } },
    ],
  },
  bree: {
    radius: 55,
    setting:
      'A village of Men and hobbits under Bree-hill, ringed by a deep dyke and a thick hedge with gates on the Road. Timber houses with stone footings, and The Prancing Pony inn at the crossroads.',
    ground: { kind: 'village', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.4 },
    props: [
      { kind: 'hedge', offset: [0, 0], params: { ring: true, radius: 26, height: 2.2, gap: 0.5 } },
      { kind: 'hall', offset: [0, -4], rotation: 0.1, color: '#c8b28a', params: { width: 10, length: 14, height: 6, roofColor: DARK_WOOD, sign: true } },
      { kind: 'hall', offset: [-13, 6], rotation: 0.8, color: '#bda88a', params: { width: 6, length: 9, height: 4, roofColor: '#5a4030' } },
      { kind: 'hall', offset: [12, 8], rotation: -0.5, color: '#d0bd9a', params: { width: 6, length: 8, height: 4, roofColor: '#5a4030' } },
      { kind: 'hall', offset: [4, 14], rotation: 0.3, color: '#bda88a', params: { width: 5, length: 7, height: 3.5, roofColor: '#5a4030' } },
      { kind: 'lamp', offset: [-4, -10] },
    ],
  },
  weathertop: {
    radius: 45,
    setting:
      'A bald, wind-scoured hilltop with a ring of tumbled stones, all that is left of the watchtower Amon Sûl. From here the whole land lies open to view, which is why the Black Riders watched it too.',
    ground: { kind: 'downs', blend: 0.7, inner: 0.2 },
    vegetation: { density: 0.05 },
    props: [
      { kind: 'ruins', offset: [0, 0], params: { radius: 8, count: 10, height: 2.5, ring: true } },
      { kind: 'standingStone', offset: [3, -2], params: { height: 3, fallen: true } },
    ],
  },
  trollshaws: {
    radius: 45,
    setting:
      'Wooded hills of oak and beech with old ruined towers of the Men of Rhudaur hidden among them. In a clearing stand three trolls turned to stone by the sunrise, one still bending to reach a bird on its shoulder.',
    vegetation: { density: 1.2 },
    props: [
      { kind: 'troll', offset: [0, 0], rotation: 0.3 },
      { kind: 'troll', offset: [5, 3], rotation: -1.2 },
      { kind: 'troll', offset: [-4, 5], rotation: 2.4, params: { bent: true } },
      { kind: 'ruins', offset: [24, -18], params: { radius: 4, count: 4, height: 5 } },
    ],
  },
  rivendell: {
    radius: 55,
    // the Enter arch on the level grass between the halls and the river (the default spot is on
    // the foot of the mountains, its legs 5 m apart in height)
    portal: [-6, 10],
    aura: 'silver',
    weather: 'fair',
    setting:
      'The Last Homely House stands in a deep, hidden valley cut by the loud Bruinen: a steep zigzag path down from the moor, pine-scented air, the sound of falling water, lamps among the trees and a narrow bridge with no parapet.',
    ground: { kind: 'lush', blend: 0.6, inner: 0.3 },
    vegetation: { density: 1.3 },
    props: [
      { kind: 'hall', offset: [0, -6], rotation: 0.2, color: '#e8e2d2', params: { width: 14, length: 22, height: 7, roofColor: '#6d8aa8', arches: true } },
      { kind: 'hall', offset: [-16, 2], rotation: 0.9, color: '#e0d9c8', params: { width: 8, length: 12, height: 5, roofColor: '#6d8aa8', arches: true } },
      { kind: 'bridge', offset: [-6, 18], rotation: 0.3, params: { length: 14 } },
      { kind: 'lamp', offset: [-6, -14] },
      { kind: 'lamp', offset: [8, -14] },
      { kind: 'lamp', offset: [-22, 12] },
    ],
  },
  'high-pass': {
    radius: 45,
    weather: 'snowy',
    setting:
      'A high, cold saddle in the Misty Mountains. Storms roll between the peaks, stone-giants hurl rocks in the night, and a crack at the back of a shelter-cave is the goblins\' front door.',
    ground: { kind: 'snowyRock', blend: 0.7, inner: 0.3 },
    vegetation: { density: 0.1 },
    props: [
      { kind: 'cave', offset: [6, -4], rotation: 2.8 },
      { kind: 'stones', offset: [-8, 6], params: { count: 7, size: 2.2 } },
    ],
  },
  annuminas: {
    radius: 50,
    setting:
      'The first city of the kings of Arnor, on the southern shore of Lake Evendim. Long deserted: broken walls, fallen columns and quays slipping into the water, with the hills of Evendim rising behind.',
    ground: { kind: 'rubble', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.5 },
    props: [
      { kind: 'ruins', offset: [0, 0], params: { radius: 12, count: 14, height: 5 } },
      { kind: 'quay', offset: [0, -16], rotation: 0, params: { length: 20, width: 4, ruined: true } },
    ],
  },
  carrock: {
    radius: 35,
    setting:
      'A great grey rock standing in the Anduin, flat-topped, with steps cut into its side by Beorn. From its top the eagles set the company down; Beorn\'s hall and bee-pastures lie a short way east.',
    props: [
      { kind: 'crag', offset: [0, 0], params: { height: 10, radius: 5 } },
      { kind: 'hall', offset: [26, 4], rotation: 0.2, color: WOOD, params: { width: 9, length: 16, height: 6, roofColor: '#8a7a4a' } },
      { kind: 'fence', offset: [26, 16], rotation: 0, params: { length: 24 } },
    ],
  },
  moria: {
    radius: 60,
    aura: 'deep',
    setting:
      'The West-gate of Khazad-dûm: a sheer cliff over a still, black, weed-choked lake, two great holly trees flanking doors that show only by moonlight. Something lives in the water.',
    ground: { kind: 'stone', blend: 0.7, inner: 0.3 },
    vegetation: { density: 0.15 },
    props: [
      // the cliff face stands against the mountain to the east; doors look west over the lake
      { kind: 'cliffGate', offset: [10, 0], rotation: -Math.PI / 2, color: DARK_STONE, params: { width: 30, height: 22 } },
      { kind: 'bigTree', offset: [3, -9], params: { scale: 1.8, palette: 'holly' } },
      { kind: 'bigTree', offset: [3, 9], params: { scale: 1.8, palette: 'holly' } },
      { kind: 'pool', offset: [-14, 0], color: '#1d2a30', params: { radius: 11 } },
    ],
  },
  lorien: {
    radius: 70,
    aura: 'golden',
    weather: 'fair',
    setting:
      'The Golden Wood: mallorn trees with silver-grey bark and leaves of gold that stay through winter, a floor of yellow leaves and small elanor and niphredil flowers. Caras Galadhon is a city of platforms high in the trees, lit by lamps.',
    ground: { kind: 'golden', blend: 0.9, inner: 0.5 },
    vegetation: { density: 1.5, palette: 'golden', flowers: 'elanor' },
    props: [
      { kind: 'bigTree', offset: [0, 0], params: { scale: 3.4, palette: 'golden', platform: true } },
      { kind: 'bigTree', offset: [14, 8], params: { scale: 2.8, palette: 'golden', platform: true } },
      { kind: 'bigTree', offset: [-12, 10], params: { scale: 3.0, palette: 'golden', platform: true } },
      { kind: 'bigTree', offset: [-4, -16], params: { scale: 2.6, palette: 'golden' } },
      { kind: 'lamp', offset: [6, 4], color: '#dfe8ff' },
      { kind: 'lamp', offset: [-8, -4], color: '#dfe8ff' },
    ],
  },
  'dol-guldur': {
    radius: 60,
    aura: 'sorcery',
    setting:
      'The Hill of Sorcery rises bare and dark out of southern Mirkwood, crowned by a ruined fortress. The trees around it are sick and thin, and nothing sings there.',
    ground: { kind: 'blight', blend: 0.85, inner: 0.35 },
    vegetation: { density: 0.6, palette: 'dead' },
    props: [
      { kind: 'ruins', offset: [0, 0], color: '#3a3238', params: { radius: 10, count: 12, height: 8, ring: true } },
      { kind: 'tower', offset: [0, 0], color: '#2e2830', params: { height: 20, radius: 3, roof: 'broken', sides: 6 } },
    ],
  },
  'thranduils-halls': {
    radius: 55,
    setting:
      'The Elvenking\'s underground halls open from a great stone gate in a hillside above the Forest River. Torches, feasting and wine-barrels floating out through a trapdoor to Lake-town.',
    ground: { kind: 'lush', blend: 0.5, inner: 0.3 },
    vegetation: { density: 1.2 },
    props: [
      { kind: 'cliffGate', offset: [0, -8], rotation: 0, color: '#6f7466', params: { width: 20, height: 12, doorColor: '#3f6f3a' } },
      { kind: 'bridge', offset: [0, 8], rotation: 0, params: { length: 12 } },
      { kind: 'lamp', offset: [-5, -2], color: '#ffd28a' },
      { kind: 'lamp', offset: [5, -2], color: '#ffd28a' },
    ],
  },
  esgaroth: {
    radius: 60,
    weather: 'misty',
    setting:
      'Lake-town: a town of Men built entirely on wooden piles out on the Long Lake, joined to the shore by a long bridge. Boats, quays and a great hall for the Master, with the Lonely Mountain in view to the north.',
    ground: { kind: 'sand', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.3 },
    props: [
      { kind: 'stiltTown', offset: [-26, 0], params: { count: 9, spread: 22 } },
      { kind: 'bridge', offset: [-10, 0], rotation: Math.PI / 2, params: { length: 22, flat: true } },
      { kind: 'ship', offset: [-40, 12], rotation: 0.7, color: WOOD, params: { length: 8, mast: false } },
      { kind: 'ship', offset: [-36, -14], rotation: -0.5, color: WOOD, params: { length: 7, mast: false } },
    ],
  },
  erebor: {
    radius: 60,
    weather: 'snowy',
    setting:
      'The Lonely Mountain stands alone over the desolation Smaug made: scorched ground, the ruins of Dale, and the great Front Gate from which the River Running pours. A hidden door waits high on the western slope.',
    ground: { kind: 'scorched', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.1, palette: 'dead' },
    props: [
      { kind: 'cliffGate', offset: [0, 8], rotation: Math.PI, color: '#6a665e', params: { width: 26, height: 20, doorColor: '#2d2b2b' } },
      { kind: 'ruins', offset: [4, 26], color: RUIN, params: { radius: 10, count: 10, height: 4 } },
    ],
  },
  'iron-hills': {
    radius: 45,
    setting:
      'Low iron-rich hills east of Erebor, home of Dáin\'s dwarves. Mine-mouths, slag and hard-working stone halls dug into the hillside.',
    ground: { kind: 'rust', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.3 },
    props: [
      { kind: 'cave', offset: [0, 0], rotation: 3.1, color: '#5a4a44' },
      { kind: 'cave', offset: [14, 6], rotation: 2.6, color: '#5a4a44' },
      { kind: 'stones', offset: [-10, 8], params: { count: 6, size: 1.6, color: '#6a4a3a' } },
    ],
  },
  tharbad: {
    radius: 45,
    setting:
      'Once a river-town where the great North-South Road crossed the Greyflood on a long stone bridge. The bridge has fallen and the fords are dangerous; only mounds of rubble and old dykes remain.',
    ground: { kind: 'rubble', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.5 },
    props: [
      { kind: 'bridge', offset: [0, 0], rotation: 0, params: { length: 22, ruined: true } },
      { kind: 'ruins', offset: [10, -10], params: { radius: 7, count: 7, height: 3 } },
    ],
  },
  fangorn: {
    radius: 60,
    aura: 'deepwood',
    setting:
      'The last of the great forests of the Elder Days: huge old trees hung with moss and lichen, a dim green light, and a stuffy, breathing stillness. Ents walk here, and some of the trees are not quite trees.',
    ground: { kind: 'darkForest', blend: 0.8, inner: 0.4 },
    vegetation: { density: 1.6, palette: 'old' },
    props: [
      { kind: 'bigTree', offset: [0, 0], params: { scale: 3.2, palette: 'old' } },
      { kind: 'bigTree', offset: [16, -10], params: { scale: 2.6, palette: 'old' } },
      { kind: 'bigTree', offset: [-14, 12], params: { scale: 2.9, palette: 'old' } },
      { kind: 'ent', offset: [6, 10], rotation: 0.6 },
    ],
  },
  isengard: {
    radius: 70,
    setting:
      'A ring of black stone walls in a bowl of the mountains, its floor once green and now paved and pitted with pits and forges. In the centre stands Orthanc, a black tower of four fused pinnacles that no weapon can mark.',
    ground: { kind: 'stone', blend: 0.9, inner: 0.6 },
    vegetation: { density: 0 },
    props: [
      { kind: 'wallRing', offset: [0, 0], color: '#2b2b30', params: { radius: 34, height: 9, thickness: 3, gapAngle: Math.PI / 2, gapWidth: 0.35 } },
      { kind: 'tower', offset: [0, 0], color: BLACK, params: { height: 48, radius: 3.5, roof: 'spikes', sides: 4 } },
      { kind: 'pits', offset: [0, 0], params: { radius: 26, count: 12 } },
    ],
  },
  'helms-deep': {
    radius: 60,
    setting:
      'A deep gorge in the White Mountains closed by the Deeping Wall and the fortress of the Hornburg, with caves behind. The great horn of Helm sounds from the tower when the Rohirrim ride out.',
    ground: { kind: 'stone', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.2 },
    props: [
      { kind: 'wall', offset: [0, 4], rotation: 0, color: STONE, params: { length: 40, height: 9, thickness: 3, crenellated: true } },
      { kind: 'tower', offset: [-16, -2], color: STONE, params: { height: 22, radius: 4, roof: 'flat', sides: 8 } },
      { kind: 'hall', offset: [-16, -12], rotation: 0, color: STONE, params: { width: 12, length: 14, height: 8, roofColor: '#6a6a70' } },
      { kind: 'cave', offset: [8, -16], rotation: 3.1, color: '#5d5a58' },
    ],
  },
  edoras: {
    radius: 65,
    // the Enter arch on the road just outside the gate (the default spot is up the mountainside)
    portal: [0, -36.5],
    setting:
      'A green hill at the mouth of a mountain valley, ringed by a dike, a wall and a thorn hedge, with the golden-roofed hall Meduseld on its crown and a stream running down beside the stone way through the town. North of the gate the road runs between the mounds of the kings, white on their western sides with simbelmynë.',
    ground: { kind: 'meadow', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.25, flowers: 'white' },
    props: [
      // the wall: an octagon round the town (centre 16 m north of the pin), open in the north side for the gate
      { kind: 'wall', offset: [14.8, -16.0], rotation: -1.571, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [10.5, -5.5], rotation: -2.356, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [0.0, -1.2], rotation: -3.142, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [-10.5, -5.5], rotation: 2.356, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [-14.8, -16.0], rotation: 1.571, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [-10.5, -26.5], rotation: 0.785, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [10.5, -26.5], rotation: -0.785, color: '#8a8273', params: { length: 12.8, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [-4.66, -30.8], rotation: 0, color: '#8a8273', params: { length: 3.52, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'wall', offset: [4.66, -30.8], rotation: 0, color: '#8a8273', params: { length: 3.52, height: 3, thickness: 1.4, cap: '#a69e8e', seg: 1 } },
      { kind: 'townGate', offset: [0, -30.8], rotation: 0, params: { width: 4.6, open: 0.9, board: false, wood: '#5a4030' } },
      // Meduseld on the crown, on the gate's axis with its doors to the north; no pillars
      { kind: 'hall', offset: [0, -12], rotation: Math.PI, color: '#6f4e30', params: { width: 8, length: 16, height: 5, roofColor: GOLD } },
      // timber houses with their backs to the wall: two face each other across the gate square, two flank the hall
      { kind: 'hall', offset: [-7.8, -23.8], rotation: 2.356, color: '#6f5236', params: { width: 4, length: 7, height: 2.6, roofColor: '#9a8a52' } },
      { kind: 'hall', offset: [7.9, -23.6], rotation: -2.38, color: '#6f5236', params: { width: 4, length: 6.5, height: 2.6, roofColor: '#a88a4e' } },
      { kind: 'hall', offset: [-10.5, -13.8], rotation: 3.19, color: '#6f5236', params: { width: 4, length: 6, height: 2.6, roofColor: '#9a8a52' } },
      { kind: 'hall', offset: [10.5, -14.2], rotation: 3.08, color: '#6f5236', params: { width: 4, length: 6, height: 2.6, roofColor: '#b39556' } },
      // the mounds of the kings north of the gate, either side of the road
      { kind: 'barrow', offset: [-6, -40], params: { radius: 3.2, flowers: true, stone: false } },
      { kind: 'barrow', offset: [6, -40], params: { radius: 3.2, flowers: true, stone: false } },
      { kind: 'barrow', offset: [-6, -47], params: { radius: 3.2, flowers: true, stone: false } },
      { kind: 'barrow', offset: [6, -47], params: { radius: 3.2, flowers: true, stone: false } },
      { kind: 'barrow', offset: [-6, -54], params: { radius: 3.2, flowers: true, stone: false } },
      { kind: 'barrow', offset: [6, -54], params: { radius: 3.2, flowers: true, stone: false } },
    ],
  },
  'amon-hen': {
    radius: 50,
    setting:
      'The Hill of Sight above the falls of Rauros: a wooded slope, a stone stair, and on the bald summit a paved circle with the high Seat of Seeing, from which the whole of Middle-earth seems to open out.',
    ground: { kind: 'stone', blend: 0.5, inner: 0.15 },
    vegetation: { density: 0.8 },
    props: [
      { kind: 'seat', offset: [0, 0] },
      { kind: 'stoneRing', offset: [0, 0], params: { radius: 7, count: 8, height: 1.2, paved: true } },
    ],
  },
  'dead-marshes': {
    radius: 70,
    aura: 'marshlight',
    weather: 'foul',
    setting:
      'Endless reeking fens of reeds, mud and still black pools where the faces of dead warriors lie under the water. At night pale candle-lights drift over the meres, luring travellers off the path.',
    ground: { kind: 'marsh', blend: 0.9, inner: 0.4 },
    vegetation: { density: 0.9, palette: 'dead', flowers: 'reeds' },
    props: [
      { kind: 'pool', offset: [-10, -6], color: '#1e2a26', params: { radius: 7 } },
      { kind: 'pool', offset: [12, 8], color: '#1e2a26', params: { radius: 9 } },
      { kind: 'pool', offset: [-4, 18], color: '#1e2a26', params: { radius: 5 } },
      { kind: 'candles', offset: [0, 0], params: { radius: 30, count: 14 } },
    ],
  },
  morannon: {
    radius: 70,
    weather: 'ashen',
    setting:
      'The Black Gate: a rampart of stone across the pass of Cirith Gorgor with an iron gate of three doors, flanked by the Towers of the Teeth on the cliffs. Ash, slag and trenches lie before it.',
    ground: { kind: 'ash', blend: 0.9, inner: 0.5 },
    vegetation: { density: 0.1, palette: 'dead' },
    props: [
      { kind: 'gate', offset: [0, 0], rotation: 0, color: IRON, params: { width: 30, height: 16, towerHeight: 28 } },
      { kind: 'tower', offset: [-30, 6], color: '#2a2530', params: { height: 24, radius: 3, roof: 'spikes', sides: 6 } },
      { kind: 'tower', offset: [30, 6], color: '#2a2530', params: { height: 24, radius: 3, roof: 'spikes', sides: 6 } },
      { kind: 'pits', offset: [0, -20], params: { radius: 22, count: 8 } },
    ],
  },
  'barad-dur': {
    radius: 80,
    aura: 'ember',
    weather: 'ashen',
    setting:
      'The Dark Tower: a vast fortress of iron and adamant, courts and dungeons and battlements rising to a pinnacle where the Eye keeps watch. The land around is slag, fume and iron-grey ash.',
    ground: { kind: 'ash', blend: 1, inner: 0.6 },
    vegetation: { density: 0 },
    props: [
      { kind: 'wallRing', offset: [0, 0], color: '#232026', params: { radius: 30, height: 12, thickness: 4, gapAngle: 0, gapWidth: 0.25 } },
      { kind: 'tower', offset: [0, 0], color: BLACK, params: { height: 90, radius: 7, roof: 'spikes', sides: 6 } },
      { kind: 'tower', offset: [-18, -14], color: '#1a181e', params: { height: 34, radius: 3, roof: 'spikes', sides: 6 } },
      { kind: 'tower', offset: [18, 16], color: '#1a181e', params: { height: 34, radius: 3, roof: 'spikes', sides: 6 } },
      { kind: 'eye', offset: [0, 0], params: { height: 92 } },
    ],
  },
  'mount-doom': {
    radius: 70,
    aura: 'ember',
    weather: 'ashen',
    setting:
      'Orodruin: a huge cone of ash and cinders that smokes and flares by night. Rivers of fire run down its sides and a road winds up to Sammath Naur, the Chambers of Fire, where the Ring was made.',
    ground: { kind: 'lava', blend: 0.9, inner: 0.25 },
    vegetation: { density: 0 },
    props: [
      { kind: 'lavaGlow', offset: [0, 0], params: { radius: 22 } },
      { kind: 'smoke', offset: [0, 0] },
    ],
  },
  'cirith-ungol': {
    radius: 60,
    weather: 'ashen',
    setting:
      'The Pass of the Spider: stairs climbing the Mountains of Shadow into a long tunnel thick with webs, and beyond it a tiered orc-tower guarding the way down into Mordor.',
    ground: { kind: 'ash', blend: 0.7, inner: 0.3 },
    vegetation: { density: 0.05, palette: 'dead' },
    props: [
      { kind: 'tower', offset: [0, 0], color: '#2c2a30', params: { height: 30, radius: 5, roof: 'flat', sides: 6, tiers: 3 } },
      { kind: 'webs', offset: [-14, -8], params: { count: 6 } },
    ],
  },
  'minas-morgul': {
    radius: 60,
    aura: 'morgul',
    weather: 'ashen',
    setting:
      'The Tower of the Moon turned dead city: pale walls that give off a corpse-light, a topmost turret that slowly revolves, and a valley of sickly luminous flowers and foul water.',
    ground: { kind: 'blight', blend: 0.9, inner: 0.4 },
    vegetation: { density: 0.3, palette: 'dead', flowers: 'morgul' },
    props: [
      { kind: 'wallRing', offset: [0, 0], color: '#a8b3a0', params: { radius: 22, height: 8, thickness: 3, gapAngle: -Math.PI / 2, gapWidth: 0.3 } },
      { kind: 'tower', offset: [0, 0], color: '#b8c2b0', params: { height: 40, radius: 4, roof: 'cone', roofColor: '#8fa08a', sides: 8, glow: '#9dff9d' } },
      { kind: 'bridge', offset: [0, -26], rotation: 0, params: { length: 14, color: '#a8b3a0' } },
    ],
  },
  osgiliath: {
    radius: 55,
    setting:
      'The old capital of Gondor built on both banks of the Anduin, its great bridge broken and its domes and towers roofless. Fought over again and again; a ruin held by the Rangers of Ithilien.',
    ground: { kind: 'rubble', blend: 0.8, inner: 0.4 },
    vegetation: { density: 0.3 },
    props: [
      { kind: 'ruins', offset: [-12, 0], color: RUIN, params: { radius: 10, count: 12, height: 7 } },
      { kind: 'ruins', offset: [14, 4], color: RUIN, params: { radius: 9, count: 10, height: 6 } },
      { kind: 'bridge', offset: [0, 2], rotation: 0, params: { length: 18, ruined: true, color: RUIN } },
    ],
  },
  'minas-tirith': {
    radius: 80,
    setting:
      'The White City: seven concentric walls climbing the knee of Mount Mindolluin, each gate set to the side of the last, a great keel of rock jutting out over the lowest court, and the White Tower of Ecthelion at the summit.',
    ground: { kind: 'stone', blend: 0.9, inner: 0.5 },
    vegetation: { density: 0.05 },
    props: [
      { kind: 'wallRing', offset: [0, 0], color: '#e6e2d8', params: { radius: 40, height: 7, thickness: 3, gapAngle: Math.PI / 2, gapWidth: 0.2 } },
      { kind: 'wallRing', offset: [0, -4], color: '#e6e2d8', params: { radius: 30, height: 7, thickness: 3, gapAngle: Math.PI / 2 + 0.9, gapWidth: 0.2, lift: 8 } },
      { kind: 'wallRing', offset: [0, -8], color: '#e6e2d8', params: { radius: 21, height: 7, thickness: 3, gapAngle: Math.PI / 2 - 0.9, gapWidth: 0.25, lift: 16 } },
      { kind: 'wallRing', offset: [0, -11], color: '#e6e2d8', params: { radius: 13, height: 7, thickness: 3, gapAngle: Math.PI / 2 + 0.9, gapWidth: 0.3, lift: 24 } },
      { kind: 'tower', offset: [0, -12], color: '#f2efe8', params: { height: 60, radius: 4, roof: 'cone', roofColor: '#cfd6dc', sides: 8, lift: 32 } },
      { kind: 'hall', offset: [-6, -10], rotation: 0.3, color: '#ebe7de', params: { width: 8, length: 12, height: 6, roofColor: '#b8c0c8', lift: 32 } },
    ],
  },
  pelargir: {
    radius: 60,
    setting:
      'Gondor\'s great river-port on the Anduin: long quays, warehouses and the masts of many ships. The black fleet of Umbar lies here when Aragorn and the Dead come down out of the mountains.',
    ground: { kind: 'stone', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.2 },
    props: [
      { kind: 'quay', offset: [-12, 0], rotation: 0, params: { length: 40, width: 5 } },
      { kind: 'ship', offset: [-26, -10], rotation: 0.2, color: '#2a2622', params: { length: 16, sailColor: '#3a2f2a' } },
      { kind: 'ship', offset: [-30, 8], rotation: -0.3, color: '#2a2622', params: { length: 14, sailColor: '#3a2f2a' } },
      { kind: 'hall', offset: [4, -8], rotation: 0, color: '#d8cfbd', params: { width: 10, length: 18, height: 6, roofColor: '#8a5a3a' } },
      { kind: 'hall', offset: [8, 10], rotation: 0.2, color: '#cfc4b0', params: { width: 8, length: 12, height: 5, roofColor: '#8a5a3a' } },
    ],
  },
  'dol-amroth': {
    radius: 55,
    setting:
      'A white castle on a headland over the Bay of Belfalas, banner of the silver swan-ship flying from its tower. Home of Prince Imrahil and his knights.',
    ground: { kind: 'stone', blend: 0.6, inner: 0.3 },
    vegetation: { density: 0.3 },
    props: [
      { kind: 'wallRing', offset: [0, 0], color: '#ece8e0', params: { radius: 18, height: 7, thickness: 2.5, gapAngle: 0, gapWidth: 0.3 } },
      { kind: 'tower', offset: [0, -2], color: '#f2efe8', params: { height: 28, radius: 3.5, roof: 'cone', roofColor: '#3f6fb5', sides: 8, banner: '#3f6fb5' } },
      { kind: 'tower', offset: [10, 8], color: '#ece8e0', params: { height: 14, radius: 2, roof: 'cone', roofColor: '#3f6fb5', sides: 8 } },
    ],
  },
  umbar: {
    radius: 60,
    setting:
      'A great natural harbour in the hot south, fortified by the Corsairs: black-hulled ships with black sails, sea-walls and towers of sun-baked stone.',
    ground: { kind: 'sand', blend: 0.7, inner: 0.3 },
    vegetation: { density: 0.1 },
    props: [
      { kind: 'quay', offset: [0, -14], rotation: Math.PI / 2, params: { length: 34, width: 5 } },
      { kind: 'ship', offset: [-10, -30], rotation: 1.4, color: '#1f1c1a', params: { length: 16, sailColor: '#26221f' } },
      { kind: 'ship', offset: [10, -32], rotation: 1.9, color: '#1f1c1a', params: { length: 14, sailColor: '#26221f' } },
      { kind: 'ship', offset: [0, -44], rotation: 1.6, color: '#1f1c1a', params: { length: 15, sailColor: '#26221f' } },
      { kind: 'tower', offset: [-16, 0], color: '#c9a878', params: { height: 16, radius: 3, roof: 'flat', sides: 8 } },
      { kind: 'tower', offset: [16, 0], color: '#c9a878', params: { height: 16, radius: 3, roof: 'flat', sides: 8 } },
      { kind: 'hall', offset: [0, 10], rotation: 0, color: '#d9bb8a', params: { width: 10, length: 14, height: 5, roofColor: '#b08a5a' } },
    ],
  },
}

// Colour keys used by props above, exported so the runtime palette can stay in sync.
export const DRESSING_COLOURS = { WHITE, STONE, DARK_STONE, BLACK, IRON, GOLD, WOOD, DARK_WOOD, HEDGE, RUIN }
