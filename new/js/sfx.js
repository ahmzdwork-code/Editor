// Sound effects, made from scratch with code (no recordings, no music, no instruments).
// Every effect is a function that fills sample arrays; ambient ones can be any length.

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); }; }

class Biquad {
  constructor(type, f, q, sr, gainDb = 0) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, sr, gainDb); }
  set(type, f, q, sr, gainDb = 0) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.49) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; } // peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
export { Biquad };

function pinkGen(r) { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; return () => { const w = r() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; return o * 0.11; }; }
function brownGen(r) { let l = 0; return () => { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; return l * 3.5; }; }
// smooth random curve (for gusts, swells)
function slowGen(r, rate, sr) { let a = r(), b = r(), ph = 0; const inc = rate / sr; return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = r(); } const t = ph * ph * (3 - 2 * ph); return a + (b - a) * t; }; }

const mk = (sr, dur) => [new Float32Array(Math.ceil(sr * dur)), new Float32Array(Math.ceil(sr * dur))];
function addMono(out, sig, at, pan = 0) { const L = out[0], R = out[1], gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4); for (let i = 0; i < sig.length; i++) { const j = at + i; if (j >= L.length) break; if (j < 0) continue; L[j] += sig[i] * gl * 1.41; R[j] += sig[i] * gr * 1.41; } }
function burst(sr, dur, r, { f = 3000, q = 1.2, decay = 0.004, type = 'bp', amp = 1, attack = 0.0004 } = {}) {
  const n = Math.ceil(sr * dur), s = new Float32Array(n), bq = new Biquad(type, f, q, sr);
  for (let i = 0; i < n; i++) { const t = i / sr, env = Math.min(1, t / attack) * Math.exp(-t / decay); s[i] = bq.run(r() * 2 - 1) * env * amp; }
  return s;
}
function tone(sr, dur, f0, f1, { decay = 0.05, amp = 1, attack = 0.001, shape = 'sine', curve = 'exp' } = {}) {
  const n = Math.ceil(sr * dur), s = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = t / dur, f = curve === 'exp' ? f0 * Math.pow(f1 / f0, Math.min(1, k * 1.0)) : f0 + (f1 - f0) * k;
    ph += 2 * Math.PI * f / sr;
    const w = shape === 'square' ? Math.sign(Math.sin(ph)) * 0.6 : shape === 'saw' ? ((ph / Math.PI) % 2) - 1 : Math.sin(ph);
    s[i] = w * Math.min(1, t / attack) * Math.exp(-t / decay) * amp;
  }
  return s;
}
function resonate(sig, sr, freqs, q = 30, mix = 0.5) {
  const fs = freqs.map(f => new Biquad('bp', f, q, sr)); const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) { let y = 0; for (const b of fs) y += b.run(sig[i]); out[i] = sig[i] * (1 - mix) + y * mix * 3; }
  return out;
}
function reverb(out, sr, time = 0.6, wet = 0.25, seed = 7) {
  // a few feedback-delay lines: enough to give a small space
  const r = rng(seed), lines = [0.0297, 0.0371, 0.0411, 0.0437, 0.053].map(d => Math.round(d * sr * (0.9 + r() * 0.2)));
  for (const ch of out) {
    const dry = ch.slice(); const bufs = lines.map(n => ({ b: new Float32Array(n), i: 0, g: Math.pow(0.001, (n / sr) / time) }));
    for (let i = 0; i < ch.length; i++) {
      let y = 0; for (const d of bufs) { const v = d.b[d.i]; y += v; d.b[d.i] = dry[i] + v * d.g * 0.98; d.i = (d.i + 1) % d.b.length; }
      ch[i] = dry[i] + y * wet / lines.length;
    }
  }
}
function normalize(out, peak = 0.89) {
  let m = 0; for (const c of out) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m > 0) { const k = peak / m; for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= k; }
  return out;
}
function fadeEdges(out, sr, a = 0.01, b = 0.02) { for (const c of out) { const na = Math.floor(a * sr), nb = Math.floor(b * sr); for (let i = 0; i < na && i < c.length; i++) c[i] *= i / na; for (let i = 0; i < nb && i < c.length; i++) c[c.length - 1 - i] *= i / nb; } return out; }

