// Sound: per-item processing (speed with pitch kept, voice effects, noise reduction) and mixing.
import { audioCtx, audioNow, decodeAudio } from './media.js';
import { sfxBuffer } from './sfx.js';
import { Biquad } from './sfx.js';
import { srcTime, srcLen, kfVal, hasSound, curveMean } from './model.js';
import { clamp } from './util.js';

export const VOICES = [
  ['none', 'None'], ['deep', 'Deep'], ['high', 'High'], ['tiny', 'Tiny'], ['giant', 'Giant'], ['robot', 'Robot'], ['alien', 'Alien'],
  ['echo', 'Echo'], ['hall', 'Hall'], ['room', 'Room'], ['cave', 'Cave'], ['radio', 'Radio'], ['phone', 'Phone'], ['megaphone', 'Megaphone'], ['underwater', 'Underwater'], ['monster', 'Monster'],
];

/* ---------- FFT (radix-2, in place) ---------- */
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/* ---------- noise reduction: spectral gating with a learned noise floor ---------- */
export function denoise(chans, sr, strength = 0.7) {
  const N = 2048, H = N / 4, win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return chans.map(x => {
    const frames = Math.max(1, Math.ceil((x.length - N) / H) + 1), bins = N / 2 + 1;
    const mags = new Float32Array(frames * bins), energy = new Float32Array(frames);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let f = 0; f < frames; f++) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < N; i++) re[i] = (x[f * H + i] || 0) * win[i];
      fft(re, im);
      let e = 0; for (let b = 0; b < bins; b++) { const m = Math.hypot(re[b], im[b]); mags[f * bins + b] = m; e += m * m; }
      energy[f] = e;
    }
    // noise profile: average spectrum of the quietest 10% of the audio
    const order = [...energy.keys()].sort((a, b) => energy[a] - energy[b]), q = order.slice(0, Math.max(1, Math.floor(frames * 0.1)));
    const noise = new Float32Array(bins);
    for (const f of q) for (let b = 0; b < bins; b++) noise[b] += mags[f * bins + b] / q.length;
    const out = new Float32Array(x.length), norm = new Float32Array(x.length), gPrev = new Float32Array(bins).fill(1);
    const thr = 1.4 + strength * 2.2, floor = 1 - strength * 0.92;
    for (let f = 0; f < frames; f++) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < N; i++) re[i] = (x[f * H + i] || 0) * win[i];
      fft(re, im);
      for (let b = 0; b < bins; b++) {
        const m = mags[f * bins + b], target = m > noise[b] * thr ? 1 : Math.max(floor, Math.pow(m / (noise[b] * thr + 1e-9), 2));
        const g = target > gPrev[b] ? target : gPrev[b] * 0.7 + target * 0.3; gPrev[b] = g;
        re[b] *= g; im[b] *= g; if (b > 0 && b < N / 2) { re[N - b] = re[b]; im[N - b] = -im[b]; }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) { const j = f * H + i; if (j < out.length) { out[j] += re[i] * win[i]; norm[j] += win[i] * win[i]; } }
    }
    for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
    return out;
  });
}

