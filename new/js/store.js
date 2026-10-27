// Everything stays on the device: projects, imported media and analysis results live in IndexedDB.
const DB_NAME = 'video-editor-new', DB_VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['projects', 'media', 'blobs', 'cache']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const get = (store, k) => tx(store, 'readonly', s => s.get(k));
export const put = (store, k, v) => tx(store, 'readwrite', s => s.put(v, k));
export const del = (store, k) => tx(store, 'readwrite', s => s.delete(k));
export const all = (store) => tx(store, 'readonly', s => s.getAll());
export const keys = (store) => tx(store, 'readonly', s => s.getAllKeys());

export async function listProjects() {
  const list = (await all('projects')) || [];
  return list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export const saveProject = p => put('projects', p.id, p);
export const loadProject = id => get('projects', id);
export async function deleteProject(p) {
  await del('projects', p.id);
  // media only used by this project goes too
  const others = (await all('projects')) || [];
  const used = new Set(others.flatMap(o => Object.keys(o.media || {})));
  for (const mid of Object.keys(p.media || {})) if (!used.has(mid)) { await del('blobs', mid); await del('cache', 'faces:' + mid).catch(() => {}); await del('cache', 'seg:' + mid).catch(() => {}); }
}
export const saveBlob = (id, blob) => put('blobs', id, blob);
export const loadBlob = id => get('blobs', id);
export const cacheGet = k => get('cache', k);
export const cacheSet = (k, v) => put('cache', k, v);

export async function persist() { try { await navigator.storage?.persist?.(); } catch (e) { } }
export async function usage() { try { return await navigator.storage.estimate(); } catch (e) { return null; } }
