// Small shared helpers.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const deep = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function fmtTime(s, frac = true) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${frac ? '.' + String(cs).padStart(2, '0') : ''}`;
}
export function fmtDur(s) { return s < 60 ? s.toFixed(1) + 's' : fmtTime(s, false); }
export function fmtBytes(b) { return b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB'; }

export const ease = {
  linear: t => t,
  in: t => t * t * t,
  out: t => 1 - Math.pow(1 - t, 3),
  inout: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  elastic: t => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
};

export function hexToRgb(h) {
  h = (h || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export const rgba = (hex, a = 1) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

export function withTimeout(p, ms, what = 'operation') {
  return Promise.race([p, sleep(ms).then(() => { throw new Error(what + ' timed out'); })]);
}

// Tiny event emitter
export class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= new Set()).add(f); return () => this.h[e].delete(f); }
  emit(e, ...a) { this.h[e]?.forEach(f => { try { f(...a); } catch (err) { console.error(err); } }); }
}

export function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export async function shareOrSave(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isPhone && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(blob, name); return 'saved';
}

export function pickFiles(accept, multiple = true) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { res([...i.files]); i.remove(); };
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    i.click();
  });
}

// waits for an element event once (with optional timeout)
export function once(el, ev, ms = 0) {
  return new Promise((res, rej) => {
    let t; const f = e => { clearTimeout(t); el.removeEventListener(ev, f); res(e); };
    el.addEventListener(ev, f);
    if (ms) t = setTimeout(() => { el.removeEventListener(ev, f); rej(new Error(ev + ' timeout')); }, ms);
  });
}
