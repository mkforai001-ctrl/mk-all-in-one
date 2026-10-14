'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const appUrl = new URL('https://mkforai001-ctrl.github.io/mk-all-in-one/');

test('manifest metadata and entry points stay within the GitHub Pages subpath', () => {
  assert.equal(manifest.name, 'MK Calculator — All-in-One Hausa Calculator');
  assert.equal(manifest.short_name, 'MK Calculator');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[\da-f]{6}$/i);
  assert.match(manifest.background_color, /^#[\da-f]{6}$/i);
  assert.equal(new URL(manifest.id, appUrl).pathname, '/mk-all-in-one/');
  assert.equal(new URL(manifest.start_url, appUrl).pathname, '/mk-all-in-one/');
  assert.equal(new URL(manifest.scope, appUrl).pathname, '/mk-all-in-one/');
  assert.match(html, /<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<meta\s+name="theme-color"\s+content="#123b35">/);
});

test('manifest declares existing PNG icons with accurate sizes and maskable support', () => {
  const icons = manifest.icons.filter(icon => icon.type === 'image/png');
  assert.ok(icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));

  for (const icon of manifest.icons) {
    const url = new URL(icon.src, appUrl);
    assert.equal(url.origin, appUrl.origin);
    assert.ok(url.pathname.startsWith('/mk-all-in-one/'));
    const file = path.join(root, icon.src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), `Missing manifest icon: ${icon.src}`);
    if (icon.type === 'image/png') {
      const png = fs.readFileSync(file);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    }
  }
});

