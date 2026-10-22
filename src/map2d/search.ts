/**
 * Place search for the map: forgiving about accents, hyphens, apostrophes and one slip of the
 * finger, so "barad dur" finds Barad-dûr and "lake town" finds Esgaroth (Lake-town). Pure, so it
 * can be tested in node.
 */

/** Lower case, accents and apostrophes dropped, every other run of punctuation a single space. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface SearchSource {
  id: string
  kind: 'landmark' | 'region' | 'exit'
  name: string
  x: number
  z: number
  /** importance, for breaking ties (markers.ts basePriority) */
  priority: number
  discovered?: boolean
  /** other names the place goes by, matched like the name itself */
  aliases?: string[]
}

export interface SearchEntry extends SearchSource {
  /** folded forms to match against: the whole name, and each parenthetical part on its own */
  forms: string[]
}

export interface SearchHit {
  entry: SearchEntry
  score: number
}

/**
 * "Esgaroth (Lake-town)" is also known as "Esgaroth" and as "Lake-town"; "The Old Forest" also
 * answers to "Old Forest", since nobody types the article.
 */
function formsOf(name: string): string[] {
  const forms = new Set<string>()
  const add = (s: string) => {
    const f = fold(s)
    if (!f) return
    forms.add(f)
    if (f.startsWith('the ')) forms.add(f.slice(4))
  }
  add(name)
  const outer = name.replace(/\([^)]*\)/g, ' ')
  if (outer !== name) add(outer)
  for (const m of name.matchAll(/\(([^)]*)\)/g)) add(m[1])
  return [...forms]
}

export function buildSearchIndex(sources: SearchSource[]): SearchEntry[] {
  return sources.map((s) => ({ ...s, forms: [...new Set([s.name, ...(s.aliases ?? [])].flatMap(formsOf))] }))
}

/** Optimal-string-alignment distance (Damerau-Levenshtein with adjacent swaps), stopping early past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const n = b.length
  let prev2 = new Array<number>(n + 1).fill(0)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(n + 1)
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[n]
}

/**
 * How well a folded query matches one folded name, 0 for no match:
 * exact 100; prefix 90 (a little less for each letter left over); a word of the name starts with
 * it 80; anywhere inside 60; one typo against the start of a word (queries of four letters or more)
 * 50; the letters in order with gaps 40 and down.
 */
export function scoreName(q: string, name: string): number {
  if (!q) return 0
  if (name === q) return 100
  if (name.startsWith(q)) return 90 - 0.1 * (name.length - q.length)
  const words = name.split(' ')
  for (let i = 1; i < words.length; i++) if (words.slice(i).join(' ').startsWith(q)) return 80
  if (name.includes(q)) return 60
  if (q.length >= 4) {
    for (let i = 0; i < words.length; i++) {
      const rest = words.slice(i).join(' ')
      // compare against the start of the name from this word on, a letter either way to allow a dropped or doubled one
      for (const len of [q.length, q.length - 1, q.length + 1]) {
        if (len < 3 || len > rest.length) continue
        if (editDistance(q, rest.slice(0, len), 1) <= 1) return 50
      }
    }
  }
  // subsequence: every query letter in order
  let gaps = 0
  let first = -1
  let j = 0
  for (let i = 0; i < name.length && j < q.length; i++) {
    if (name[i] === q[j]) {
      if (first < 0) first = i
      j++
    } else if (j > 0) gaps++
  }
  if (j === q.length && q.replace(/ /g, '').length >= 2) return Math.max(1, 40 - 2 * gaps - 0.5 * first)
  return 0
}

/**
 * The best matches for `query`, best first, at most `limit`. Ties go to places already
 * discovered, then the more important, then the nearer to `from`.
 */
export function searchPlaces(index: SearchEntry[], query: string, opts: { limit?: number; from?: [number, number] } = {}): SearchHit[] {
  const q = fold(query)
  if (!q) return []
  const hits: SearchHit[] = []
  for (const entry of index) {
    let best = 0
    for (const f of entry.forms) best = Math.max(best, scoreName(q, f))
    if (best > 0) hits.push({ entry, score: best })
  }
  const dist = (e: SearchEntry) => (opts.from ? Math.hypot(e.x - opts.from[0], e.z - opts.from[1]) : 0)
  hits.sort((a, b) => b.score - a.score || Number(!!b.entry.discovered) - Number(!!a.entry.discovered) || b.entry.priority - a.entry.priority || dist(a.entry) - dist(b.entry))
  return hits.slice(0, opts.limit ?? 8)
}