/* ---------- the effects ---------- */
const G = {
  click(sr, d, r) { const o = mk(sr, d); addMono(o, burst(sr, 0.02, r, { f: 3800, q: 1.5, decay: 0.0012 }), 0); addMono(o, burst(sr, 0.02, r, { f: 2600, q: 2, decay: 0.0009, amp: 0.55 }), Math.round(0.075 * sr)); return o; },
  dblclick(sr, d, r) { const o = mk(sr, d); for (const t of [0, 0.13]) { addMono(o, burst(sr, 0.02, r, { f: 3800, q: 1.5, decay: 0.0012 }), Math.round(t * sr)); addMono(o, burst(sr, 0.02, r, { f: 2600, q: 2, decay: 0.0009, amp: 0.5 }), Math.round((t + 0.06) * sr)); } return o; },
  tap(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, 0.06, 900, 380, { decay: 0.018, amp: 0.8 }), 0); addMono(o, burst(sr, 0.01, r, { f: 5000, decay: 0.0008, amp: 0.4 }), 0); return o; },
  toggle(sr, d, r) { const o = mk(sr, d); addMono(o, resonate(burst(sr, 0.03, r, { f: 2500, decay: 0.002 }), sr, [1800, 3100], 25, 0.6), 0); addMono(o, resonate(burst(sr, 0.03, r, { f: 3200, decay: 0.0015, amp: 0.7 }), sr, [2300, 4100], 25, 0.6), Math.round(0.012 * sr)); return o; },
  keys(sr, d, r) {
    const o = mk(sr, d); let t = 0.02;
    while (t < d - 0.12) {
      const f = 1800 + r() * 2500, big = r() < 0.08;
      addMono(o, burst(sr, 0.05, r, { f, q: 1.2, decay: big ? 0.006 : 0.003, amp: 0.6 + r() * 0.4 }), Math.round(t * sr), (r() - 0.5) * 0.5);
      addMono(o, tone(sr, 0.04, big ? 120 : 180, 90, { decay: 0.008, amp: 0.25 }), Math.round(t * sr));
      addMono(o, burst(sr, 0.03, r, { f: f * 0.8, decay: 0.002, amp: 0.3 }), Math.round((t + 0.045 + r() * 0.02) * sr));
      t += 0.07 + r() * 0.12 + (r() < 0.12 ? 0.25 : 0);
    }
    return o;
  },
  typewriter(sr, d, r) {
    const o = mk(sr, d); let t = 0.02;
    while (t < d - 0.15) {
      const s = resonate(burst(sr, 0.08, r, { f: 2200 + r() * 800, q: 1, decay: 0.005 }), sr, [1450, 2900, 4300], 40, 0.55);
      addMono(o, s, Math.round(t * sr), (r() - 0.5) * 0.4); addMono(o, tone(sr, 0.05, 140, 70, { decay: 0.012, amp: 0.4 }), Math.round(t * sr));
      t += 0.11 + r() * 0.13;
    }
    reverb(o, sr, 0.3, 0.12); return o;
  },
  shutter(sr, d, r) {
    const o = mk(sr, d);
    addMono(o, resonate(burst(sr, 0.03, r, { f: 1600, q: 1.4, decay: 0.004 }), sr, [1200, 2400], 20, 0.4), 0);
    addMono(o, tone(sr, 0.06, 220, 90, { decay: 0.012, amp: 0.5 }), 0);
    addMono(o, resonate(burst(sr, 0.06, r, { f: 3200, q: 1.1, decay: 0.009, amp: 0.9 }), sr, [2800, 5200], 18, 0.4), Math.round(0.055 * sr));
    addMono(o, tone(sr, 0.05, 160, 80, { decay: 0.01, amp: 0.35 }), Math.round(0.055 * sr));
    reverb(o, sr, 0.25, 0.1); return o;
  },
  shutterwind(sr, d, r) {
    const o = G.shutter(sr, d, r), n = Math.ceil(sr * 0.45), s = new Float32Array(n), lp = new Biquad('bp', 900, 0.8, sr);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr, env = Math.sin(Math.PI * Math.min(1, t / 0.45)); ph += 2 * Math.PI * (70 + 30 * t) / sr; s[i] = (lp.run(r() * 2 - 1) * 0.6 + Math.sign(Math.sin(ph)) * 0.08) * env * 0.5; }
    addMono(o, s, Math.round(0.14 * sr)); return o;
  },
  burstshots(sr, d, r) { const o = mk(sr, d); for (let k = 0; k < 4; k++) { const s = G.shutter(sr, 0.2, r); addMono(o, s[0], Math.round(k * 0.16 * sr)); } return o; },
  whoosh(sr, d, r) {
    const n = Math.ceil(sr * d), o = mk(sr, d), b = new Biquad('bp', 400, 1.1, sr), pk = pinkGen(r);
    for (let i = 0; i < n; i++) { const k = i / n, env = Math.pow(Math.sin(Math.PI * Math.pow(k, 0.8)), 2), f = 250 + 2600 * Math.sin(Math.PI * k) ** 2; if (i % 64 === 0) b.set('bp', f, 1.1, sr); const v = b.run(pk() * 3) * env; const pan = k * 2 - 1; o[0][i] = v * (1 - pan) * 0.7; o[1][i] = v * (1 + pan) * 0.7; }
    return o;
  },
  swish(sr, d, r) { return G.whoosh(sr, d, r); },
  riser(sr, d, r) {
    const n = Math.ceil(sr * d), o = mk(sr, d), b = new Biquad('bp', 200, 2, sr), b2 = new Biquad('bp', 300, 2, sr);
    for (let i = 0; i < n; i++) { const k = i / n, f = 200 * Math.pow(30, k); if (i % 64 === 0) { b.set('bp', f, 2, sr); b2.set('bp', f * 1.01, 2, sr); } const env = Math.pow(k, 1.6) * (k > 0.97 ? (1 - k) / 0.03 : 1); o[0][i] = b.run(r() * 2 - 1) * env; o[1][i] = b2.run(r() * 2 - 1) * env; }
    return o;
  },
  downer(sr, d, r) { const o = G.riser(sr, d, r); for (const c of o) c.reverse(); return o; },
  pop(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, 0.12, 900, 160, { decay: 0.035, amp: 0.9 }), 0); addMono(o, burst(sr, 0.01, r, { f: 2500, decay: 0.001, amp: 0.5 }), 0); return o; },
  bubble(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, 0.1, 280, 1400, { decay: 0.03, amp: 0.9 }), 0); return o; },
  drip(sr, d, r) {
    const o = mk(sr, d), gap = 0.75; let t = 0.05;
    while (t < d - 0.3) { addMono(o, tone(sr, 0.12, 700 + r() * 300, 1900 + r() * 500, { decay: 0.025, amp: 0.8, attack: 0.002 }), Math.round(t * sr), (r() - 0.5) * 0.3); t += gap * (0.8 + r() * 0.5); }
    reverb(o, sr, 1.2, 0.45); return o;
  },
  plop(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, 0.15, 500, 1600, { decay: 0.04, amp: 0.9, attack: 0.002 }), 0); reverb(o, sr, 0.8, 0.3); return o; },
  splash(sr, d, r) {
    const n = Math.ceil(sr * d), o = mk(sr, d), lp = new Biquad('lp', 6000, 0.7, sr), lp2 = new Biquad('lp', 6000, 0.7, sr);
    for (let i = 0; i < n; i++) { const t = i / sr, env = Math.min(1, t / 0.01) * Math.exp(-t / 0.25); if (i % 64 === 0) { lp.set('lp', 800 + 6000 * Math.exp(-t / 0.2), 0.7, sr); lp2.set('lp', 800 + 6000 * Math.exp(-t / 0.2), 0.7, sr); } o[0][i] = lp.run(r() * 2 - 1) * env; o[1][i] = lp2.run(r() * 2 - 1) * env; }
    for (let k = 0; k < 14; k++) addMono(o, tone(sr, 0.08, 600 + r() * 900, 1500 + r() * 1500, { decay: 0.015, amp: 0.25 }), Math.round((0.1 + r() * 0.6) * sr), r() * 2 - 1);
    return o;
  },
  glitch(sr, d, r) {
    const o = mk(sr, d), n = o[0].length; let i = 0;
    while (i < n) { const len = Math.floor(sr * (0.01 + r() * 0.06)), type = Math.floor(r() * 4), f = 80 + r() * 2000, a = 0.3 + r() * 0.5; let ph = 0;
      for (let j = 0; j < len && i < n; j++, i++) { ph += 2 * Math.PI * f / sr; let v = type === 0 ? Math.sign(Math.sin(ph)) : type === 1 ? r() * 2 - 1 : type === 2 ? Math.round(Math.sin(ph) * 3) / 3 : 0; o[0][i] = v * a; o[1][i] = v * a * (r() < 0.5 ? 1 : -1); } }
    return o;
  },
  static(sr, d, r) {
    const o = mk(sr, d), hp = new Biquad('hp', 1200, 0.7, sr);
    for (let i = 0; i < o[0].length; i++) { let v = hp.run(r() * 2 - 1) * 0.35; if (r() < 0.002) v += (r() * 2 - 1); o[0][i] = v; o[1][i] = v; }
    return fadeEdges(o, sr, 0.03, 0.08);
  },
  beep(sr, d, r) { const o = mk(sr, d); const s = tone(sr, d, 1000, 1000, { decay: 1e9, amp: 0.6, attack: 0.004 }); for (let i = 0; i < 200; i++) s[s.length - 1 - i] *= i / 200; addMono(o, s, 0); return o; },
  buzz(sr, d, r) { const o = mk(sr, d), lp = new Biquad('lp', 1400, 0.8, sr); const s = tone(sr, d, 110, 110, { decay: 1e9, amp: 0.7, shape: 'square', attack: 0.004 }); for (let i = 0; i < s.length; i++) s[i] = lp.run(s[i]) * (i > s.length - 300 ? (s.length - i) / 300 : 1); addMono(o, s, 0); return o; },
  zap(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, d, 2400, 90, { decay: d * 0.5, amp: 0.6, shape: 'saw' }), 0); return o; },
  vibrate(sr, d, r) {
    const o = mk(sr, d), lp = new Biquad('lp', 400, 1, sr); let ph = 0;
    for (let i = 0; i < o[0].length; i++) { const t = i / sr, on = (t % 0.6) < 0.38 ? 1 : 0; ph += 2 * Math.PI * 165 / sr; const v = lp.run((Math.sin(ph) + 0.4 * Math.sign(Math.sin(ph * 0.5))) * on) * 0.8; o[0][i] = v; o[1][i] = v; }
    return o;
  },
  pageturn(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, b = new Biquad('bp', 2000, 0.7, sr);
    for (let i = 0; i < n; i++) { const k = i / n, env = Math.sin(Math.PI * k) ** 1.5 * (0.6 + 0.4 * (r() < 0.03 ? 1 : 0.5)); if (i % 64 === 0) b.set('bp', 1200 + 3000 * k, 0.7, sr); const v = b.run(r() * 2 - 1) * env; o[0][i] = v * (1.2 - k); o[1][i] = v * (0.2 + k); }
    const end = burst(sr, 0.05, r, { f: 1500, decay: 0.01, amp: 0.8, type: 'lp' }); addMono(o, end, Math.round(n * 0.82));
    return o;
  },
  crumple(sr, d, r) {
    const o = mk(sr, d), n = o[0].length;
    for (let k = 0; k < d * 140; k++) { const t = r() * (d - 0.05), env = Math.sin(Math.PI * t / d); addMono(o, burst(sr, 0.02, r, { f: 1500 + r() * 5000, q: 0.8, decay: 0.0015 + r() * 0.003, amp: env * (0.2 + r() * 0.8) }), Math.round(t * sr), r() - 0.5); }
    return o;
  },
  scribble(sr, d, r) {
    const o = mk(sr, d), b = new Biquad('bp', 3000, 1.5, sr), slow = slowGen(r, 7, sr);
    for (let i = 0; i < o[0].length; i++) { const t = i / sr, s = slow(); const env = Math.max(0, Math.sin(t * 2 * Math.PI * 3.2 + s * 4)) * (0.5 + s * 0.5); if (i % 128 === 0) b.set('bp', 2200 + s * 2500, 1.5, sr); const v = b.run(r() * 2 - 1) * env; o[0][i] = v; o[1][i] = v; }
    return fadeEdges(o, sr, 0.02, 0.05);
  },
  clock(sr, d, r) {
    const o = mk(sr, d); let k = 0;
    for (let t = 0.02; t < d - 0.05; t += 1, k++) addMono(o, resonate(burst(sr, 0.04, r, { f: 3500, decay: 0.0012 }), sr, [k % 2 ? 2300 : 3100, 5200], 45, 0.7), Math.round(t * sr));
    reverb(o, sr, 0.35, 0.15); return o;
  },
  knock(sr, d, r) {
    const o = mk(sr, d);
    [0, 0.2, 0.4].forEach(t => { addMono(o, tone(sr, 0.15, 190, 110, { decay: 0.03, amp: 0.9 }), Math.round(t * sr)); addMono(o, burst(sr, 0.06, r, { f: 700, q: 0.7, decay: 0.012, type: 'lp', amp: 0.8 }), Math.round(t * sr)); });
    reverb(o, sr, 0.5, 0.2); return o;
  },
  footsteps(sr, d, r) {
    const o = mk(sr, d); let t = 0.05, k = 0;
    while (t < d - 0.2) { const p = k % 2 ? 0.25 : -0.25; addMono(o, tone(sr, 0.1, 110, 60, { decay: 0.02, amp: 0.8 }), Math.round(t * sr), p); addMono(o, burst(sr, 0.12, r, { f: 1400 + r() * 1200, q: 0.8, decay: 0.025, amp: 0.5 }), Math.round((t + 0.01) * sr), p); t += 0.48 + r() * 0.06; k++; }
    reverb(o, sr, 0.4, 0.15); return o;
  },
  clapper(sr, d, r) {
    const o = mk(sr, d);
    addMono(o, resonate(burst(sr, 0.08, r, { f: 1800, q: 0.8, decay: 0.006 }), sr, [1150, 2450, 3900], 18, 0.5), 0);
    addMono(o, tone(sr, 0.08, 260, 120, { decay: 0.015, amp: 0.5 }), 0);
    reverb(o, sr, 0.4, 0.2); return o;
  },
  snap(sr, d, r) { const o = mk(sr, d); addMono(o, burst(sr, 0.04, r, { f: 3800, q: 0.9, decay: 0.0035 }), 0); addMono(o, tone(sr, 0.03, 1800, 900, { decay: 0.004, amp: 0.3 }), 0); reverb(o, sr, 0.3, 0.12); return o; },
  clip(sr, d, r) {
    const o = mk(sr, d);
    addMono(o, resonate(burst(sr, 0.04, r, { f: 5000, q: 1.5, decay: 0.002 }), sr, [4200, 6800], 60, 0.7), 0);
    addMono(o, resonate(burst(sr, 0.04, r, { f: 4200, q: 1.5, decay: 0.0015, amp: 0.7 }), sr, [3600, 5900], 60, 0.7), Math.round(0.045 * sr));
    return o;
  },
  impact(sr, d, r) { const o = mk(sr, d); addMono(o, tone(sr, d, 110, 38, { decay: 0.18, amp: 1 }), 0); addMono(o, burst(sr, 0.3, r, { f: 900, q: 0.7, type: 'lp', decay: 0.05, amp: 0.7 }), 0); reverb(o, sr, 0.9, 0.2); return o; },
  boom(sr, d, r) {
    const o = mk(sr, d), br = brownGen(r), lp = new Biquad('lp', 160, 0.8, sr);
    addMono(o, tone(sr, d, 70, 28, { decay: 0.6, amp: 1 }), 0);
    for (let i = 0; i < o[0].length; i++) { const t = i / sr, v = lp.run(br()) * Math.exp(-t / 0.7) * Math.min(1, t / 0.005) * 1.2; o[0][i] += v; o[1][i] += v; }
    return o;
  },
  swoosh2(sr, d, r) { return G.whoosh(sr, d, r); },
  /* ---- nature (any length; seamless start/end fades) ---- */
  rain(sr, d, r, heavy = false) {
    const o = mk(sr, d), n = o[0].length, pk = [pinkGen(r), pinkGen(r)], hp = [new Biquad('hp', heavy ? 400 : 900, 0.7, sr), new Biquad('hp', heavy ? 400 : 900, 0.7, sr)], lp = [new Biquad('lp', 9000, 0.7, sr), new Biquad('lp', 9000, 0.7, sr)];
    const sl = slowGen(r, 0.3, sr);
    for (let i = 0; i < n; i++) { const g = 0.85 + 0.15 * sl(); for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(hp[c].run(pk[c]())) * (heavy ? 1.3 : 0.7) * g; }
    const drops = d * (heavy ? 260 : 90);
    for (let k = 0; k < drops; k++) addMono(o, burst(sr, 0.02, r, { f: 2500 + r() * 5000, q: 2, decay: 0.0012 + r() * 0.002, amp: 0.15 + r() * 0.5 }), Math.floor(r() * n), r() * 2 - 1);
    if (heavy) { const br = brownGen(r), lpb = new Biquad('lp', 220, 0.7, sr); for (let i = 0; i < n; i++) { const v = lpb.run(br()) * 0.5; o[0][i] += v; o[1][i] += v; } }
    return fadeEdges(o, sr, 0.4, 0.6);
  },
  rainheavy(sr, d, r) { return G.rain(sr, d, r, true); },
  thunder(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, br = [brownGen(r), brownGen(r)], lp = [new Biquad('lp', 300, 0.7, sr), new Biquad('lp', 300, 0.7, sr)], sl = slowGen(r, 3, sr);
    for (let i = 0; i < n; i++) { const t = i / sr, env = Math.min(1, t / 0.08) * Math.exp(-t / (d * 0.35)) * (0.5 + 0.7 * sl()); for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(br[c]()) * env * 2.2; }
    const crack = burst(sr, 0.6, r, { f: 1500, q: 0.4, decay: 0.12, amp: 0.8 }); addMono(o, crack, Math.round(0.05 * sr), -0.3);
    reverb(o, sr, 2.5, 0.35); return fadeEdges(o, sr, 0.005, 0.8);
  },
  wind(sr, d, r, strong = false) {
    const o = mk(sr, d), n = o[0].length, pk = [pinkGen(r), pinkGen(r)], bp = [new Biquad('bp', 500, 0.9, sr), new Biquad('bp', 520, 0.9, sr)], g1 = slowGen(r, strong ? 0.6 : 0.25, sr), g2 = slowGen(r, 0.9, sr);
    for (let i = 0; i < n; i++) { const a = g1(), b = g2(); if (i % 128 === 0) { const f = 250 + (strong ? 900 : 550) * a + 120 * b; bp[0].set('bp', f, 0.9, sr); bp[1].set('bp', f * 1.07, 0.9, sr); }
      const env = (0.25 + 0.75 * a * a) * (strong ? 1.6 : 1); for (let c = 0; c < 2; c++) o[c][i] = bp[c].run(pk[c]() * 3) * env; }
    return fadeEdges(o, sr, 0.8, 1);
  },
  windstrong(sr, d, r) { return G.wind(sr, d, r, true); },
  waves(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, br = [brownGen(r), brownGen(r)], pk = [pinkGen(r), pinkGen(r)], lp = [new Biquad('lp', 600, 0.7, sr), new Biquad('lp', 600, 0.7, sr)], hp = [new Biquad('hp', 1500, 0.7, sr), new Biquad('hp', 1500, 0.7, sr)];
    const period = 6.5 + r() * 1.5;
    for (let i = 0; i < n; i++) { const t = i / sr, ph = (t % period) / period, swell = Math.pow(Math.sin(Math.PI * ph), 2), crash = ph > 0.45 ? Math.exp(-(ph - 0.45) * 7) : 0;
      if (i % 256 === 0) { lp[0].set('lp', 300 + 1400 * swell, 0.7, sr); lp[1].set('lp', 320 + 1400 * swell, 0.7, sr); }
      for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(br[c]() + pk[c]() * 0.8) * (0.25 + swell) * 1.2 + hp[c].run(pk[c]()) * crash * 0.9; }
    return fadeEdges(o, sr, 0.8, 1.2);
  },
  stream(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, pk = [pinkGen(r), pinkGen(r)], bp = [new Biquad('bp', 1200, 0.5, sr), new Biquad('bp', 1300, 0.5, sr)], sl = slowGen(r, 6, sr);
    for (let i = 0; i < n; i++) { const m = 0.6 + 0.4 * sl(); for (let c = 0; c < 2; c++) o[c][i] = bp[c].run(pk[c]() * 2) * m; }
    for (let k = 0; k < d * 35; k++) addMono(o, tone(sr, 0.05, 500 + r() * 900, 900 + r() * 1800, { decay: 0.012, amp: 0.12 + r() * 0.12, attack: 0.003 }), Math.floor(r() * n), r() * 2 - 1);
    return fadeEdges(o, sr, 0.6, 0.8);
  },
  waterfall(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, pk = [pinkGen(r), pinkGen(r)], lp = [new Biquad('lp', 2600, 0.6, sr), new Biquad('lp', 2600, 0.6, sr)], br = brownGen(r), lpb = new Biquad('lp', 180, 0.7, sr);
    for (let i = 0; i < n; i++) { const lo = lpb.run(br()) * 0.6; for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(pk[c]() * 2.2) + lo; }
    return fadeEdges(o, sr, 0.6, 0.8);
  },
  fire(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, br = [brownGen(r), brownGen(r)], lp = [new Biquad('lp', 260, 0.7, sr), new Biquad('lp', 280, 0.7, sr)], sl = slowGen(r, 1.5, sr);
    for (let i = 0; i < n; i++) { const g = 0.7 + 0.3 * sl(); for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(br[c]()) * 1.5 * g; }
    for (let k = 0; k < d * 30; k++) { const big = r() < 0.15; addMono(o, burst(sr, 0.03, r, { f: 1500 + r() * 4000, q: 0.7, decay: big ? 0.004 : 0.0012, amp: (big ? 0.9 : 0.35) * (0.4 + r() * 0.6) }), Math.floor(r() * n), r() * 1.6 - 0.8); }
    for (let k = 0; k < d * 120; k++) addMono(o, burst(sr, 0.01, r, { f: 3000 + r() * 4000, q: 1, decay: 0.0006, amp: 0.12 }), Math.floor(r() * n), r() * 2 - 1);
    return fadeEdges(o, sr, 0.5, 0.8);
  },
  leaves(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, bp = [new Biquad('bp', 4000, 0.6, sr), new Biquad('bp', 4200, 0.6, sr)], g1 = slowGen(r, 0.4, sr), g2 = slowGen(r, 9, sr);
    for (let i = 0; i < n; i++) { const env = Math.pow(g1(), 2) * (0.4 + 0.6 * g2()); for (let c = 0; c < 2; c++) o[c][i] = bp[c].run(r() * 2 - 1) * env * 1.4; }
    return fadeEdges(o, sr, 0.6, 0.8);
  },
  traffic(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, br = [brownGen(r), brownGen(r)], lp = [new Biquad('lp', 350, 0.7, sr), new Biquad('lp', 370, 0.7, sr)];
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(br[c]()) * 1.1;
    for (let t = r() * 2; t < d - 1; t += 2 + r() * 4) {
      const len = 2.5 + r() * 1.5, m = Math.ceil(len * sr), b = new Biquad('bp', 500, 0.8, sr), dir = r() < 0.5 ? 1 : -1, pk = pinkGen(r), s0 = Math.floor(t * sr);
      for (let i = 0; i < m && s0 + i < n; i++) { const k = i / m, env = Math.pow(Math.sin(Math.PI * k), 3), pan = (k * 2 - 1) * dir; if (i % 128 === 0) b.set('bp', 700 - 300 * k, 0.8, sr); const v = b.run(pk() * 3) * env * 0.8; o[0][s0 + i] += v * (1 - pan) * 0.7; o[1][s0 + i] += v * (1 + pan) * 0.7; }
    }
    return fadeEdges(o, sr, 0.6, 0.8);
  },
  room(sr, d, r) {
    const o = mk(sr, d), n = o[0].length, pk = [pinkGen(r), pinkGen(r)], lp = [new Biquad('lp', 500, 0.7, sr), new Biquad('lp', 520, 0.7, sr)];
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) o[c][i] = lp[c].run(pk[c]()) * 0.6;
    return fadeEdges(o, sr, 0.4, 0.6);
  },
};