/* ---------- time stretch that keeps pitch (WSOLA) ---------- */
export function stretch(chans, sr, rate) {
  if (Math.abs(rate - 1) < 0.001) return chans.map(c => c.slice());
  const W = Math.round(sr * 0.04), Ha = W / 2, tol = Math.round(sr * 0.012), win = new Float32Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W);
  const inLen = chans[0].length, outLen = Math.floor(inLen / rate), out = chans.map(() => new Float32Array(outLen + W)), norm = new Float32Array(outLen + W);
  const ref = chans[0]; let prevPos = 0;
  for (let o = 0; o < outLen; o += Ha) {
    const ideal = Math.round(o * rate);
    // best match with the natural continuation of the previous segment
    let best = ideal, bestScore = -Infinity;
    if (o > 0) {
      const nat = prevPos + Ha;
      for (let d = -tol; d <= tol; d += 2) {
        const p = ideal + d; if (p < 0 || p + W >= inLen) continue;
        let s = 0; for (let i = 0; i < W; i += 8) s += ref[p + i] * ref[nat + i] || 0;
        if (s > bestScore) { bestScore = s; best = p; }
      }
    }
    best = clamp(best, 0, Math.max(0, inLen - W - 1)); prevPos = best;
    for (let c = 0; c < chans.length; c++) { const x = chans[c], y = out[c]; for (let i = 0; i < W; i++) y[o + i] += (x[best + i] || 0) * win[i]; }
    for (let i = 0; i < W; i++) norm[o + i] += win[i];
  }
  return out.map(y => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) r[i] = norm[i] > 0.05 ? y[i] / norm[i] : y[i]; return r; });
}
// plain resample (changes pitch with speed). `rateFn(i)` gives source step per output sample.
function resampleVar(chans, outLen, posAt) {
  return chans.map(x => { const y = new Float32Array(outLen); for (let i = 0; i < outLen; i++) { const p = posAt(i), j = Math.floor(p), f = p - j; y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f; } return y; });
}
function pitchShift(chans, sr, semis) {
  const f = Math.pow(2, semis / 12), st = stretch(chans, sr, 1 / f), n = chans[0].length;
  return resampleVar(st, n, i => i * f);
}

/* ---------- voice effects (offline) ---------- */
function impulse(ctx, secs, decay, seed = 3) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}
function curveDist(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }

async function voiceFx(chans, sr, id) {
  if (!id || id === 'none') return chans;
  const pitch = { deep: -4, high: 4, tiny: 8, giant: -8, monster: -10 }[id];
  if (pitch) chans = pitchShift(chans, sr, pitch);
  const tail = { echo: 1.5, hall: 3, room: 0.8, cave: 3.5 }[id] || 0;
  const len = chans[0].length + Math.floor(tail * sr);
  const ctx = new OfflineAudioContext(2, len, sr), buf = ctx.createBuffer(2, chans[0].length, sr);
  buf.copyToChannel(chans[0], 0); buf.copyToChannel(chans[1] || chans[0], 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  let last = src;
  const chain = (...nodes) => { for (const n of nodes) { last.connect(n); last = n; } };
  const bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const shaper = k => { const w = ctx.createWaveShaper(); w.curve = curveDist(k); w.oversample = '2x'; return w; };
  const wetDry = (wetNode, wet) => { const dry = ctx.createGain(), w = ctx.createGain(); dry.gain.value = 1; w.gain.value = wet; last.connect(dry); last.connect(wetNode); wetNode.connect(w); const m = ctx.createGain(); dry.connect(m); w.connect(m); last = m; };
  switch (id) {
    case 'robot': case 'alien': {
      const osc = ctx.createOscillator(); osc.frequency.value = id === 'robot' ? 55 : 320; osc.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0; osc.connect(g.gain); osc.start(); chain(g); if (id === 'robot') chain(bq('highpass', 120));
      break;
    }
    case 'echo': case 'cave': {
      const d = ctx.createDelay(2), fb = ctx.createGain(); d.delayTime.value = id === 'echo' ? 0.28 : 0.42; fb.gain.value = id === 'echo' ? 0.42 : 0.55; d.connect(fb); fb.connect(d);
      wetDry(d, 0.55);
      if (id === 'cave') { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, 3, 2.5); wetDry(cv, 0.35); }
      break;
    }
    case 'hall': case 'room': { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, id === 'hall' ? 2.8 : 0.7, id === 'hall' ? 2.2 : 3); wetDry(cv, id === 'hall' ? 0.45 : 0.3); break; }
    case 'radio': chain(bq('highpass', 450), bq('lowpass', 3000), shaper(8), bq('peaking', 1500, 1)); break;
    case 'phone': chain(bq('highpass', 330, 1), bq('lowpass', 3300, 1), shaper(3)); break;
    case 'megaphone': chain(bq('highpass', 650, 1), bq('lowpass', 4000, 1), shaper(30)); { const g = ctx.createGain(); g.gain.value = 0.5; chain(g); } break;
    case 'underwater': chain(bq('lowpass', 480, 2)); { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, 1, 3); wetDry(cv, 0.4); } break;
    case 'monster': chain(shaper(4), bq('lowpass', 2500)); break;
  }
  last.connect(ctx.destination); src.start();
  const r = await ctx.startRendering();
  return [r.getChannelData(0), r.getChannelData(1)];
}

