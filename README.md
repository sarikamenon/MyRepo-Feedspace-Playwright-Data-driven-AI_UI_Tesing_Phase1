# Feedspace AI Visual Validation (Programmatic)

A streamlined Node.js automation framework that uses **Playwright** for browser control and **Google Gemini AI** for visual UI analysis.

## Overview

This framework fetches widget data (URLs, types, and configurations) from the Feedspace API and automatically validates the visual state of the widgets against their expected configurations.

## Features

- **Dynamic Data Source**: Fetches live test data from `https://api.feedspace.io/v3/embed-widget-urls`.
- **AI-Powered Validation**: No more brittle CSS selectors. Gemini AI analyzes screenshots to verify features.
- **Smart Detection**: Uses numeric widget type IDs for robust element identification.
- **Capability-Aware**: Each widget declares what it can actually render, so the AI is never asked to find a feature the widget was never built to show.
- **Visual Evidence**: Automatically captures high-resolution screenshots for every test run.
- **Consolidated Dashboard**: Generates a single HTML/JSON report summary for all tested URLs.

## Quick Start

### 1. Prerequisite

Copy the example environment file and add your Gemini API key:

```bash
cp .env.example .env
```

```env
GEMINI_API_KEY=your_api_key_here
```

`.env` is gitignored. `.env.example` lists every variable the runners read. Keep its `BASECAMP_*`
block commented out locally, or a local run reports to the real Basecamp project.

### 2. Install Dependencies

```bash
npm ci
npx playwright install chromium
```

The local runner launches the installed Google Chrome (`channel: 'chrome'`).

### 3. Run Validation

```bash
npm test                                                             # full local run from testData/testUrls.json
node runners/runValidation.js --url "https://example.com" --type AVATAR_GROUP
node runners/runValidation.js "--url=https://example.com/page?id=123"   # type auto-detected
```

Both `--flag value` and `--flag=value` work, and a URL's own query string is preserved. `--type` is
optional; without it the widget type is detected from the DOM and network traffic.

### 4. Run the Guard Suites

Offline, no browser and no Gemini call:

```bash
npm run test:guards        # all five suites
npm run test:coverage      # types resolve by ID and backend name; configs are consistent; popovers have helpers
npm run test:regression    # known false positives stay fixed
npm run test:engine        # the real processResults, fed synthetic model output
npm run test:invariants    # evaluate takes one argument; every DOM token the engine keys on is emitted
npm run test:movement      # the vertical-scroll direction verdict survives the marquee's loop reset
```

## Sample run against the demo widgets

Every widget has a live demo page: `https://embed.feedspace.io/<widget>` redirects to
`?id=<demo widget id>` (slugs and IDs live in `feedspace-embed-astro/src/pages/index-config.ts`).

```bash
node runners/runValidation.js --url "https://embed.feedspace.io/avatar-group?id=48cdb7e3-f7aa-4070-b385-60fc8aeeb591" --type 7
```

This is safe to run without credentials. With no `BASECAMP_*` variables the report is not posted and no
card is filed. With no `GEMINI_API_KEY` the engine returns a **hardcoded mock** verdict (always
`FAIL`, marked `mock: true` in the report JSON) **before the prompt is built**, so a keyless run
exercises detection, capability loading, capture, motion freezing and reporting, but not the prompt or
`processResults`. Those are covered by `npm run test:engine`.

