'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const productionUrl = 'https://mkforai001-ctrl.github.io/mk-all-in-one/';

function headValue(name, attribute = 'name') {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"`))?.[1];
}

test('page metadata identifies the product and points canonical/social links to production', () => {
  assert.match(html, /<html lang="ha">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/);
  assert.match(html, /<title>MK Calculator — Hausa and English Online Calculators<\/title>/);
  assert.match(headValue('description'), /everyday maths, profit, discounts and loan estimates/i);
  assert.match(html, new RegExp(`<link rel="canonical" href="${productionUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
  assert.equal(headValue('og:url', 'property'), productionUrl);
  assert.match(headValue('og:title', 'property'), /MK Calculator/);
  assert.match(headValue('og:description', 'property'), /percentages.*discounts.*loan/i);
  assert.equal(headValue('twitter:card'), 'summary');
  assert.match(html, /<h1[^>]*data-i18n="welcome"/);
  assert.match(html, /Object\.assign\(translations\.ha,\{welcome:'MK Calculator:/);
  assert.match(html, /Object\.assign\(translations\.en,\{welcome:'MK Calculator:/);
});

test('favicon references existing subpath-safe local icons', () => {
  const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"[^>]*>/g)];
  assert.ok(links.length >= 3);
  for (const [, href] of links) {
    const url = new URL(href, productionUrl);
    assert.equal(url.origin, new URL(productionUrl).origin);
    assert.ok(url.pathname.startsWith('/mk-all-in-one/'));
    assert.ok(fs.existsSync(path.join(root, href.replace(/^\.\//, ''))), `Missing favicon asset ${href}`);
  }
});

test('JSON-LD describes only the real web application', () => {
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd, 'WebApplication JSON-LD is present');
  const data = JSON.parse(jsonLd);
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.name, 'MK Calculator');
  assert.equal(data.url, productionUrl);
  assert.equal(data.applicationCategory, 'UtilitiesApplication');
  assert.equal('aggregateRating' in data, false);
  assert.equal('offers' in data, false);
});

test('robots allows crawling and points to the existing one-page sitemap', () => {
  assert.match(robots, /^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/mkforai001-ctrl\.github\.io\/mk-all-in-one\/sitemap\.xml\n?$/);
  assert.equal(fs.existsSync(path.join(root, 'sitemap.xml')), true);
});

test('sitemap is well-formed for only the canonical public homepage', () => {
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>\s*$/);
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  assert.deepEqual(locations, [productionUrl]);
  assert.equal(new URL(locations[0]).pathname, '/mk-all-in-one/');
  assert.equal((sitemap.match(/<url>/g) || []).length, 1);
});