function enhance(chans, sr) {
  return chans.map(x => {
    const hp = new Biquad('hp', 85, 0.7, sr), pr = new Biquad('peak', 3200, 0.9, sr, 4), lo = new Biquad('peak', 250, 1, sr, -2.5), y = new Float32Array(x.length);
    let env = 0; const att = Math.exp(-1 / (0.003 * sr)), rel = Math.exp(-1 / (0.15 * sr));
    for (let i = 0; i < x.length; i++) {
      let v = pr.run(lo.run(hp.run(x[i])));
      const a = Math.abs(v); env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
      const g = env > 0.2 ? Math.pow(0.2 / env, 0.6) : 1; y[i] = v * g * 1.6;
    }
    return y;
  });
}

/* ---------- per-item processed buffers ---------- */
const done = new Map(), busy = new Map();
function procKey(it) { return JSON.stringify([it.mid || it.sfx?.id, it.sfx?.seed, it.sfx?.off, it.in, +srcLen(it).toFixed(4), it.dur.toFixed(4), it.speed, it.curve, it.keepPitch, it.voice, it.denoise, it.enhance, it.reverse]); }
const needsProc = it => (it.speed || 1) !== 1 || it.curve?.length || (it.voice && it.voice !== 'none') || it.denoise > 0 || it.enhance;

// the raw sound behind an item (media audio or generated effect), whole length
function rawBuffer(it, p, ctx) {
  if (it.sfx) return sfxBuffer(ctx || audioCtx(), it.sfx.id, (it.sfx.off || 0) + it.dur + 0.5, it.sfx.seed || 1);
  return audioNow(it.mid);
}
// processed buffer covering exactly the item (offset 0 = item start) or null while working
export function itemBuffer(it, p, ctx) {
  const raw = rawBuffer(it, p, ctx);
  if (!raw) return null;
  if (!needsProc(it)) return { buf: raw, off: it.sfx ? (it.sfx.off || 0) : it.in, rate: 1, direct: true };
  const key = procKey(it);
  if (done.has(key)) return { buf: done.get(key), off: 0, rate: 1 };
  if (!busy.has(key)) busy.set(key, process(it, raw).then(b => { done.set(key, b); busy.delete(key); if (done.size > 30) done.delete(done.keys().next().value); return b; }).catch(e => { console.warn(e); busy.delete(key); }));
  // meanwhile: play the raw sound with a playback rate (pitch changes until ready)
  return { buf: raw, off: it.sfx ? (it.sfx.off || 0) : it.in, rate: it.speed || 1, direct: true, pending: true };
}
export async function itemBufferReady(it, p) {
  const r = itemBuffer(it, p);
  if (!r?.pending) return r;
  await busy.get(procKey(it));
  return itemBuffer(it, p);
}
async function process(it, raw) {
  await new Promise(r => setTimeout(r, 0));
  const sr = raw.sampleRate, off = it.sfx ? (it.sfx.off || 0) : it.in, len = srcLen(it);
  const a = Math.floor(off * sr), b = Math.min(raw.length, Math.ceil((off + len) * sr));
  let ch = [...Array(Math.min(2, raw.numberOfChannels))].map((_, c) => raw.getChannelData(c).slice(a, b));
  if (ch.length === 1) ch.push(ch[0]);
  if (it.denoise > 0) ch = denoise(ch, sr, it.denoise);
  if (it.enhance) ch = enhance(ch, sr);
  const outLen = Math.max(1, Math.round(it.dur * sr));
  if (it.curve?.length) {
    // varying speed: follow the clip's time map (pitch follows speed, like a tape)
    ch = resampleVar(ch, outLen, i => (srcTime(it, i / sr) - it.in) * sr);
  } else if ((it.speed || 1) !== 1) {
    ch = it.keepPitch !== false ? stretch(ch, sr, it.speed) : resampleVar(ch, outLen, i => i * it.speed);
  }
  ch = await voiceFx(ch, sr, it.voice);
  const ac = audioCtx(), n = ch[0].length, buf = ac.createBuffer(2, n, sr);
  buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1] || ch[0], 1);
  return buf;
}

