# Skins and custom characters

A skin is a JSON manifest plus one or more sprite sheets. Point the `skin`
option at your manifest to use your own character.

## Manifest format

```json
{
  "name": "my-character",
  "frameSize": [32, 32],
  "sheets": ["sheet.png"],
  "animations": {
    "idle": { "frames": [0, 1], "fps": 2, "loop": true },
    "wake": { "frames": [2, 3, 4], "fps": 8, "loop": false, "next": "idle", "still": 3 }
  }
}
```

Frames are numbered left to right, top to bottom across the sheet. `still` is
the frame shown to people who prefer reduced motion. `next` is played when a
one-shot animation ends.

A manifest can also carry a `voice`, the character's lines, in the same format
as the `voice` option (see Configuration). A grumpy stapler can sound like
one.

## Required animations

Every skin must provide: idle, idle-fidget, bored, sleep, wake, greet,
wave-goodbye, listening, thinking, talking, happy, confused, sorry, pointing,
drag, land, hide, appear and download. A skin missing any of them is rejected
and the built-in character is used instead.

## Optional animations

These add expressions. A skin without them plays the fallback instead:

- `wave` (small-talk hellos and goodbyes), falls back to `greet`
- `unsure` (a best-guess answer), falls back to `confused`
- `blush` (when praised), falls back to `happy`
- `laugh` (after a joke), falls back to `happy`
- `nope` (shaking its head when the docs have no answer), falls back to `sorry`
- `working` (a loop, when the model takes more than 1.5 seconds), falls back to `thinking`
