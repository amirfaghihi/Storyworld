// The mixer: which bed is playing, and the crossfades between them. Driven by Ambience.tsx.
/**
 * Ambient sound.
 *
 * One looping bed plays at a time and the system crossfades when the traveller's situation
 * changes — a different world, a place, a region, rain, nightfall. Which bed that is comes from
 * a list of candidate names, most specific first; the first one whose file actually exists wins,
 * so the whole thing degrades to "play the one track we have" when only one track has been
 * supplied, and sharpens as more are added without any code change.
 *
 * Nothing here ever throws into the render loop: a missing file, a browser that refuses to make
 * an AudioContext, or a machine with no audio device all end up silent rather than broken.
 */

/** Seconds to fade a bed in or out. Long, because ambience should never announce itself. */
const FADE = 2.5

/** Files live in public/audio/<id>.<ext>, where <id> may contain slashes. */
const EXTS = ['mp3', 'ogg', 'm4a', 'wav']

export interface Scene {
  worldId: string
  placeId: string | null
  regionId: string | null
  /** current weather kind */
  weather: string
  night: boolean
}

/**
 * Bed names to try, most specific first. Drop a file at `public/audio/<name>.mp3` and it starts
 * being used; leave it out and the next candidate is tried.
 *
 * Specificity is by PLACE first — a place beats a region beats a world — and weather and night
 * are modifiers tried *within* each of those scopes rather than above them. So a rain bed
 * written for Mordor wins over Mordor's dry bed, which wins over a generic rain bed: somewhere
 * with a voice of its own is not drowned out just because it happens to be raining.
 *
 * Each scope also accepts a bare name (`hobbiton.mp3`, `mordor.mp3`), so a flat folder works
 * and the nested form is there for when names collide or the folder gets big.
 */
export function candidates(s: Scene): string[] {
  const out: string[] = []
  const w = s.worldId

  const mods: string[] = []
  if (s.weather === 'storm') mods.push('storm', 'rain')
  else if (s.weather === 'rain') mods.push('rain')
  else if (s.weather === 'snow') mods.push('snow')
  else if (s.weather === 'ash') mods.push('ash')
  else if (s.weather === 'mist') mods.push('mist')
  if (s.night) mods.push('night')

  /** a scope's own weather/night beds, then the scope itself */
  const scope = (base: string) => {
    for (const m of mods) out.push(`${base}/${m}`)
    out.push(base)
  }

  if (s.placeId) {
    scope(`${w}/${s.placeId}`)
    out.push(`place/${s.placeId}`, s.placeId)
  }
  if (s.regionId) {
    scope(`${w}/${s.regionId}`)
    out.push(s.regionId)
  }
  scope(w)
  for (const m of mods) out.push(m)
  out.push('ambient', 'main')
  return [...new Set(out)]
}

class Bed {
  readonly el: HTMLAudioElement
  node: MediaElementAudioSourceNode | null = null
  gain: GainNode | null = null
  constructor(
    readonly id: string,
    readonly url: string,
  ) {
    this.el = new Audio(url)
    this.el.loop = true
    this.el.preload = 'auto'
    this.el.volume = 1
  }
}

/** Probe for a file by trying each extension; resolves to the url that loaded, or null. */
function findFile(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    let i = 0
    const next = () => {
      if (i >= EXTS.length) return resolve(null)
      const url = `${import.meta.env.BASE_URL}audio/${id}.${EXTS[i++]}`
      const probe = new Audio()
      const ok = () => {
        cleanup()
        resolve(url)
      }
      const fail = () => {
        cleanup()
        next()
      }
      const cleanup = () => {
        probe.removeEventListener('loadedmetadata', ok)
        probe.removeEventListener('error', fail)
        probe.src = ''
      }
      probe.addEventListener('loadedmetadata', ok, { once: true })
      probe.addEventListener('error', fail, { once: true })
      probe.preload = 'metadata'
      probe.src = url
    }
    next()
  })
}

class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private current: Bed | null = null
  private wanted: string | null = null
  /** id -> url, or null once we know there is no such file */
  private known = new Map<string, string | null>()
  private loading = new Map<string, Promise<string | null>>()
  private volume = 0.55
  private muted = false
  private started = false

  /** Whether any bed is actually playing — the HUD shows this so silence is explicable. */
  playing: string | null = null

  /** Must be called from a user gesture: browsers will not let audio start otherwise. */
  start() {
    if (this.started) return
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : this.volume
      this.master.connect(this.ctx.destination)
      this.started = true
      void this.ctx.resume()
      if (this.wanted) void this.play(this.wanted)
    } catch {
      this.ctx = null
    }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyMaster()
  }

  setMuted(m: boolean) {
    this.muted = m
    this.applyMaster()
    if (!m && this.started) void this.ctx?.resume()
  }

  private applyMaster() {
    const g = this.master
    if (!g || !this.ctx) return
    const target = this.muted ? 0 : this.volume
    try {
      g.gain.cancelScheduledValues(this.ctx.currentTime)
      g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1)
    } catch {
      g.gain.value = target
    }
  }

  /** Resolve a file for `id`, caching both hits and misses. */
  private async url(id: string): Promise<string | null> {
    if (this.known.has(id)) return this.known.get(id) ?? null
    let p = this.loading.get(id)
    if (!p) {
      p = findFile(id).then((u) => {
        this.known.set(id, u)
        this.loading.delete(id)
        return u
      })
      this.loading.set(id, p)
    }
    return p
  }

  /**
   * Ask for the first of `names` that exists. Called often; does nothing when the answer has
   * not changed, so it is cheap to drive from a timer.
   */
  async want(names: string[]) {
    for (const id of names) {
      const u = await this.url(id)
      if (!u) continue
      if (this.wanted === id) return
      this.wanted = id
      if (this.started) await this.play(id)
      return
    }
    // nothing on offer: fade out whatever is going
    if (this.wanted !== null) {
      this.wanted = null
      this.fadeOut(this.current)
      this.current = null
      this.playing = null
    }
  }

  private async play(id: string) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    if (this.current?.id === id) return
    const url = await this.url(id)
    if (!url || this.wanted !== id) return // the situation moved on while we were loading

    const bed = new Bed(id, url)
    try {
      bed.node = ctx.createMediaElementSource(bed.el)
      bed.gain = ctx.createGain()
      bed.gain.gain.value = 0
      bed.node.connect(bed.gain)
      bed.gain.connect(master)
      await bed.el.play()
      bed.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE)
    } catch {
      // autoplay refused, or the file turned out to be unplayable
      try {
        bed.el.pause()
      } catch {
        /* nothing to do */
      }
      return
    }
    this.fadeOut(this.current)
    this.current = bed
    this.playing = id
  }

  private fadeOut(bed: Bed | null) {
    if (!bed || !this.ctx) return
    const ctx = this.ctx
    try {
      bed.gain?.gain.cancelScheduledValues(ctx.currentTime)
      bed.gain?.gain.setValueAtTime(bed.gain.gain.value, ctx.currentTime)
      bed.gain?.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE)
    } catch {
      /* fall through to the stop below */
    }
    window.setTimeout(
      () => {
        try {
          bed.el.pause()
          bed.node?.disconnect()
          bed.gain?.disconnect()
          bed.el.src = ''
        } catch {
          /* already gone */
        }
      },
      (FADE + 0.3) * 1000,
    )
  }

  stop() {
    this.fadeOut(this.current)
    this.current = null
    this.wanted = null
    this.playing = null
  }
}

export const ambience = new Ambience()
if (import.meta.env.DEV) (window as unknown as { __audio: unknown }).__audio = ambience
