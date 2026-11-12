import { P, encode, decode, simulateRoom, frameSeconds } from './modem.js';

// usage: node test_modem.mjs <distance m> <symbol ms> [talk] [generations]
const sr = 48000;
const seed = 'say("I am a program kept in the air of the room you are in now. Each time I pass through it, I am rewritten by it.")';
const distance = +(process.argv[2] || 2.5), sym = +(process.argv[3] || 40) / 1000;
const talk = +(process.argv[4] || 1), gens = +(process.argv[5] || 8);
P.symbolDur = sym;

let bytes = new TextEncoder().encode(seed);
const changes = [];
for (let gen = 1; gen <= gens; gen++) {
  const wave = simulateRoom(encode(bytes, sr, 0.35), sr, { noise: 0.01, talk, rt60: 0.7, distance, coughsPerMin: 4, seed: gen * 7919 + distance * 101 });
  const r = decode(wave, sr);
  if (!r.ok) { changes.push('LOST'); break; }
  let d = Math.abs(bytes.length - r.bytes.length);
  for (let i = 0; i < Math.min(bytes.length, r.bytes.length); i++) if (bytes[i] !== r.bytes[i]) d++;
  changes.push(d);
  bytes = r.bytes;
}
console.log(`${distance}m ${sym * 1000}ms talk ${talk} (${frameSeconds(seed.length).toFixed(1)}s/pass): [${changes.join(', ')}]`);
console.log('  ' + new TextDecoder('latin1').decode(bytes));
