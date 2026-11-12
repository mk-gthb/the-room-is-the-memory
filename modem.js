// 16-tone FSK modem, deliberately without error correction on the body.
// Only the length header is repeated (3x, majority vote) so the frame can be
// found; every other byte is exposed to the room.
//
// frame = preamble (8 symbols) | length x3 (6 symbols) | body (2 symbols/byte)

// symbolDur is the piece's main dial: long symbols integrate over more time
// and the program survives; short symbols let the room's reverb and voices in.
export const P = {
  symbolDur: 0.055,
  guardDur: 0.004,
  f0: 1500,
  df: 150,
  nTones: 16,
  preamble: [0, 15, 0, 15, 3, 12, 3, 12],
  headerRepeats: 3,
};

const symLen = sr => Math.round((P.symbolDur + P.guardDur) * sr);
const toneFreq = k => P.f0 + k * P.df;

export function symbolsFor(bytes) {
  const s = [...P.preamble];
  const L = bytes.length;
  for (let r = 0; r < P.headerRepeats; r++) s.push(L >> 4, L & 15);
  for (const b of bytes) s.push(b >> 4, b & 15);
  return s;
}

export function frameSeconds(nBytes) {
  return (P.preamble.length + 2 * P.headerRepeats + 2 * nBytes) * (P.symbolDur + P.guardDur);
}

export function encode(bytes, sr, amp = 0.5) {
  const syms = symbolsFor(bytes);
  const N = symLen(sr), on = Math.round(P.symbolDur * sr), ramp = Math.round(Math.min(0.004, P.symbolDur * 0.1) * sr);
  const out = new Float32Array(syms.length * N + Math.round(0.25 * sr));
  syms.forEach((k, i) => {
    const w = 2 * Math.PI * toneFreq(k) / sr, base = i * N;
    for (let n = 0; n < on; n++) {
      const e = n < ramp ? n / ramp : n > on - ramp ? (on - n) / ramp : 1;
      out[base + n] = amp * e * Math.sin(w * n);
    }
  });
  return out;
}

