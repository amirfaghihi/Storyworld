// Earth as a small globe, told through Jules Verne's "Around the World in Eighty Days" (1872, public domain).
// Geography from Natural Earth (public domain). Landmark positions are real latitude/longitude.

export interface EarthLandmark {
  id: string
  displayName: string
  type: 'city' | 'village' | 'fortress' | 'ruin' | 'forest' | 'mountain' | 'other' | 'water' | 'hill'
  lat: number
  lon: number
  discoverRadius?: number
}

export const earth = {
  id: 'earth',
  name: 'Earth · Around the World in Eighty Days',
  seed: 8080,
  radius: 200, // metres: circumference ~1257 m, about the width of Middle-earth
  reliefScale: 0.26, // mountains top out around 36 m on this small planet
  width: 1024, // longitude samples
  height: 512, // latitude samples
  attribution: 'Geography from Natural Earth (public domain). Story notes written from Jules Verne, Around the World in Eighty Days (1873).',
  palette: {
    water: '#4d8fd6',
    waterDeep: '#1f4f96',
    sand: '#e2c98f',
    grass: '#7fb85a',
    grassDry: '#b3ae5f',
    grassLush: '#4f9a5c',
    meadow: '#9ccd5e',
    forest: '#3f8a46',
    forestDark: '#2f6a44',
    rock: '#8d8478',
    rockWarm: '#a68b6a',
    snow: '#f4f4f8',
    ash: '#5b524f',
    ashPurple: '#6a5a6e',
    marsh: '#6f8f5a',
    road: '#c9b48a',
    sky: '#7fbdf0',
    horizon: '#dbe9f6',
  },
  /** stylised relief height (metres) for named ranges; others get the default */
  rangeHeights: {
    HIMALAYAS: 140, 'KARAKORAM RA.': 130, 'HINDU KUSH': 110, PAMIRS: 110, 'KUNLUN MOUNTAINS': 100, 'TIAN SHAN': 100,
    ANDES: 115, 'ROCKY MOUNTAINS': 95, 'SIERRA NEVADA': 80, 'CASCADE RANGE': 75, 'ALASKA RANGE': 90, 'COAST MOUNTAINS': 70,
    ALPS: 95, 'CAUCASUS MTS.': 95, PYRENEES: 70, 'CARPATHIAN MOUNTAINS': 60, 'KJØLEN MOUNTAINS': 60, 'URAL MOUNTAINS': 45,
    'ATLAS MOUNTAINS': 70, 'HAUT ATLAS': 75, DRAKENSBERG: 70, 'ETHIOPIAN HIGHLANDS': 70, 'APPALACHIAN MTS.': 45,
    'GREAT DIVIDING RANGE': 50, 'NEW GUINEA HIGHLANDS': 85, 'ELBURZ MTS.': 80, 'ZAGROS MTS.': 70, 'ALTAY MOUNTAINS': 80,
    'VERKHOYANSK RANGE': 60, 'TRANSANTARCTIC MOUNTAINS': 80, 'JAPANESE ALPS': 75, 'SOUTHERN ALPS': 80,
  } as Record<string, number>,
  defaultRangeHeight: 55,
  /** Fogg's route (and a few side notes), in order */
  landmarks: [
    { id: 'london', displayName: 'London · Reform Club', type: 'city', lat: 51.507, lon: -0.128, discoverRadius: 24 },
    { id: 'paris', displayName: 'Paris', type: 'city', lat: 48.857, lon: 2.352, discoverRadius: 20 },
    { id: 'brindisi', displayName: 'Brindisi', type: 'city', lat: 40.632, lon: 17.94, discoverRadius: 18 },
    { id: 'suez', displayName: 'Suez', type: 'city', lat: 29.967, lon: 32.55, discoverRadius: 20 },
    { id: 'aden', displayName: 'Aden', type: 'city', lat: 12.79, lon: 45.03, discoverRadius: 18 },
    { id: 'bombay', displayName: 'Bombay', type: 'city', lat: 19.076, lon: 72.878, discoverRadius: 22 },
    { id: 'allahabad', displayName: 'Allahabad · the jungle road', type: 'forest', lat: 25.435, lon: 81.846, discoverRadius: 20 },
    { id: 'calcutta', displayName: 'Calcutta', type: 'city', lat: 22.573, lon: 88.364, discoverRadius: 22 },
    { id: 'singapore', displayName: 'Singapore', type: 'city', lat: 1.352, lon: 103.82, discoverRadius: 18 },
    { id: 'hong-kong', displayName: 'Hong Kong', type: 'city', lat: 22.32, lon: 114.17, discoverRadius: 22 },
    { id: 'shanghai', displayName: 'Shanghai', type: 'city', lat: 31.23, lon: 121.47, discoverRadius: 18 },
    { id: 'yokohama', displayName: 'Yokohama', type: 'city', lat: 35.444, lon: 139.638, discoverRadius: 22 },
    { id: 'san-francisco', displayName: 'San Francisco', type: 'city', lat: 37.775, lon: -122.419, discoverRadius: 22 },
    { id: 'great-salt-lake', displayName: 'Great Salt Lake', type: 'water', lat: 41.1, lon: -112.5, discoverRadius: 22 },
    { id: 'medicine-bow', displayName: 'Medicine Bow · the broken bridge', type: 'other', lat: 41.9, lon: -106.2, discoverRadius: 20 },
    { id: 'fort-kearney', displayName: 'Fort Kearney', type: 'fortress', lat: 40.64, lon: -99.0, discoverRadius: 20 },
    { id: 'chicago', displayName: 'Chicago', type: 'city', lat: 41.878, lon: -87.63, discoverRadius: 18 },
    { id: 'new-york', displayName: 'New York', type: 'city', lat: 40.713, lon: -74.006, discoverRadius: 22 },
    { id: 'queenstown', displayName: 'Queenstown (Cobh)', type: 'village', lat: 51.85, lon: -8.29, discoverRadius: 18 },
    { id: 'liverpool', displayName: 'Liverpool', type: 'city', lat: 53.408, lon: -2.992, discoverRadius: 18 },
    // a few places off the route so the rest of the globe is not empty
    { id: 'everest', displayName: 'Mount Everest', type: 'mountain', lat: 27.988, lon: 86.925, discoverRadius: 24 },
    { id: 'giza', displayName: 'Pyramids of Giza', type: 'ruin', lat: 29.979, lon: 31.134, discoverRadius: 18 },
    { id: 'rio', displayName: 'Rio de Janeiro', type: 'city', lat: -22.907, lon: -43.173, discoverRadius: 18 },
    { id: 'cape-town', displayName: 'Cape Town', type: 'city', lat: -33.925, lon: 18.424, discoverRadius: 18 },
    { id: 'sydney', displayName: 'Sydney', type: 'city', lat: -33.869, lon: 151.209, discoverRadius: 18 },
    { id: 'south-pole', displayName: 'The South Pole', type: 'other', lat: -89.5, lon: 0, discoverRadius: 26 },
    { id: 'north-pole', displayName: 'The North Pole', type: 'other', lat: 89.5, lon: 0, discoverRadius: 26 },
  ] as EarthLandmark[],
  /** continent moods for the vegetation */
  continentMoods: {
    EUROPE: 'mixed', ASIA: 'mixed', AFRICA: 'dry', 'NORTH AMERICA': 'mixed', 'SOUTH AMERICA': 'lush', AUSTRALIA: 'dry', ANTARCTICA: 'pine',
  } as Record<string, string>,
}
