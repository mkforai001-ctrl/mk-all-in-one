'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
  assert.match(worker, /const CACHE_NAME = 'mk-calculator-v2'/);
  assert.match(worker, /'\.\/icons\/mk-calculator-192\.png'/);
  assert.match(worker, /'\.\/icons\/mk-calculator-512\.png'/);
  assert.match(worker, /if \(response\.ok\) await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(worker, /if \(response\.ok\) await cache\.put\(new URL\('\.\/', self\.registration\.scope\), response\.clone\(\)\)/);
  assert.match(worker, /return await cache\.match\(new URL\('\.\/', self\.registration\.scope\)\) \|\| Response\.error\(\)/);
});