/* ---------- scheduling (same code for live preview and for export) ---------- */
// schedules every audible item between timeline time `from` and `to`, starting at ctx time `when`.
export function schedule(ctx, dest, p, from, when, opts = {}) {
  const nodes = [];
  for (const it of p.items) {
    if (!hasSound(it, p) || it.mute) continue;
    if (it.track === 'main' && p.muteMain) continue;
    if (it.start + it.dur <= from || it.hidden) continue;
    if (opts.skip?.(it)) continue;
    const r = itemBuffer(it, p, ctx);
    if (!r || (opts.final && r.pending)) continue;
    const src = ctx.createBufferSource(); src.buffer = r.buf;
    const lt0 = Math.max(0, from - it.start), at = when + Math.max(0, it.start - from);
    const rate = r.rate; src.playbackRate.value = rate;
    const g = ctx.createGain();
    // volume (keyframes), fades
    const vol = t => clamp(kfVal(it, 'vol', t), 0, 4);
    const fi = it.fadeIn || 0, fo = it.fadeOut || 0;
    const env = t => vol(t) * (fi > 0 ? clamp(t / fi, 0, 1) : 1) * (fo > 0 ? clamp((it.dur - t) / fo, 0, 1) : 1);
    const step = 0.05;
    g.gain.setValueAtTime(env(lt0), at);
    if (fi || fo || it.kf?.vol?.length) for (let t = lt0 + step; t < it.dur; t += step) g.gain.linearRampToValueAtTime(env(t), at + (t - lt0));
    src.connect(g); g.connect(dest);
    const offset = r.off + (r.direct && !r.pending ? lt0 : r.direct ? lt0 * rate : lt0);
    const len = it.dur - lt0;
    try { src.start(at, Math.max(0, offset), Math.max(0.001, len * (r.pending ? rate : 1))); } catch (e) { continue; }
    nodes.push({ src, g, it });
  }
  return nodes;
}

// renders the whole mix (export, audio-only save)
export async function mixdown(p, from, to, sr = 48000, onProgress) {
  // make sure every item's sound is ready
  const items = p.items.filter(i => hasSound(i, p) && !i.mute && !(i.track === 'main' && p.muteMain) && i.start < to && i.start + i.dur > from);
  let k = 0;
  for (const it of items) {
    if (it.mid) { const m = p.media[it.mid]; if (m) await decodeAudio(m); }
    await itemBufferReady(it, p);
    onProgress?.(++k / Math.max(1, items.length));
  }
  const len = Math.max(1, Math.ceil((to - from) * sr));
  const ctx = new OfflineAudioContext(2, len, sr);
  const master = ctx.createDynamicsCompressor(); master.threshold.value = -3; master.knee.value = 3; master.ratio.value = 12; master.attack.value = 0.002; master.release.value = 0.12;
  master.connect(ctx.destination);
  schedule(ctx, master, p, from, 0, { final: true });
  return ctx.startRendering();
}

// encodes an AudioBuffer as a 16-bit WAV file
export function wavBlob(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, clamp(data[c][i], -1, 1) * 32767, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

// loudness helper: gain that brings the item to a steady speaking level
export function normalizeGain(it, p) {
  const r = itemBuffer(it, p); if (!r) return 1;
  const b = r.buf, d = b.getChannelData(0), sr = b.sampleRate, a = Math.floor(r.off * sr), e = Math.min(d.length, a + Math.floor(srcLen(it) * sr));
  let s = 0, n = 0; for (let i = a; i < e; i += 4) { s += d[i] * d[i]; n++; }
  const rms = Math.sqrt(s / Math.max(1, n));
  return rms > 1e-4 ? clamp(0.12 / rms, 0.2, 4) : 1;
}
export { curveMean };
