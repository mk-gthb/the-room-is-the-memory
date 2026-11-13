import { P, encode, decode, simulateRoom, frameSeconds } from './modem.js';

const $ = id => document.getElementById(id);
const SEED = 'say("the medium is the message")';

const S = {
  running: false, stopAfter: false, gen: 0,
  bytes: null,          // what the loop just heard; the next pass encodes only this
  prev: null, ever: new Set(), log: [],
  ctx: null, micStream: null, micSource: null, analyser: null, recorder: null, recBuf: null,
};

// ---------- controls ----------
$('seed').value = SEED;
const ascii = s => Uint8Array.from([...s].map(c => { const k = c.charCodeAt(0); return k < 128 ? k : 63; }).slice(0, 255));
function seedInfo() {
  const n = ascii($('seed').value).length;
  P.symbolDur = +$('sym').value / 1000;
  $('seedInfo').textContent = `${n} characters · about ${frameSeconds(n).toFixed(1)} s per pass`;
}
for (const [id, fmt] of [['vol', v => v], ['dist', v => (+v).toFixed(1)], ['rt60', v => (+v).toFixed(2)], ['talk', v => v], ['sym', v => v]]) {
  const el = $(id), out = $(id + 'Val');
  const upd = () => { out.textContent = fmt(el.value); seedInfo(); };
  el.addEventListener('input', upd); upd();
}
$('seed').addEventListener('input', seedInfo);
const mode = () => document.querySelector('input[name=mode]:checked').value;
document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  $('realOpts').hidden = mode() !== 'real'; $('simOpts').hidden = mode() !== 'sim';
}));

async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const sel = $('micSel'), cur = sel.value;
    sel.innerHTML = '<option value="">default</option>' + devs.filter(d => d.kind === 'audioinput')
      .map(d => `<option value="${d.deviceId}">${d.label || 'microphone ' + d.deviceId.slice(0, 6)}</option>`).join('');
    sel.value = cur;
  } catch {}
}
listMics();

