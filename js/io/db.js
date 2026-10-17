// IndexedDB storage: imported samples, project versions, rendered tracks, playlists.
// Everything stays in this browser. Export/import .wellspring files to move it.

const DB_NAME = 'wellsprings';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('samples', { keyPath: 'id' });           // { id, name, blob }
      db.createObjectStore('projects', { keyPath: 'id' });          // { id, name, updated, versions: [{ v, ts, note }] }
      db.createObjectStore('versions', { keyPath: 'key' });         // { key: `${id}@${v}`, json }
      db.createObjectStore('renders', { keyPath: 'id' });           // { id, projectId, projectName, v, name, blob, duration, created, tags }
      db.createObjectStore('playlists', { keyPath: 'id' });         // { id, name, items: [renderId] }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}

export const put = (store, val) => tx(store, 'readwrite', s => s.put(val));
export const get = (store, key) => tx(store, 'readonly', s => s.get(key));
export const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const all = store => tx(store, 'readonly', s => s.getAll());

// --- samples --------------------------------------------------------------

const decoded = new Map();
export async function saveSample(id, name, blob) { await put('samples', { id, name, blob }); }
export async function getSampleBuffer(ctx, id) {
  const key = id + '@' + ctx.sampleRate;
  if (decoded.has(key)) return decoded.get(key);
  const rec = await get('samples', id);
  if (!rec) return null;
  const buf = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
  decoded.set(key, buf);
  return buf;
}

// --- projects & versions --------------------------------------------------

export async function saveVersion(project, note = '') {
  if (!project.libraryId) project.libraryId = 'pj' + Date.now().toString(36);
  const rec = (await get('projects', project.libraryId)) || { id: project.libraryId, name: project.name, versions: [] };
  const v = (rec.versions.at(-1)?.v || 0) + 1;
  rec.name = project.name;
  rec.updated = Date.now();
  rec.versions.push({ v, ts: rec.updated, note });
  await put('versions', { key: `${rec.id}@${v}`, json: JSON.stringify(project) });
  await put('projects', rec);
  return v;
}
export async function loadVersion(id, v) {
  const rec = await get('versions', `${id}@${v}`);
  return rec ? JSON.parse(rec.json) : null;
}
