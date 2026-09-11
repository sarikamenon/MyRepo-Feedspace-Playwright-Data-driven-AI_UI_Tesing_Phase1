# Project Architecture and AI Visual Validation Guide

This document provides a comprehensive overview of the AI-driven UI testing and audit system developed for Feedspace widgets.

## Project Overview

The core objective of this project is to automate the visual verification of various Feedspace widgets (Carousel, Avatar Group, Vertical Scroll, etc.) using a combination of **Playwright** for browser automation and **Gemini AI** for high-level visual analysis.

---

## 🏗️ System Architecture

The project follows a modular architecture designed for scalability and robust interaction with complex widgets:

### 1. Orchestration Layer (`runners/`)

- `runValidation.js`: local run, reads `testData/testUrls.json` or a `--url` argument.
- `runApiValidation.js`: daily rotating batch pulled from `https://api.feedspace.io/v3/embed-widget-urls`.
- `runApiValidation.ondemand.js`: per-embed run triggered by `repository_dispatch`.

All three resolve the widget type first and **skip a supplied type the framework does not recognise**
as a coverage gap (status `SKIPPED`) rather than validating it with a generic feature set. An entry
with no type at all takes the auto-detect path instead.

The daily API and the on-demand dispatch both send the backend's lowercased `Widget::TYPE` name
(`avatar_blocks`, `review_badge`), never the numeric ID. A name the detector does not resolve is
skipped by the guard above, so every name needs an alias; `npm run test:coverage` checks them all.

### 2. Capability Layer (`Configs/` and `helpers/widgetConfigLoader.js`)

Each widget type declares what it actually renders: inline features, features that exist only inside a
popover or modal, features it does not implement at all, and whether its resting state is an aggregate
surface rather than review cards.

`widgetConfigLoader.js` owns the single widget-type to config-file map. Every other site imports it, so
adding a widget means editing one map, not five.

This layer is the gate in front of the AI. Without it the model is asked to find a review date on a
company-logo strip, or a card border on a surfaceless row, and reports the widget's intended design as a
defect. See `qa-automation-improvement-10-09-2026.md` for the ten cards that established this.

### 3. Discovery (`helpers/playwrightHelper.js`)

Discovery pierces shadow roots to find a **visible** widget container. Two widgets do not render inside
their embed div at all: the Floating Toast and the Floating Badge mount as `position: fixed` overlays in
a body-level portal. They are listed in `BODY_LEVEL_OVERLAY_TYPES`, which skips scroll-to-find and page
isolation for them (isolation would blank an overlay that is not a child of the embed container).

An empty widget is decided by one shared rule, `isEmptyWidgetData` in `helpers/widgetData.js`: empty
only when every review-bearing list is empty. Widgets do not all carry reviews in the same field.

The DOM item count is the other half of that gate, and it must recognise each widget's own item
element. The Review Badge is counted by `.feedspace-review-badge-card`: its Award layout has no logo
or avatar, so without that selector the count was 0 and the badge survived only while the widget API
answered within its 5 s timeout.

### 4. Interaction Specialized Helpers (`helpers/interactiveWidgets/`)

Each complex widget has a dedicated helper to manage its unique lifecycle:

- **`avatarGroupHelper.js`**:
  - Deduplicates avatars using `data-feed-id`.
  - Filters for visible elements to avoid "clicking hidden" errors.
  - Implements the **Click -> Capture -> Click Outside -> Wait** sequence.
  - Settles the popover position before measuring it, because the card flips and clamps after opening.
- **`horizontalScrollHelper.js` / `verticalScrollHelper.js`**:
  - Verify programmatic movement and capture state changes.
  - Freeze motion around each capture so a frame is never taken mid-transit.
- **`carouselSliderHelper.js` / `companyLogoSliderHelper.js` / `stripSliderHelper.js`**:
  - Freeze the marquee or auto-advance before capturing and before geometric measurement.
- **`floatingToastHelper.js`**:
  - Opens each toast's modal, captures it, and closes it before the next.
- **`avatarSliderHelper.js`**:
  - Manages click-based slider navigation.

`helpers/motionFreeze.js` is the shared freeze. It injects into the document **and every shadow root**,
because widgets render inside an open shadow root and `animation-play-state` is not inherited, so a
page-level style never reaches the animating track. Every freeze is released in a `finally`.

`page.evaluate` and `frame.evaluate` accept **one** argument after the function; pass several values as
one object. Three call sites broke this rule and silently failed behind a `.catch` for as long as they
existed. `tests/staticInvariants.test.js` now enforces it.

### 5. AI Engine (`aiEngine.js`, `promptBuilder.js`, `reasoningVerdict.js`)

- **Prompts**: Dynamically builds multi-layered instructions for Gemini based on the widget type, its
  capability declaration and the live JSON configuration.
- **Config resolution**: A key missing from the payload resolves to the **product default**, not to
  "off". Most review-card flags default on.
- **Feature Matrix**: Maps visual evidence (Stars, Dates, Social Icons, Read More) against expected
  configuration states to generate PASS/FAIL/NOT_APPLICABLE results.
- **Reasoning guards** (`reasoningVerdict.js`): keep the post-processor from inverting the model's own
  verdict. Shared with the regression suite so the test cannot drift from the engine.
- **Mock mode**: with no `GEMINI_API_KEY` the engine returns a hardcoded verdict **before** building the
  prompt. A keyless run therefore never exercises the prompt or `processResults`.