function goertzel(x, start, len, f, sr) {
  const c = 2 * Math.cos(2 * Math.PI * f / sr);
  let s1 = 0, s2 = 0;
  for (let n = 0; n < len; n++) { const s = x[start + n] + c * s1 - s2; s2 = s1; s1 = s; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

function window_(sr) {
  const on = Math.round(P.symbolDur * sr);
  const skip = Math.round(Math.min(0.008, P.symbolDur * 0.15) * sr);   // let the previous symbol's reverb die a little
  return { skip, len: on - skip - Math.round(Math.min(0.004, P.symbolDur * 0.08) * sr) };
}

function detect(x, start, sr) {
  const { skip, len } = window_(sr);
  if (start + skip + len > x.length) return null;
  let best = -1, bk = 0, sum = 0;
  for (let k = 0; k < P.nTones; k++) {
    const e = goertzel(x, start + skip, len, toneFreq(k), sr);
    sum += e; if (e > best) { best = e; bk = k; }
  }
  return { k: bk, conf: sum > 0 ? best / sum : 0 };
}

function preambleScore(x, off, sr) {
  const N = symLen(sr), { skip, len } = window_(sr), tones = [0, 3, 12, 15];
  let score = 0;
  for (let i = 0; i < P.preamble.length; i++) {
    const s = off + i * N + skip;
    let want = 0, tot = 1e-12;
    for (const k of tones) { const e = goertzel(x, s, len, toneFreq(k), sr); tot += e; if (k === P.preamble[i]) want = e; }
    score += want / tot;
  }
  return score / P.preamble.length;
}

export function decode(x, sr, searchSeconds = 1.5) {
  const N = symLen(sr);
  const maxOff = Math.min(x.length - N * (P.preamble.length + 2 * P.headerRepeats), Math.round(searchSeconds * sr));
  if (maxOff < 0) return { ok: false, reason: 'recording too short' };

  let bestOff = 0, bestScore = -1;
  const coarse = Math.round(0.004 * sr);
  for (let off = 0; off <= maxOff; off += coarse) {
    const sc = preambleScore(x, off, sr);
    if (sc > bestScore) { bestScore = sc; bestOff = off; }
  }
  const fine = Math.max(1, Math.round(0.0005 * sr));
  for (let off = Math.max(0, bestOff - coarse); off <= Math.min(maxOff, bestOff + coarse); off += fine) {
    const sc = preambleScore(x, off, sr);
    if (sc > bestScore) { bestScore = sc; bestOff = off; }
  }
  if (bestScore < 0.55) return { ok: false, reason: 'no frame heard', preambleScore: bestScore };

  let pos = bestOff + P.preamble.length * N;
  const lens = [];
  for (let r = 0; r < P.headerRepeats; r++) {
    const hi = detect(x, pos, sr), lo = detect(x, pos + N, sr); pos += 2 * N;
    if (hi && lo) lens.push((hi.k << 4) | lo.k);
  }
  const counts = {};
  lens.forEach(l => counts[l] = (counts[l] || 0) + 1);
  const L = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  if (!L) return { ok: false, reason: 'length unreadable', preambleScore: bestScore };

  const bytes = [], conf = [];
  for (let i = 0; i < L; i++) {
    const hi = detect(x, pos, sr), lo = detect(x, pos + N, sr); pos += 2 * N;
    if (!hi || !lo) break;
    bytes.push((hi.k << 4) | lo.k); conf.push(Math.min(hi.conf, lo.conf));
  }
  return { ok: true, bytes: Uint8Array.from(bytes), conf, L, offset: bestOff, preambleScore: bestScore };
}

// A cheap stand-in for a real room: Schroeder comb reverb, hiss, coughs,
// people talking (harmonic, gliding, syllabic — the thing that actually lands
// in the modem's band), and latency.
//   rt60     seconds for the room's ring to fall 60 dB (classroom ≈ 0.5–0.9)
//   distance metres from speaker to mic; the direct sound falls off as 1/d
//            while the reverberant field stays roughly constant
export function simulateRoom(x, sr, { noise = 0.02, rt60 = 0.6, distance = 1, coughsPerMin = 4, talk = 0, seed = Date.now() } = {}) {
  let s = seed % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

  const lat = Math.round((0.05 + rand() * 0.25) * sr + distance / 343 * sr);
  const tail = Math.round(Math.min(rt60, 1.5) * sr);
  const y = new Float32Array(x.length + lat + tail);
  const direct = 1 / Math.max(distance, 0.1);
  for (let n = 0; n < x.length; n++) y[n + lat] = x[n] * direct;

  // 8-line feedback delay network, Householder mixing
  const D = [1031, 1327, 1523, 1801, 2053, 2311, 2633, 2939].map(d => Math.round(d * sr / 44100));
  const g = D.map(d => Math.pow(10, -3 * d / sr / Math.max(rt60, 0.05)));
  const lines = D.map(d => new Float32Array(d)), idx = D.map(() => 0);
  const wetGain = 0.22, out = new Float32Array(8);
  for (let n = 0; n < y.length; n++) {
    const xin = n >= lat && n - lat < x.length ? x[n - lat] : 0;
    let sum = 0;
    for (let i = 0; i < 8; i++) { out[i] = lines[i][idx[i]]; sum += out[i]; }
    const h = sum * 0.25;
    for (let i = 0; i < 8; i++) {
      lines[i][idx[i]] = g[i] * (out[i] - h) + xin * 0.35;
      idx[i] = (idx[i] + 1) % D[i];
    }
    y[n] += wetGain * sum + noise * gauss();
  }

  const seconds = y.length / sr, nCoughs = Math.round(coughsPerMin * seconds / 60 + rand() * 0.8);
  for (let c = 0; c < nCoughs; c++) {
    const at = Math.floor(rand() * (y.length - 0.3 * sr)), len = Math.round((0.08 + rand() * 0.2) * sr);
    let lp = 0;
    for (let n = 0; n < len; n++) {
      lp = 0.6 * lp + 0.4 * gauss();
      y[at + n] += 0.35 * lp * Math.sin(Math.PI * n / len);
    }
  }

  // talk: 0 = silent room, 1 = someone talking about half the time, 2+ = a crowd
  let t = 0;
  while (talk > 0 && t < seconds) {
    t += (0.4 + rand() * 2.5) / talk;
    const dur = 0.5 + rand() * 2.5, start = Math.floor(t * sr), len = Math.min(Math.round(dur * sr), y.length - start);
    if (len <= 0) break;
    const f0a = 95 + rand() * 160, f0b = f0a * (0.8 + rand() * 0.45), loud = 0.5 + rand() * 0.9, syl = 3 + rand() * 3;
    let ph = 0;
    for (let n = 0; n < len; n++) {
      const u = n / len, f0 = f0a + (f0b - f0a) * u;
      ph += 2 * Math.PI * f0 / sr;
      const env = Math.abs(Math.sin(Math.PI * syl * n / sr)) * Math.sin(Math.PI * u);
      let v = 0;
      for (let h = 1; h <= 32; h++) v += Math.sin(h * ph) / Math.pow(h, 0.6);
      y[start + n] += loud * env * v * 0.25;
    }
    t += dur;
  }
  return y;
}
