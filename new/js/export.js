// Saving the finished video. Frame-by-frame with WebCodecs (exact, any speed) into MP4;
// falls back to recording a real-time playback where WebCodecs is missing.
import { GL } from './gl.js';
import { Composer, clearRasterCache } from './compose.js';
import { urlFor, imageFor } from './media.js';
import { mixdown } from './audio.js';
import { srcTime, duration } from './model.js';
import * as faces from './faces.js';
import { stabAt } from './track.js';
import { once, withTimeout, sleep, clamp } from './util.js';

const MUXER = new URL('../vendor/mp4-muxer.mjs', import.meta.url).href;

export const canWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

async function pickVideoCodec(w, h, fps, bitrate) {
  const tries = [
    ['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.42003e'], ['avc', 'avc1.640028'], ['avc', 'avc1.42001f'],
    ['hevc', 'hvc1.1.6.L153.B0'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08'],
  ];
  for (const [mux, codec] of tries) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: 'quality', ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { mux, cfg: r.config || cfg }; } catch (e) { }
    }
  }
  return null;
}
async function pickAudioCodec(sr) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [mux, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    for (const rate of [sr, 48000, 44100]) {
      const cfg = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: 192000 };
      try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { mux, cfg }; } catch (e) { }
    }
  }
  return null;
}

/* frames from the source videos, by seeking (exact frames) */
class SeekProvider {
  constructor(p) { this.p = p; this.els = new Map(); }
  async el(it) {
    let v = this.els.get(it.mid + ':' + it.id);
    if (!v) {
      const el = document.createElement('video'); el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.src = await urlFor(it.mid);
      await withTimeout(once(el, 'loadeddata'), 20000, 'video');
      v = { el, t: -1 }; this.els.set(it.mid + ':' + it.id, v);
    }
    return v;
  }
  // gets every video active at time t to its exact frame
  async prepare(t) {
    const jobs = [];
    for (const it of this.p.items) {
      if (it.kind === 'image' && t >= it.start && t < it.start + it.dur) jobs.push(imageFor(it.mid));
      if (it.kind !== 'video' || t < it.start || t >= it.start + it.dur) continue;
      jobs.push((async () => {
        const v = await this.el(it), st = srcTime(it, t - it.start);
        if (Math.abs(v.t - st) < 1e-4) return;
        v.el.currentTime = st; v.t = st;
        await withTimeout(once(v.el, 'seeked'), 10000, 'seek').catch(() => {});
        // Safari: wait until the frame is actually decoded
        if (v.el.requestVideoFrameCallback) await Promise.race([new Promise(r => v.el.requestVideoFrameCallback(r)), sleep(60)]);
      })());
    }
    // free elements of finished clips
    for (const [k, v] of this.els) { const id = k.split(':')[1], it = this.p.items.find(i => i.id === id); if (!it || it.start + it.dur < t - 0.5) { v.el.removeAttribute('src'); v.el.load(); this.els.delete(k); } }
    await Promise.all(jobs);
  }
  api() {
    return {
      frame: (it) => {
        if (it.kind === 'image') { return this.img(it); }
        const v = this.els.get(it.mid + ':' + it.id); if (!v || v.el.readyState < 2) return null;
        return { el: v.el, w: v.el.videoWidth, h: v.el.videoHeight, key: 'x:' + it.id, ver: null };
      },
      faces: (it, st, w, h) => it.faces?.on ? faces.regions(faces.dataNow(it.mid), it.faces, st, w, h) : null,
      mask: (it, st) => it.cutout?.on ? faces.cutoutAt(it.mid, st) : null,
      stab: (it, st) => stabAt(it.mid, st, it.stab?.strength ?? 0.6),
    };
  }
  img(it) { const im = this._imgs?.get(it.mid); return im ? { el: im, w: im.naturalWidth, h: im.naturalHeight, key: 'i:' + it.mid, ver: it.mid } : null; }
  async loadImages() { this._imgs = new Map(); for (const it of this.p.items) if (it.kind === 'image') this._imgs.set(it.mid, await imageFor(it.mid)); }
  close() { for (const v of this.els.values()) { v.el.removeAttribute('src'); v.el.load(); } this.els.clear(); }
}

