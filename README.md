# Telephone

A program with no storage. Between runs, its source code exists only as sound
travelling through the air from a speaker to a microphone. Each pass, the
program is heard, decoded, run, and played back into the room. There is no
error correction on the code itself, so whatever the room does to the sound on
the way (reverb, distance, someone talking, a cough) is written into the
program. If a pass fails completely, the program is gone.

## Run

```bash
cd room-memory
python3 -m http.server 8001
# open http://localhost:8001 in Chrome
```

- **this room**: uses the real speaker and a real microphone. Pick a mic that
  is a few metres from the speaker (a phone via Continuity Camera, a USB or
  Bluetooth mic). With the laptop's own speaker and mic, the code mostly
  survives untouched: the room only gets a say when the sound has to cross it.
- **simulated room**: a software room (reverb, distance, people talking) for
  rehearsing without a second device. It plays what the simulated mic hears
  out loud.

Dials:
- **symbol length**: how long each tone lasts. Longer is slower and harder for
  the room to change.
- **volume** / **distance**: how loud the program is relative to the room.

Tested in the simulated room (0.7 s reverb, one person talking, 116-byte program):

| distance | symbol | bytes changed per pass, 8 passes |
|---|---|---|
| 2 m | 30 ms | 0 0 0 0 0 0 0 0 |
| 3 m | 40 ms | 1 0 1 1 0 0 0 1 |
| 3 m | 30 ms | 0 3 1 1 2 0 1 1 |
| 4 m | 30 ms | 13 19 7 4 6 6 12 (dead on pass 1) |

Real rooms will differ. Calibrate by ear and by the log before filming.

## How it works

- `modem.js`: 16-tone FSK (1.5–3.75 kHz, 4 bits per tone). Frame is an
  8-tone preamble, the length sent three times (majority vote, so the frame
  can be found), then the body with no protection at all.
- `app.js`: the loop. After a pass is decoded, the decoded bytes are the only
  copy the next pass encodes. The log keeps a record of each generation for
  documentation; the loop never reads from it.
- Whatever decodes is run in a Web Worker with a `say()` function and a 0.5 s
  time limit. Mutated code that no longer parses still circulates: the medium
  doesn't care whether its content works.
- `test_modem.mjs`: `node test_modem.mjs <distance m> <symbol ms> [talk] [passes]`

## Lineage

- Mercury delay-line memory (EDSAC 1949, UNIVAC I): bits stored as sound
  pulses circulating in tubes, re-amplified each lap. Turing suggested gin
  as the medium (Wilkes, Turing Award lecture, 1967).
- Alvin Lucier, *I Am Sitting in a Room* (1969).
- yarrick/pingfs and Tom7's Harder Drive: storage that exists only in transit.
- mame/quine-relay: programs whose output is their own source.
- ggwave: data over sound (this piece uses its own, deliberately fragile modem).

## Readings it is in conversation with

- Kittler: "there is no software" — here the software is literally air.
- McLuhan: the content of a medium is another medium; this program's content
  is the program, and the room is the message.
- Ihde: a background relation forced into the foreground — the room you
  normally ignore becomes the machine.
- Manovich: numerical representation and transcoding, made audible.
- Mitchell & Hansen: media as environment.
