// Automatic captions with Whisper (speech recognition that runs on the device; the program is
// downloaded once), plus subtitle files in and out.
import { sleep } from './util.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export const LANGS = [
  ['auto', 'Detect automatically'], ['en', 'English'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['fa', 'Persian'], ['tr', 'Turkish'], ['ms', 'Malay'], ['id', 'Indonesian'],
  ['bn', 'Bengali'], ['hi', 'Hindi'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['so', 'Somali'], ['sw', 'Swahili'], ['ha', 'Hausa'], ['ps', 'Pashto'], ['uz', 'Uzbek'], ['kk', 'Kazakh'], ['az', 'Azerbaijani'], ['sq', 'Albanian'], ['bs', 'Bosnian'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['pl', 'Polish'], ['sv', 'Swedish'], ['uk', 'Ukrainian'], ['ta', 'Tamil'], ['th', 'Thai'], ['vi', 'Vietnamese'],
];

const WORKER_SRC = `import { pipeline, env, Tensor } from '${TRANSFORMERS_URL}';
env.allowLocalModels = false;
let asr = null, loaded = '';
async function detectLang(audio, codes) {
  const clip = audio.subarray(0, Math.min(audio.length, 16000 * 30));
  const inp = await asr.processor(clip);
  const ids = asr.tokenizer.model.tokens_to_ids, sot = ids.get('<|startoftranscript|>');
  const out = await asr.model({ input_features: inp.input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]) });
  const lg = out.logits.data, V = out.logits.dims[out.logits.dims.length - 1], base = lg.length - V;
  let best = null, bv = -Infinity;
  for (const c of codes) { const id = ids.get('<|' + c + '|>'); if (id == null) continue; const v = lg[base + id]; if (v > bv) { bv = v; best = c; } }
  return best;
}
self.postMessage({ type: 'ready' });
self.onmessage = async (e) => {
  const d = e.data;
  try {
    const key = d.model + (d.dtype || '');
    if (!asr || loaded !== key) { asr = await pipeline('automatic-speech-recognition', d.model, Object.assign({ progress_callback: (x) => self.postMessage({ type: 'progress', x }) }, d.dtype ? { dtype: d.dtype } : {})); loaded = key; }
    if (!d.opts.language && d.codes) { try { const lang = await detectLang(d.audio, d.codes); if (lang) { d.opts.language = lang; self.postMessage({ type: 'lang', lang }); } } catch (err) { } }
    self.postMessage({ type: 'listening' });
    self.postMessage({ type: 'done', out: await asr(d.audio, d.opts) });
  } catch (err) { self.postMessage({ type: 'error', message: String((err && (err.stack || err.message)) || err) }); }
};`;

function runWorker(job, onEvt) {
  return new Promise((res, rej) => {
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' }); }
    catch (e) { return rej(new Error('Background helper blocked: ' + e.message)); }
    const opts = { task: job.task, chunk_length_s: 30, stride_length_s: 5, return_timestamps: job.word ? 'word' : true };
    if (job.language) opts.language = job.language;
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') w.postMessage({ audio: job.audio, model: job.model, dtype: job.dtype, opts, codes: job.codes });
      else if (m.type === 'done') { w.terminate(); res(m.out); }
      else if (m.type === 'error') { w.terminate(); rej(new Error(m.message)); }
      else onEvt(m);
    };
    w.onerror = ev => { ev.preventDefault?.(); w.terminate(); rej(new Error(ev.message || 'helper failed')); };
    job.signal?.addEventListener('abort', () => { w.terminate(); rej(new DOMException('cancelled', 'AbortError')); });
  });
}

async function to16k(buf) {
  const oc = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
  return (await oc.startRendering()).getChannelData(0);
}
const junk = t => !t || /^[\[(♪*].*[\])♪*]$/.test(t) || /^(\.|…)+$/.test(t);

function words(out, word, dur) {
  const chunks = out?.chunks?.length ? out.chunks : [{ text: out?.text || '', timestamp: [0, dur] }];
  if (word) {
    const ws = chunks.map(c => ({ w: (c.text || '').trim(), s: c.timestamp?.[0], e: c.timestamp?.[1] })).filter(x => x.w && x.s != null);
    ws.forEach((x, i) => { if (x.e == null) x.e = ws[i + 1]?.s ?? x.s + 0.4; x.e = Math.min(x.e, x.s + 1.2); });
    return ws.filter(x => !junk(x.w));
  }
  // sentence timing only: spread each sentence's words evenly
  return chunks.flatMap((ch, i) => {
    const text = (ch.text || '').trim(); if (junk(text)) return [];
    const s = ch.timestamp?.[0] ?? 0, e = ch.timestamp?.[1] ?? chunks[i + 1]?.timestamp?.[0] ?? Math.min(dur, s + 4);
    const parts = text.split(/\s+/), tot = parts.reduce((a, b) => a + b.length + 1, 0); let at = s;
    return parts.map(w => { const d = (e - s) * (w.length + 1) / tot, r = { w, s: at, e: at + d }; at += d; return r; });
  });
}

// groups words into short lines: breaks on pauses, punctuation and length
export function group(ws, maxWords = 6) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; };
  ws.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && (w.s - prev.e > 0.6 || cur.length >= maxWords || /[.!?؟。]$/.test(prev.w) || (cur.length >= maxWords - 2 && /[,،;:]$/.test(prev.w)))) flush();
    cur.push(w);
  });
  flush();
  out.forEach((c, i) => { if (out[i + 1]) c.e = Math.min(Math.max(c.e, c.s + 0.4), out[i + 1].s); else c.e = Math.max(c.e, c.s + 0.6); });
  return out;
}

