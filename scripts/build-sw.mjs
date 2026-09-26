import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(join(folder, entry.name)) : Promise.resolve([join(folder, entry.name)])))
  return files.flat()
}
const paths = (await walk(root)).filter(path => relative(root, path) !== 'sw.js').sort()
const names = paths.map(path => relative(root, path).split('\\').join('/'))
const digest = createHash('sha256')
for (const path of paths) digest.update(await readFile(path))
const version = digest.digest('hex').slice(0, 12)

await writeFile(join(root, 'sw.js'), `const CACHE = 'faceveil-${version}';
const FILES = ${JSON.stringify(names)};
const base = self.registration.scope;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A device may reject large WASM files under storage pressure. Keep the app shell usable.
    for (const file of FILES) {
      try { await cache.add(new URL(file, base)); }
      catch (error) { console.warn('Could not cache', file, error); }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('faceveil-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match(new URL('index.html', base))));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request) || await fetch(event.request);
  })());
});
`)
console.log(`Generated offline worker for ${names.length} files (${version})`)
