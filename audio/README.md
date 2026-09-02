# Music tracks

Drop three files in this folder. Nothing else needs changing — the game picks
them up on the next load, and works fine without them.

| file | when it plays |
|---|---|
| `frogath-phase1.mp3` | FROGATH, THE ASCENDED — phase 1, from the moment the fight starts until he hits 50%. Loops. |
| `frogath-ascension.mp3` | THE ASCENSION — the cutscene at 50%. Plays once, does not loop. Also used, cut to a ~2.4s sting, for the Frogath-skin transformation, so make the first couple of seconds recognisable. |
| `frogath-ascended.mp3` | PHASE II — the whole back half of the fight, and again after the last stand at 10%. Loops. |

Any format the browser can decode works; `.mp3` and `.ogg` are the safe picks.
To use a different filename or extension, edit `TRACKS` at the top of
[`js/audio.js`](../js/audio.js).

## What happens when a file is missing

- `frogath-phase1` and `frogath-ascended` fall back to the synthesized boss
  music the rest of the game uses.
- `frogath-ascension` falls back to **silence**, deliberately: the cutscene
  asks for the music to stop completely, and substituting anything there
  would wreck the beat.

Everything else in the fight — every sound effect — is synthesized at runtime
and needs no files at all.

## Volume

Tracks play on the music bus, so the in-game Music slider controls them. They
are started at 0.8–1.0 of that; if a track sits too loud or too quiet against
the effects, change the `volume` passed to `Audio.playTrack` in
[`js/ascended.js`](../js/ascended.js) rather than re-exporting the file.