export const SFX = [
  // UI & tech
  { id: 'click', name: 'Mouse click', cat: 'Clicks & UI', dur: 0.2 },
  { id: 'dblclick', name: 'Double click', cat: 'Clicks & UI', dur: 0.3 },
  { id: 'tap', name: 'Tap', cat: 'Clicks & UI', dur: 0.12 },
  { id: 'toggle', name: 'Switch', cat: 'Clicks & UI', dur: 0.12 },
  { id: 'keys', name: 'Keyboard typing', cat: 'Clicks & UI', dur: 2.5 },
  { id: 'typewriter', name: 'Typewriter keys', cat: 'Clicks & UI', dur: 2.5 },
  { id: 'beep', name: 'Censor beep', cat: 'Clicks & UI', dur: 0.6 },
  { id: 'buzz', name: 'Error buzz', cat: 'Clicks & UI', dur: 0.35 },
  { id: 'vibrate', name: 'Phone vibrate', cat: 'Clicks & UI', dur: 1.3 },
  { id: 'glitch', name: 'Glitch', cat: 'Clicks & UI', dur: 0.6 },
  { id: 'static', name: 'Static', cat: 'Clicks & UI', dur: 1.5 },
  { id: 'zap', name: 'Zap', cat: 'Clicks & UI', dur: 0.25 },
  // Camera
  { id: 'shutter', name: 'Camera shutter', cat: 'Camera', dur: 0.35 },
  { id: 'shutterwind', name: 'Shutter + film wind', cat: 'Camera', dur: 0.7 },
  { id: 'burstshots', name: 'Burst shots', cat: 'Camera', dur: 0.85 },
  { id: 'clapper', name: 'Clapperboard', cat: 'Camera', dur: 0.6 },
  // Everyday
  { id: 'clip', name: 'Clip', cat: 'Everyday', dur: 0.2 },
  { id: 'snap', name: 'Snap', cat: 'Everyday', dur: 0.3 },
  { id: 'pop', name: 'Pop', cat: 'Everyday', dur: 0.15 },
  { id: 'bubble', name: 'Bubble', cat: 'Everyday', dur: 0.15 },
  { id: 'pageturn', name: 'Page turn', cat: 'Everyday', dur: 0.6 },
  { id: 'crumple', name: 'Paper crumple', cat: 'Everyday', dur: 1.2 },
  { id: 'scribble', name: 'Pen scribble', cat: 'Everyday', dur: 1.6 },
  { id: 'clock', name: 'Clock ticking', cat: 'Everyday', dur: 5, loop: true },
  { id: 'knock', name: 'Door knock', cat: 'Everyday', dur: 1 },
  { id: 'footsteps', name: 'Footsteps', cat: 'Everyday', dur: 4, loop: true },
  // Transitions
  { id: 'whoosh', name: 'Whoosh', cat: 'Whoosh & hits', dur: 0.8 },
  { id: 'swish', name: 'Fast swish', cat: 'Whoosh & hits', dur: 0.35 },
  { id: 'riser', name: 'Rise', cat: 'Whoosh & hits', dur: 2 },
  { id: 'downer', name: 'Fall', cat: 'Whoosh & hits', dur: 1.5 },
  { id: 'impact', name: 'Impact', cat: 'Whoosh & hits', dur: 1 },
  { id: 'boom', name: 'Deep boom', cat: 'Whoosh & hits', dur: 2 },
  // Nature
  { id: 'rain', name: 'Light rain', cat: 'Nature', dur: 10, loop: true },
  { id: 'rainheavy', name: 'Heavy rain', cat: 'Nature', dur: 10, loop: true },
  { id: 'thunder', name: 'Thunder', cat: 'Nature', dur: 6 },
  { id: 'wind', name: 'Wind', cat: 'Nature', dur: 10, loop: true },
  { id: 'windstrong', name: 'Strong wind', cat: 'Nature', dur: 10, loop: true },
  { id: 'waves', name: 'Ocean waves', cat: 'Nature', dur: 14, loop: true },
  { id: 'stream', name: 'Stream', cat: 'Nature', dur: 10, loop: true },
  { id: 'waterfall', name: 'Waterfall', cat: 'Nature', dur: 10, loop: true },
  { id: 'fire', name: 'Campfire', cat: 'Nature', dur: 10, loop: true },
  { id: 'leaves', name: 'Leaves rustling', cat: 'Nature', dur: 8, loop: true },
  { id: 'drip', name: 'Water drips', cat: 'Nature', dur: 5, loop: true },
  { id: 'plop', name: 'Water drop', cat: 'Nature', dur: 0.8 },
  { id: 'splash', name: 'Splash', cat: 'Nature', dur: 1 },
  // Places
  { id: 'traffic', name: 'City traffic', cat: 'Places', dur: 12, loop: true },
  { id: 'room', name: 'Room tone', cat: 'Places', dur: 10, loop: true },
];
export const sfxById = id => SFX.find(s => s.id === id);

const cache = new Map();
// returns an AudioBuffer for `id`, `dur` seconds long (ambient sounds are made at any length)
export function sfxBuffer(ctx, id, dur, seed = 1) {
  const def = sfxById(id); if (!def) return null;
  const d = def.loop ? Math.max(0.5, Math.min(dur, 600)) : def.dur;
  const key = id + ':' + d.toFixed(2) + ':' + seed + ':' + ctx.sampleRate;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate, out = normalize(G[id](sr, d, rng(seed * 7919 + id.length * 104729)), def.cat === 'Nature' || def.cat === 'Places' ? 0.7 : 0.89);
  const b = ctx.createBuffer(2, out[0].length, sr); b.copyToChannel(out[0], 0); b.copyToChannel(out[1], 1);
  cache.set(key, b);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return b;
}