async function loadFonts(p) {
  const fams = new Set(p.items.filter(i => i.kind === 'text').map(i => `${i.weight || 700} 40px "${i.font}"`));
  await Promise.all([...fams].map(f => document.fonts.load(f).catch(() => {})));
  await document.fonts.ready;
}
async function prepareAnalysis(p) {
  for (const it of p.items) {
    if (it.faces?.on) await faces.getData(it.mid);
    if (it.cutout?.on) await faces.getCutout(it.mid);
  }
}

/* opts: { w, h, fps, bitrate, from, to }  onProgress(fraction, text)  signal (AbortSignal) */
export async function exportVideo(p, opts, onProgress, signal) {
  await loadFonts(p); await prepareAnalysis(p); clearRasterCache();
  const from = opts.from || 0, to = opts.to ?? duration(p);
  if (canWebCodecs()) {
    try { return await exportWebCodecs(p, opts, from, to, onProgress, signal); }
    catch (e) { if (e.name === 'AbortError') throw e; console.warn('WebCodecs export failed, recording instead', e); }
  }
  return exportRealtime(p, opts, from, to, onProgress, signal);
}

async function exportWebCodecs(p, opts, from, to, onProgress, signal) {
  const W = opts.w & ~1, H = opts.h & ~1, fps = opts.fps || 30, bitrate = opts.bitrate || 10e6;
  const vc = await pickVideoCodec(W, H, fps, bitrate);
  if (!vc) throw new Error('no video encoder for this size');
  onProgress?.(0, 'Mixing sound…');
  const audio = await mixdown(p, from, to, 48000, f => onProgress?.(f * 0.04, 'Mixing sound…'));
  const ac = await pickAudioCodec(audio.sampleRate);
  const { Muxer, ArrayBufferTarget } = await import(MUXER);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: vc.mux, width: W, height: H, frameRate: fps },
    ...(ac ? { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: ac.cfg.sampleRate } } : {}),
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
  venc.configure(vc.cfg);
  // sound first (fast)
  if (ac) {
    let a = audio;
    if (ac.cfg.sampleRate !== audio.sampleRate) {
      const oc = new OfflineAudioContext(2, Math.ceil(audio.duration * ac.cfg.sampleRate), ac.cfg.sampleRate), s = oc.createBufferSource(); s.buffer = audio; s.connect(oc.destination); s.start(); a = await oc.startRendering();
    }
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { encErr = e; } });
    aenc.configure(ac.cfg);
    const L = a.getChannelData(0), R = a.getChannelData(1), sr = a.sampleRate, block = 1024 * 4;
    for (let i = 0; i < a.length; i += block) {
      const n = Math.min(block, a.length - i), data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / sr * 1e6), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }
  // pictures
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = new GL(canvas), comp = new Composer(gl), prov = new SeekProvider(p);
  await prov.loadImages();
  const api = prov.api(), N = Math.max(1, Math.round((to - from) * fps)), t0 = performance.now();
  try {
    for (let i = 0; i < N; i++) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      if (encErr) throw encErr;
      const t = from + i / fps;
      await prov.prepare(t);
      const out = comp.render(p, t, W, H, api, { full: true });
      gl.present(out); gl.endFrame();
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 }); frame.close();
      while (venc.encodeQueueSize > 6) await sleep(4);
      if (i % 3 === 0) {
        const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (N - i - 1);
        onProgress?.(0.04 + 0.95 * (i + 1) / N, `Saving ${Math.round((i + 1) / N * 100)}% · about ${left < 60 ? Math.ceil(left) + ' s' : Math.ceil(left / 60) + ' min'} left`);
      }
    }
    await venc.flush();
  } finally { prov.close(); try { venc.close(); } catch (e) { } gl.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  if (encErr) throw encErr;
  muxer.finalize();
  onProgress?.(1, 'Done');
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// plays the project in real time into a recorder (older browsers)
async function exportRealtime(p, opts, from, to, onProgress, signal) {
  const { Player } = await import('./playback.js');
  const canvas = document.createElement('canvas'); canvas.width = opts.w; canvas.height = opts.h;
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px'; document.body.appendChild(canvas);
  const pl = new Player(canvas); pl.previewLong = Math.max(opts.w, opts.h); pl.setProject(p);
  const { audioCtx } = await import('./media.js'), ac = audioCtx();
  const dest = ac.createMediaStreamDestination(); pl.master = ac.createGain(); pl.master.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(opts.fps || 30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: opts.bitrate || 8e6 }), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  pl.seek(from); await sleep(600);
  rec.start(500); await pl.play({ from, to });
  await new Promise((res, rej) => {
    const tick = () => {
      if (signal?.aborted) { pl.pause(); rej(new DOMException('cancelled', 'AbortError')); return; }
      onProgress?.(clamp((pl.t - from) / (to - from), 0, 1), 'Recording (plays once in real time)…');
      if (!pl.playing) res(); else setTimeout(tick, 200);
    };
    tick();
  }).finally(async () => { await sleep(300); rec.state !== 'inactive' && rec.stop(); });
  await once(rec, 'stop').catch(() => {});
  canvas.remove();
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}