/* buf: AudioBuffer of the timeline's sound (from 0). Returns caption lines [{s,e,words:[{w,s,e}]}] */
export async function transcribe(buf, cfg, onStatus, signal) {
  onStatus?.('Preparing the sound…', null);
  const audio = await to16k(buf);
  const size = cfg.quality === 'best' ? 'small' : cfg.quality === 'fast' ? 'tiny' : 'base';
  const list = [{ model: `onnx-community/whisper-${size}_timestamped`, dtype: 'q8', word: true }, { model: `Xenova/whisper-${size}`, word: false }];
  let lastErr = null;
  for (const eng of list) {
    const files = {};
    try {
      const out = await runWorker({
        audio, model: eng.model, dtype: eng.dtype, word: eng.word, language: cfg.lang === 'auto' ? null : cfg.lang,
        codes: LANGS.map(l => l[0]).filter(c => c !== 'auto'), task: cfg.translate ? 'translate' : 'transcribe', signal,
      }, m => {
        if (m.type === 'progress' && m.x?.status === 'progress' && m.x.total) {
          files[m.x.file] = [m.x.loaded, m.x.total];
          const [l, t] = Object.values(files).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
          onStatus?.(`Downloading the speech program… ${Math.round(l / 1048576)} of ${Math.round(t / 1048576)} MB (first time only)`, l / t);
        } else if (m.type === 'listening') onStatus?.('Listening and writing captions… this can take a few minutes.', null);
      });
      const ws = words(out, eng.word, buf.duration);
      if (ws.length || !eng.word) return group(ws, cfg.maxWords || 6);
      throw new Error('no word timings');
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e; console.warn('captions engine failed', eng.model, e);
      if (/fetch|network|Failed to load|NetworkError|import/i.test(String(e.message))) break;
      await sleep(200);
    }
  }
  throw new Error(/fetch|network|Failed|import/i.test(String(lastErr?.message)) ? 'The speech program could not download. Check the internet connection and try again.' : 'Captions could not be written: ' + (lastErr?.message || 'unknown error'));
}

/* ---------- subtitle files ---------- */
const ts = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s % 60), ms = Math.round((s % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
export function toSrt(lines) { return lines.map((l, i) => `${i + 1}\n${ts(l.s)} --> ${ts(l.e)}\n${l.text}\n`).join('\n'); }
export function parseSubs(text) {
  const out = [], re = /(\d+:)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+:)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n'), i = lines.findIndex(l => re.test(l)); if (i < 0) continue;
    const m = lines[i].match(re), sec = (h, mm, s, ms) => (parseInt(h || '0') * 3600) + parseInt(mm) * 60 + parseInt(s) + parseInt(ms.padEnd(3, '0')) / 1000;
    const text_ = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim(); if (!text_) continue;
    out.push({ s: sec(m[1]?.replace(':', ''), m[2], m[3], m[4]), e: sec(m[5]?.replace(':', ''), m[6], m[7], m[8]), text: text_ });
  }
  return out;
}