The production entry points take the same inputs. Feed the on-demand runner the payload the backend
dispatches (the type is the backend's lowercased `Widget::TYPE` name, and there is no widget ID):

```bash
WIDGET_DATA='{"data":{"url":"<demo url>","type":"review_badge","configurations":{}}}' node runners/runApiValidation.ondemand.js
DAILY_BATCH_SIZE=2 node runners/runApiValidation.js   # rewrites testData/processed_urls.json; restore it afterwards
```

To dispatch a real run against a production URL (and how to read the widget id and type off the
page first), see [on-demand-runs.md](on-demand-runs.md).

## Project Structure

- `runners/`
  - `runValidation.js`: Local entry point, reads `testData/testUrls.json` or `--url`.
  - `runApiValidation.js`: Daily rotating batch pulled from the live API.
  - `runApiValidation.ondemand.js`: Triggered per embed via `repository_dispatch`.
- `helpers/`
  - `playwrightHelper.js`: Browser navigation, scrolling, widget discovery, screenshot capture.
  - `aiEngine.js`: Talks to Gemini and post-processes the verdict.
  - `promptBuilder.js`: Builds the validation prompt from the widget type, its capability config and the live payload.
  - `widgetDetector.js`: Maps numeric type IDs, aliases and CSS signatures to widget types.
  - `widgetConfigLoader.js`: Single source of truth for the widget-type to config-file map; reads capability declarations.
  - `widgetData.js`: The one empty-widget rule, shared by prevalidation, discovery and the engine.
  - `motionFreeze.js`: Pauses CSS motion (document **and** shadow roots) so animated widgets are captured on a stable frame.
  - `reasoningVerdict.js`: Shared rules for reading the model's reasoning (clearing verdicts, citation requirement).
  - `reportHelper.js`: Generates consolidated HTML/JSON reports.
  - `basecampHelper.js` / `basecampCardHelper.js`: Posts run summaries and files failure cards.
  - `interactiveWidgets/`: One helper per widget that needs clicking, scrolling or expanding.
- `Configs/`: Per-widget capability declarations. See below.
- `tests/`: Offline guard suites.
- `reports/`: Generated validation dashboards.
- `screenshots/`: Captured widget images.

## Widget capability configs

`Configs/<widget>Feature.json` declares what a widget actually renders. This is the mechanism that
stops the AI reporting a widget's designed behaviour as a defect.

| Field | Meaning |
| --- | --- |
| `features` | Features to audit for this widget. |
| `popover_only_features` | Supported, but rendered only after interaction (popover, panel, modal). Judged only in post-interaction screenshots; reported `NOT_APPLICABLE` when none was captured, never FAIL. |
| `unsupported_features` | Not implemented at all. Dropped before the prompt is built. |
| `aggregate_surface` | `true` when the resting state shows summary values (a score, a star row, a count) rather than review cards. |
| `surface_note` | One paragraph describing what the widget actually is, injected above the ground-truth data. |
| `commented_features` | Legacy exclusion list. |

Capability claims must match `docs/design/Widgets/**` in the `feedspace-embed-astro` repo, which is the
design source of truth. `npm run test:coverage` enforces that every shipped widget type has a config and
that no config contradicts itself.

## Adding a new widget type

1. Add the type ID, name, aliases and CSS signatures to `helpers/widgetDetector.js`. The runners
   receive the backend's lowercased `Widget::TYPE` name, never the ID, so that name must resolve
   too. Mirror it in `BACKEND_WIDGET_TYPE_NAMES` in `tests/widgetCoverage.test.js`.
2. Add the type-to-config-file entry in `helpers/widgetConfigLoader.js` (the only copy of that map).
3. Author `Configs/<widget>Feature.json` from the design doc, not from the running widget. A feature
   the widget renders only after a click, branding included, belongs in `popover_only_features`: the
   resting-surface DOM sniff never judges those.
4. Add a pre-analysis block for it in `helpers/promptBuilder.js`.
5. If the widget renders as a fixed overlay in a body-level portal, add its type to
   `BODY_LEVEL_OVERLAY_TYPES` and the class of its **visible** element to `FEEDSPACE_SELECTORS` in
   `helpers/playwrightHelper.js`. A zero-height wrapper will be judged hidden.
6. Add an interaction helper in `helpers/interactiveWidgets/` if the widget must be clicked or expanded,
   and dispatch it from `playwrightHelper.js`. `npm run test:coverage` fails for a widget that declares
   popover-only features but has no helper, because those features could only ever be `NOT_APPLICABLE`.
7. Run `npm run test:guards`, then a sample run against its demo page.

Until step 1 is done the runners **skip** the type with status `SKIPPED` and report it as a coverage
gap rather than failing it, so an unsupported widget never files a bug card.

## Known gaps

- The vertical-scroll movement check records its result in the report (`movementVerification`) but
  does not affect the verdict, because `Cross Scroll Animation` is not in `verticalScrollFeature.json`.
  Adding it there would turn a column measured moving the wrong way into a FAIL.
- Types 1, 12, 13, 15, 20 and 21 are deliberately exempt (forms, headless, or legacy). See `EXEMPT` in
  `tests/widgetCoverage.test.js`.