// ---------- audio ----------
async function ensureAudio() {
  if (!S.ctx) {
    S.ctx = new AudioContext({ sampleRate: 48000 });
    S.analyser = S.ctx.createAnalyser();
    S.analyser.fftSize = 4096; S.analyser.smoothingTimeConstant = 0;
    requestAnimationFrame(drawSpec);
  }
  await S.ctx.resume();
  if (mode() === 'real' && !S.micStream) {
    const id = $('micSel').value;
    S.micStream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: id ? { exact: id } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    listMics();
    S.micSource = S.ctx.createMediaStreamSource(S.micStream);
    S.micSource.connect(S.analyser);
    S.recorder = S.ctx.createScriptProcessor(4096, 1, 1);
    S.recorder.onaudioprocess = e => { if (S.recBuf) S.recBuf.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    const mute = S.ctx.createGain(); mute.gain.value = 0;
    S.micSource.connect(S.recorder); S.recorder.connect(mute); mute.connect(S.ctx.destination);
  }
}

function play(samples, toAnalyser) {
  return new Promise(res => {
    const buf = S.ctx.createBuffer(1, samples.length, S.ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = S.ctx.createBufferSource(); src.buffer = buf;
    src.connect(S.ctx.destination);
    if (toAnalyser) src.connect(S.analyser);
    src.onended = res; src.start();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const concat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Float32Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

async function passThroughRoom(bytes) {
  P.symbolDur = +$('sym').value / 1000;
  const sr = S.ctx.sampleRate;
  if (mode() === 'real') {
    const wave = encode(bytes, sr, (+$('vol').value / 100) * 0.9);
    S.recBuf = [];
    await play(wave, false);
    await wait(700);
    const rec = concat(S.recBuf); S.recBuf = null;
    setState('decoding');
    await wait(20);
    return decode(rec, sr, 2.5);
  }
  const heard = simulateRoom(encode(bytes, sr, 0.35), sr, {
    distance: +$('dist').value, rt60: +$('rt60').value, talk: +$('talk').value, noise: 0.01, coughsPerMin: 4, seed: (Date.now() % 1e6) + S.gen });
  const peak = heard.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
  await play(heard.map(v => v / peak * 0.5), true);
  setState('decoding');
  await wait(20);
  return decode(heard, sr, 2.5);
}

// ---------- running whatever survived ----------
const workerURL = URL.createObjectURL(new Blob([`
onmessage = e => {
  const out = [];
  const say = (...a) => { out.push(a.map(String).join(' ')); if (out.length > 200) throw new Error('said too much'); };
  try { (new Function('say', e.data))(say); postMessage({ ok: true, out }); }
  catch (err) { postMessage({ ok: false, out, err: err.name + ': ' + err.message }); }
};`], { type: 'text/javascript' }));

function runProgram(src) {
  return new Promise(res => {
    const w = new Worker(workerURL);
    const t = setTimeout(() => { w.terminate(); res({ ok: false, out: [], err: 'never finished' }); }, 500);
    w.onmessage = e => { clearTimeout(t); w.terminate(); res(e.data); };
    w.postMessage(src);
  });
}

// ---------- display ----------
const latin1 = b => Array.from(b, c => String.fromCharCode(c)).join('');
function setState(t) { $('state').textContent = t; }
function renderCode(bytes, prev) {
  const el = $('code'); el.innerHTML = '';
  bytes.forEach((c, i) => {
    const sp = document.createElement('span');
    const printable = c >= 32 && c < 127;
    sp.textContent = printable ? String.fromCharCode(c) : '·';
    if (!printable) { sp.classList.add('np'); sp.title = '0x' + c.toString(16).padStart(2, '0'); }
    if (prev && (i >= prev.length || prev[i] !== c)) sp.classList.add('m');
    else if (S.ever.has(i)) sp.classList.add('old');
    el.appendChild(sp);
  });
}
function renderOut(r) {
  const el = $('out');
  el.className = 'out' + (r.ok ? '' : ' dead');
  el.textContent = r.out.join('\n') + (r.ok ? '' : (r.out.length ? '\n' : '') + r.err);
}
function addLog(entry) {
  S.log.push(entry);
  const tr = document.createElement('tr');
  const outText = entry.lost ? entry.lost : entry.ok ? entry.out.join(' / ') : entry.err;
  [entry.gen, entry.lost ? '—' : entry.changed, entry.lost ? 'lost' : entry.ok ? 'yes' : 'no', outText.slice(0, 140)]
    .forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
  $('log').querySelector('tbody').prepend(tr);
  $('dlBtn').disabled = false;
}

// ---------- main loop ----------
async function start() {
  try { await ensureAudio(); }
  catch (e) { setState('no microphone (' + e.message + '). Try the simulated room.'); return; }
  if (!S.bytes) { S.bytes = ascii($('seed').value); S.gen = 0; S.prev = null; S.ever.clear(); renderCode(S.bytes, null); }
  S.running = true; S.stopAfter = false;
  $('startBtn').disabled = true; $('stopBtn').disabled = false; $('resetBtn').disabled = true; $('seed').disabled = true;

  while (S.running) {
    $('gen').textContent = `Pass ${S.gen + 1}`;
    setState('playing');
    const sent = S.bytes;
    S.bytes = null;                                   // from here on, only the room has it
    const r = await passThroughRoom(sent);

    if (!r.ok) {
      setState('lost');
      $('code').textContent = '';
      $('out').className = 'out dead';
      $('out').textContent = `Couldn't decode pass ${S.gen + 1} (${r.reason}). The code is gone.`;
      addLog({ gen: S.gen + 1, lost: 'lost: ' + r.reason, t: new Date().toISOString() });
      break;
    }
    S.gen++;
    const changed = [];
    r.bytes.forEach((c, i) => { if (i >= sent.length || sent[i] !== c) changed.push(i); });
    const changedCount = changed.length + Math.max(0, sent.length - r.bytes.length);
    changed.forEach(i => S.ever.add(i));
    S.bytes = r.bytes;

    $('gen').textContent = `Pass ${S.gen}`;
    renderCode(S.bytes, sent);
    setState('running');
    const res = await runProgram(latin1(S.bytes));
    renderOut(res);
    addLog({ gen: S.gen, changed: changedCount, ok: res.ok, out: res.out, err: res.err || '', code: latin1(S.bytes), t: new Date().toISOString() });
    setState(changedCount ? `${changedCount} character${changedCount > 1 ? 's' : ''} changed` : 'no change');

    if (S.stopAfter) break;
    await wait(600);
  }
  S.running = false;
  $('startBtn').disabled = !S.bytes; $('stopBtn').disabled = true; $('resetBtn').disabled = false;
  if (S.bytes) $('startBtn').textContent = 'Continue';
}

$('startBtn').onclick = start;
$('stopBtn').onclick = () => { S.stopAfter = true; setState('stopping after this pass'); };
$('resetBtn').onclick = () => {
  S.bytes = null; S.gen = 0; S.ever.clear();
  $('seed').disabled = false; $('startBtn').disabled = false; $('startBtn').textContent = 'Start';
  $('gen').textContent = 'Pass —'; setState('idle'); $('code').textContent = ''; $('out').textContent = '';
};
$('dlBtn').onclick = () => {
  const text = S.log.map(e => e.lost
    ? `Pass ${e.gen}  ${e.t}\n${e.lost}\n`
    : `Pass ${e.gen}  ${e.t}  changed ${e.changed}  ${e.ok ? 'runs' : 'does not run'}\n${e.code}\n> ${e.ok ? e.out.join('\n> ') : e.err}\n`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `telephone-log-${new Date().toISOString().slice(0, 19)}.txt`; a.click();
};

// ---------- spectrogram ----------
const spec = $('spec'), sctx = spec.getContext('2d');
let freq = null;
function drawSpec() {
  const W = Math.floor(spec.clientWidth), H = spec.height;
  if (spec.width !== W) { spec.width = W; sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, W, H); }
  if (S.analyser) {
    if (!freq) freq = new Float32Array(S.analyser.frequencyBinCount);
    S.analyser.getFloatFrequencyData(freq);
    sctx.drawImage(spec, -1, 0);
    const binHz = S.ctx.sampleRate / S.analyser.fftSize, lo = 1000, hi = 4500;
    const img = sctx.createImageData(1, H);
    for (let y = 0; y < H; y++) {
      const f = hi - (hi - lo) * y / H, db = freq[Math.round(f / binHz)];
      const v = Math.max(0, Math.min(1, (db + 100) / 70));
      const g = Math.round(255 * (1 - v));
      img.data.set([g, g, g, 255], y * 4);
    }
    sctx.putImageData(img, W - 1, 0);
  }
  requestAnimationFrame(drawSpec);
}