### 6. Reporting (`reportHelper.js`, `basecampHelper.js`, `basecampCardHelper.js`)

Generates the HTML/JSON dashboard and files a Basecamp card per genuine failure. Empty states and
`SKIPPED` coverage gaps deliberately produce no card, and skipped runs are counted in `summary.skipped`.
Nothing is posted without the `BASECAMP_*` variables.

### 7. Guard Suites (`tests/`)

Offline, no browser and no Gemini call. `npm run test:guards` runs all four.

- `widgetCoverage.test.js`: every widget type the product ships is supported or explicitly exempt, every
  supported type has a capability config, no config contradicts itself, and every backend `Widget::TYPE`
  name resolves to the same widget as its numeric ID.
- `falsePositiveRegression.test.js`: one group per historical false-positive card.
- `aiEngineProcessResults.test.js`: the real `processResults`, fed synthetic model output.
- `staticInvariants.test.js`: no `page`/`frame.evaluate` callback takes more than one parameter.

---

## 🧠 AI Analysis Logic

The AI analyzes provided screenshots based on strictly defined visual rules:

- **Global vs. Local Ratings**: Distinguishes between a widget's overall rating (e.g. "5.0") and individual user ratings inside popups.
- **Platform Icon Detection**: Specifically trained to recognize logos (Google, Twitter/X, Trustpilot) near the reviewer names.
- **Read More Triggers**: Looks for text truncation markers (`...`) or explicit links that expand content.
- **Date Consistency**: Scans the bottom/top corners for various date formats (relative and absolute).
- **Sharpness**: Judges an image on its own artifacts (step-laddering, macro-blocking, no iris detail).
  A rasterised photo being softer than vector text is the medium, not a defect, and intentional fades,
  gradient masks and video poster frames are excluded.
- **Identity binding**: Cards are bound to feed records by `tracking_id`. Reviewer names are not unique;
  one person can leave several reviews, and marquee widgets duplicate reviews to fill the track.

---

## 📊 Areas Covered

| Widget Type | Interaction Level | Specialized Verification |
| :--- | :--- | :--- |
| **Carousel / Slider** | Navigation | Arrow clicks, indicator dots, card counts. Horizontal edge overflow is expected and not flagged. |
| **Avatar Group** | High | Focused avatar shots, popup reveal, click-outside logic. Everything per-review is popover-only. |
| **Avatar Blocks** | High | Tile grid at rest; ratings and review content live in the modal. |
| **Marquee (H/V)** | State | Timed captures, frozen for each frame. Vertical column tracking does not reach shadow DOM yet. |
| **Strip Slider** | Medium | Compact band at rest; the review **date** appears only in the popup. |
| **Company Logo Slider** | Medium | Logo track has no card surface; date, ratings and icons are popover-only. |
| **Floating Cards** | Medium | Expansion modals, each closed before the next. |
| **Masonry / Horizontal Scroll** | Low | Grid alignment and text readability. Neither opens a popup. |
| **Floating Badge** | ⚠️ Resting only | Discovered as a body-level overlay and captured; no helper expands the panel yet. |
| **Review Badge** | ⚠️ Resting only | Source cards captured (Card or Award Layout); no helper opens the modal yet. |
| **Reviews & Ratings** | Not required | Opens nothing by design; Read More expands in place. |

---

## ⚠️ Limitations and Constraints

1. **Rate Limits**: The AI Engine implements a retry-with-exponential-backoff strategy to handle Gemini 429 errors.
2. **Dynamic Content**: Motion is frozen before capture, but widgets driven by JS transforms rather than CSS animation can still shift between measurement and screenshot.
3. **Multi-Widget Interference**: Pages with multiple overlapping widgets of the same type require precise selector targeting.
4. **Resolution**: Extremely high-res screenshots are needed for small markers like social icons, leading to larger buffers.
5. **No interaction helper for Floating Badge and Review Badge**: both are validated only in their resting state; their popover-only features report `NOT_APPLICABLE` on every run.
6. **Award Layout is not mechanically distinguished**: Review Badge layout is chosen per widget at runtime while capability configs are per widget **type**, so the Award Layout's missing logo and surface are handled by a prompt instruction rather than a config drop.
7. **Test data quality**: an expected widget type that does not match the embedded widget is reported as a `Test Data Mismatch`, but it is still labelled only. It lands in the same Basecamp column as a real defect.
8. **Shadow-DOM blind spots**: vertical-scroll column tracking and the carousel edge sentinel query `document`, which does not pierce the widget's shadow root, so both run but never report.

---

## 📈 Evolution and Roadmap

The project started as a basic screenshot tool and has evolved into an **Interactive Audit System**.

- **Phase 1**: Static captures and basic detection.
- **Phase 2**: Specialized interaction (helpers) and deduplication.
- **Phase 3**: Multi-screenshot AI validation with state cleanup (closing popups).
- **Phase 4**: Automated bug reporting to Basecamp (`basecampCardHelper.js`).
- **Phase 5 (Current)**: Capability-gated validation. The framework knows what each widget is built to
  render, measurements are evidence rather than verdicts, and offline guard suites protect against
  regression into known false positives. Verified against live demo widgets.
- **Next**: Interaction helpers for Floating Badge and Review Badge; shadow-DOM-aware column tracking and
  edge measurement; routing data defects away from the widget-defect queue; real-time dashboarding.
