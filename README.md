# MK Calculator

MK Calculator is a lightweight, mobile-first calculator for Hausa and English speakers. Hausa is the default language for new visitors. All calculations run in the browser, and money results use Nigerian naira (₦).

## Features

- Basic arithmetic, percentage, profit and loss, discount, and loan estimate calculators
- Hausa and English interface, with the selected language saved on the device
- Search, favorites, recently used calculators, and a saved light/dark theme
- Responsive layout and touch-friendly calculator controls
- Optional offline loading and Android installation through a web app manifest and service worker
- No user accounts, application backend, analytics, or third-party runtime dependencies

## Repository Files

```text
index.html                  Main application (HTML, CSS, and application JavaScript)
manifest.webmanifest        PWA name, display settings, and icon reference
robots.txt                  Crawl access rules and sitemap location
sitemap.xml                 Canonical public homepage URL
icons/                       SVG and PNG app icons
sw.js                       Versioned service worker and offline app-shell cache
tests/calculations.test.js  Node.js tests for the calculator math
tests/pwa.test.js           PWA path and service-worker lifecycle tests
tests/seo.test.js           Metadata, crawl files, and canonical-path tests
README.md                   Setup, publishing, and testing instructions
```

## Run Locally

In a GitHub Codespaces terminal, start a local web server from the repository folder:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open the **Ports** tab in Codespaces and open port `8000` in a browser. To test on an Android phone, set the forwarded port visibility to **Public** and open its forwarded HTTPS address on the phone. Stop the server with `Ctrl+C` when finished. Service workers require HTTPS or localhost; opening `index.html` directly as a file does not test PWA behavior.

## Run the Tests

Node.js 18 or newer is required. The tests use Node's built-in test runner and do not install packages.

```sh
node --test tests/*.test.js
```

## Publish with GitHub Pages

The repository's current Pages settings publish branch `main` from the repository root. To check or change them:

1. Open the repository on GitHub and choose **Settings**.
2. Open **Pages** under **Code and automation**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
4. Wait for the Pages deployment to finish in the repository's **Actions** tab.
5. Open `https://mkforai001-ctrl.github.io/mk-all-in-one/` and check the page over HTTPS.

The application, manifest, icon, and service worker use relative paths so they work when hosted under `/mk-all-in-one/`. Pages serves the latest committed and deployed version, not uncommitted Codespaces edits. After publishing, check all five calculators, switch languages and themes, and verify that favorites and recent items survive a reload.

## Install on Android

1. Open the deployed HTTPS address in Chrome on Android and allow the page to finish loading.
2. Open Chrome's menu and choose **Install app** or **Add to Home screen** if offered.
3. Launch MK Calculator from the new home-screen icon and confirm that it opens without browser controls.

The exact menu wording and whether installation is offered depend on the Android and Chrome versions. Installation has not been verified on a physical Android device as part of this repository check.

## Test Offline Loading

1. Open the deployed HTTPS page while online and wait for it to finish loading.
2. Reload it once online so the service worker can install and take control.
3. Turn on Airplane mode, then reload the page or reopen the installed app.
4. Confirm the calculator interface opens and calculations still work. Turn Airplane mode off afterward.

The service worker caches the app shell, serves navigation from the network when available, falls back to the cached app shell offline, and removes older app caches when its version changes. Offline behavior still needs to be confirmed in a real browser.

## Limitations and Bug Reports

- Loan results are estimates for fixed-rate monthly repayments. Fees, lender rules, and other charges are not included.
- Preferences, favorites, and recent calculators are stored only in the current browser's local storage; clearing site data or changing browsers removes them.
- PWA installation and offline behavior require a supported browser and a secure HTTPS origin. They cannot be confirmed by a source-only test.
- No physical-device, screen-reader, or automated browser-layout test has been run for this project.

To report a bug, open an issue in this GitHub repository. Include the calculator, browser and device, selected language, example inputs, and expected versus actual result. Do not include private financial or personal information.

## Search Engine Setup

The production website is `https://mkforai001-ctrl.github.io/mk-all-in-one/`. Its crawl rules are at `/robots.txt`, and its one-page sitemap is at `/sitemap.xml`. The sitemap lists only the public canonical homepage; submitting it does not guarantee indexing or rankings.

To use Google Search Console:

1. Sign in at [Google Search Console](https://search.google.com/search-console/about) and add the exact URL-prefix property `https://mkforai001-ctrl.github.io/mk-all-in-one/`.
2. Complete one of the ownership verification methods Google offers. For the HTML-tag method, copy the complete tag issued for your property into the `<head>` of `index.html`, then publish and request verification. No verification token is included in this repository, and ownership has not been verified here.
3. In Search Console, submit `https://mkforai001-ctrl.github.io/mk-all-in-one/sitemap.xml` under **Sitemaps**.
4. Use **URL inspection** for `https://mkforai001-ctrl.github.io/mk-all-in-one/` to review Google's canonical and crawl status. If eligible, request indexing.
5. Monitor the Page indexing and Search results performance reports for discovery and search activity.

Google's official guides: [verify site ownership](https://support.google.com/webmasters/answer/9008080), [submit a sitemap](https://support.google.com/webmasters/answer/7451001), and [URL Inspection](https://support.google.com/webmasters/answer/9012289). Search Console actions do not guarantee that a page will be indexed or shown for a particular query. GitHub Pages serves static files and does not provide server-side rendering controls or arbitrary response-header configuration for this project.