test('service worker caches the install icons and avoids caching failed responses', () => {
  assert.match(html, /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(worker, /const CACHE_NAME = 'mk-calculator-v3'/);
  assert.match(worker, /'\.\/icons\/mk-calculator-192\.png'/);
  assert.match(worker, /'\.\/icons\/mk-calculator-512\.png'/);
  assert.match(worker, /if \(response\.ok\) await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(worker, /if \(response\.ok\) await cache\.put\(new URL\('\.\/', self\.registration\.scope\), response\.clone\(\)\)/);
  assert.match(worker, /return await cache\.match\(new URL\('\.\/', self\.registration\.scope\)\) \|\| Response\.error\(\)/);
});

function createWorkerHarness({ failedPaths = [], initialCaches = [] } = {}) {
  const handlers = new Map();
  const cacheStores = new Map();
  const requestedPaths = [];
  let skipWaitingCalled = false;
  let clientsClaimed = false;
  let offline = false;
  let navigationStatus = 200;
  let navigationBody = 'network page';
  const scope = appUrl.href;
  const failedUrls = new Set(failedPaths.map(path => new URL(path, scope).href));

  function cacheFor(name) {
    if (!cacheStores.has(name)) {
      const entries = new Map();
      const keyFor = request => new URL(typeof request === 'string' || request instanceof URL ? request : request.url, scope).href;
      cacheStores.set(name, {
        entries,
        async addAll(paths) {
          const additions = [];
          for (const path of paths) {
            const url = new URL(path, scope);
            requestedPaths.push(url.href);
            const response = await networkFetch(url.href);
            if (!response.ok) throw new TypeError(`Failed to cache ${url.href}`);
            additions.push([url.href, response.clone()]);
          }
          for (const [url, response] of additions) entries.set(url, response);
        },
        async match(request) { return entries.get(keyFor(request))?.clone(); },
        async put(request, response) { entries.set(keyFor(request), response.clone()); }
      });
    }
    return cacheStores.get(name);
  }

  async function networkFetch(request) {
    const url = new URL(typeof request === 'string' || request instanceof URL ? request : request.url, scope);
    if (offline) throw new TypeError('Network unavailable');
    if (failedUrls.has(url.href)) return new Response('missing', { status: 404 });
    if (url.pathname === new URL(scope).pathname && typeof request !== 'string' && !(request instanceof URL) && request.mode === 'navigate') {
      return new Response(navigationBody, { status: navigationStatus });
    }
    return new Response(`resource ${url.pathname}`, { status: 200 });
  }

  for (const name of initialCaches) cacheFor(name);
  const context = {
    URL,
    Response,
    caches: {
      async open(name) { return cacheFor(name); },
      async keys() { return [...cacheStores.keys()]; },
      async delete(name) { return cacheStores.delete(name); }
    },
    fetch: networkFetch,
    self: {
      location: new URL(scope),
      registration: { scope },
      clients: { async claim() { clientsClaimed = true; } },
      async skipWaiting() { skipWaitingCalled = true; },
      addEventListener(name, handler) { handlers.set(name, handler); }
    }
  };
  vm.runInNewContext(worker, context);

  async function dispatch(name, event) {
    handlers.get(name)(event);
    return event.promise;
  }
  function fetchEvent(request) {
    return { request, respondWith(promise) { this.promise = promise; } };
  }
  return {
    cacheFor,
    cacheStores,
    dispatch,
    fetchEvent,
    requestedPaths,
    set offline(value) { offline = value; },
    set navigationStatus(value) { navigationStatus = value; },
    set navigationBody(value) { navigationBody = value; },
    get skipWaitingCalled() { return skipWaitingCalled; },
    get clientsClaimed() { return clientsClaimed; }
  };
}

test('service worker installation caches every app-shell resource and fails atomically for a missing asset', async () => {
  const harness = createWorkerHarness();
  await harness.dispatch('install', { waitUntil(promise) { this.promise = promise; } });

  const expectedPaths = [
    './',
    './manifest.webmanifest',
    './icons/mk-calculator-192.png',
    './icons/mk-calculator-512.png',
    './icons/mk-calculator.svg',
    './math-bot.js',
    './math-bot-client.js'
  ].map(path => new URL(path, appUrl).href);
  assert.deepEqual(harness.requestedPaths, expectedPaths);
  const cache = harness.cacheFor('mk-calculator-v3');
  for (const url of expectedPaths) assert.ok(await cache.match(url), `App shell should cache ${url}`);
  assert.equal(harness.skipWaitingCalled, true);

  const failingHarness = createWorkerHarness({ failedPaths: ['./icons/mk-calculator-512.png'] });
  await assert.rejects(failingHarness.dispatch('install', { waitUntil(promise) { this.promise = promise; } }));
  assert.equal(failingHarness.cacheFor('mk-calculator-v3').entries.size, 0);
  assert.equal(failingHarness.skipWaitingCalled, false);
});

test('activation removes obsolete project caches but preserves unrelated caches', async () => {
  const harness = createWorkerHarness({ initialCaches: ['mk-calculator-v1', 'unrelated-cache'] });
  await harness.dispatch('install', { waitUntil(promise) { this.promise = promise; } });
  await harness.dispatch('activate', { waitUntil(promise) { this.promise = promise; } });

  assert.deepEqual([...harness.cacheStores.keys()], ['unrelated-cache', 'mk-calculator-v3']);
  assert.equal(harness.clientsClaimed, true);
});

test('navigation uses fresh network responses, preserves good cache on HTTP failure, and falls back offline', async () => {
  const harness = createWorkerHarness();
  await harness.dispatch('install', { waitUntil(promise) { this.promise = promise; } });
  const cache = harness.cacheFor('mk-calculator-v3');
  const root = appUrl.href;
  const navigation = { method: 'GET', mode: 'navigate', url: root };

  const onlineResponse = await harness.dispatch('fetch', harness.fetchEvent(navigation));
  assert.equal(await onlineResponse.text(), 'network page');
  harness.navigationStatus = 503;
  harness.navigationBody = 'server error';
  const failedResponse = await harness.dispatch('fetch', harness.fetchEvent(navigation));
  assert.equal(failedResponse.status, 503);
  assert.equal(await (await cache.match(root)).text(), 'network page');

  harness.offline = true;
  const offlineResponse = await harness.dispatch('fetch', harness.fetchEvent(navigation));
  assert.equal(await offlineResponse.text(), 'network page');
  const emptyHarness = createWorkerHarness();
  emptyHarness.offline = true;
  const unavailableResponse = await emptyHarness.dispatch('fetch', emptyHarness.fetchEvent(navigation));
  assert.equal(unavailableResponse.type, 'error');
});

test('failed and missing assets are returned but never cached', async () => {
  const missingPath = './missing.js';
  const harness = createWorkerHarness({ failedPaths: [missingPath] });
  await harness.dispatch('install', { waitUntil(promise) { this.promise = promise; } });
  const missingUrl = new URL(missingPath, appUrl).href;
  const event = harness.fetchEvent({ method: 'GET', mode: 'same-origin', url: missingUrl });
  const response = await harness.dispatch('fetch', event);

  assert.equal(response.status, 404);
  assert.equal(await harness.cacheFor('mk-calculator-v3').match(missingUrl), undefined);
});