/* reversing a clip: writes a new video with the frames in reverse order (and the sound reversed) */
export async function reverseMedia(m, onProgress, signal) {
  const { Muxer, ArrayBufferTarget } = await import(MUXER);
  const W = Math.min(m.w, 1920 * (m.w >= m.h ? 1 : 1080 / 1920)) & ~1, H = Math.round(W * m.h / m.w) & ~1, fps = 30;
  const vc = await pickVideoCodec(W, H, fps, 12e6); if (!vc) throw new Error('This browser cannot write video files');
  const { audioNow, decodeAudio } = await import('./media.js');
  const buf = await decodeAudio(m); const ac = buf ? await pickAudioCodec(buf.sampleRate) : null;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: vc.mux, width: W, height: H, frameRate: fps }, ...(ac ? { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: ac.cfg.sampleRate } } : {}) });
  let err = null;
  if (ac) {
    const aenc = new AudioEncoder({ output: (c, mm) => muxer.addAudioChunk(c, mm), error: e => { err = e; } }); aenc.configure(ac.cfg);
    const L = buf.getChannelData(0).slice().reverse(), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice().reverse(), sr = buf.sampleRate;
    for (let i = 0; i < L.length; i += 4096) { const n = Math.min(4096, L.length - i), d = new Float32Array(n * 2); d.set(L.subarray(i, i + n)); d.set(R.subarray(i, i + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / sr * 1e6), data: d }); aenc.encode(ad); ad.close(); }
    await aenc.flush(); aenc.close();
  }
  const venc = new VideoEncoder({ output: (c, mm) => muxer.addVideoChunk(c, mm), error: e => { err = e; } }); venc.configure(vc.cfg);
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlFor(m.id);
  await withTimeout(once(v, 'loadeddata'), 20000, 'video');
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  const N = Math.max(1, Math.floor(m.dur * fps));
  for (let i = 0; i < N; i++) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    if (err) throw err;
    v.currentTime = Math.max(0, m.dur - (i + 1) / fps); await withTimeout(once(v, 'seeked'), 8000, 'seek').catch(() => {});
    ctx.drawImage(v, 0, 0, W, H);
    const f = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) }); venc.encode(f, { keyFrame: i % 30 === 0 }); f.close();
    while (venc.encodeQueueSize > 6) await sleep(4);
    onProgress?.((i + 1) / N, `Reversing… ${Math.round((i + 1) / N * 100)}%`);
  }
  await venc.flush(); venc.close(); muxer.finalize(); v.removeAttribute('src'); v.load();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
