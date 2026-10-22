# Ambient sound

Drop audio files in this folder and the game starts using them. Nothing is registered in code.

The system plays **one looping bed at a time** and crossfades over ~2.5 s when the traveller's
situation changes. It picks the bed by trying a list of names and using the first one that
exists, so a single `ambient.mp3` covers the whole game and anything more specific takes over
wherever you add it.

Accepted extensions, in order of preference: `.mp3`, `.ogg`, `.m4a`, `.wav`.

## Currently here

| File | Plays |
|---|---|
| `ambient.mp3` | everywhere with nothing more specific — the Shire, Rohan, the sea, all of Earth |
| `hobbiton.mp3` | inside the Hobbiton place |
| `mordor.mp3` | anywhere in the Mordor region |

## How a bed is chosen

Specificity runs **place → region → world → fallback**. Weather and night are *modifiers* tried
within each of those scopes rather than above them, so a rain bed written for Mordor beats
Mordor's dry bed, which beats a generic rain bed — somewhere with a voice of its own is not
drowned out just because it happens to be raining.

For a traveller in world `W`, place `P`, region `R`, with modifiers `M` (`storm`, `rain`, `snow`,
`ash`, `mist`, `night`), the order is:

```
W/P/M   W/P   place/P   P          ← the place they are inside
W/R/M   W/R   R                    ← the region they are standing in
W/M     W                          ← the world
M                                  ← weather or night, anywhere
ambient   main                     ← the fallback
```

So all of these work, and you can use whichever is convenient:

- `mordor.mp3` — flat, what is here now
- `middle-earth/mordor.mp3` — nested, for when the folder gets big or names collide
- `middle-earth/mordor/storm.mp3` — Mordor, but only during a storm
- `night.mp3` — anywhere after dark, unless something more specific exists

World ids are `middle-earth` and `earth`. Region ids are in each world's `world.json`
(`shire`, `mordor`, `mirkwood`, `rohan`, `gondor`, `europe`, `tropics`, …). Place ids are in
`src/places/loadPlace.ts`.

## Notes

- Files are streamed, not decoded up front, and only the bed in use is fetched — a long track
  costs nothing until it plays.
- Browsers refuse to start audio before the first click or keypress; the system waits for one.
- A name with no file costs one failed request, cached for the session. It is not an error.
- The speaker button in the top right toggles sound, holds the volume slider, and names the bed
  that is playing. Right-clicking it mutes directly. Volume and mute are remembered.
- Loop seams are audible on a track that was not authored to loop. These three are long enough
  that the seam is rare.
