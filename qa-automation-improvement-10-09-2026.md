# QA Automation Improvement - 10-09-2026

Review of every `[Widget FAIL]` card that reached **Done** on the Feedspace.io Basecamp board,
and the framework changes those cards imply.

- **Source:** 10 Done cards created by the AI Visual Validation pipeline between 2026-08-05 and 2026-09-01.
- **Board:** Feedspace.io / Engineering / Done (`bucket 19240348`).
- **Verdict:** **8 of 10 were framework defects, not product defects.** One was a backend data problem,
  one carried a genuine product question about popover spacing.

The pipeline is currently generating more noise than signal. Every card below was triaged by a human,
and in eight cases the human's finding was a variant of "the widget is fine, the checker is wrong".

---

## 1. Source cards

| # | Card | Widget | Reported reason | Human finding | Class |
| --- | --- | --- | --- | --- | --- |
| 1 | [10166965764](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10166965764) | MARQUEE_STRIPE | Show Review Date: UI Absent, Config Visible | Strip slider does not show the date on animated cards | Framework |
| 2 | [10180368782](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10180368782) | Widget Not Found | Expected FLOATING_TOAST, identified SINGLE_SLIDER | Wrong data from backend; it was always a single slider | Data |
| 3 | [10206673133](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10206673133) | FLOATING_TOAST | Avatar macro-blocking and pixelation | Image is fine; mistakenly flagged by AI | Framework |
| 4 | [10207208742](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10207208742) | MARQUEE_LEFTRIGHT | Video thumbnails soft and blurry | Customer added a fade effect; bot misread it | Framework |
| 5 | [10211057218](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10211057218) | CAROUSEL_SLIDER | Partially visible card at carousel edge | False; screenshots taken mid-animation | Framework |
| 6 | [10214516244](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10214516244) | MARQUEE_UPDOWN | Ratings visible despite rating of 0 | False; two reviews by the same person caused the confusion | Framework |
| 7 | [10224702609](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10224702609) | AVATAR_GROUP | Popup clipped, only 60% visible, zero padding | Mostly false positives; screenshot did not capture the whole widget | Framework + product question |
| 8 | [10246278068](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10246278068) | AVATAR_GROUP | Popups sliced, only 21% visible, text truncated | False positive; none of it is present in the screenshots | Framework |
| 9 | [10253013311](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10253013311) | MARQUEE_LEFTRIGHT | Social icon visible but config absent | `show_platform_icon` was missing and defaults to true | Framework |
| 10 | [10260035764](https://app.basecamp.com/4294983/buckets/19240348/card_tables/cards/10260035764) | COMPANY_LOGO_SLIDER | Date, ratings, platform icon absent vs config visible | This widget does not show these; validation logic needs an update | Framework |

---

## 2. Issues

Eight distinct defects, grouped by the mechanism that produces them.

> File and line references in this section describe the code **as it stood when these cards were
> filed**, so the diagnosis stays readable against the failures it explains. Most of these lines have
> since moved or been rewritten by the changes in section 3; use `git log` on this file's date for the
> before-and-after.

### Group A: the framework does not know what each widget actually renders

**QA-1. Feature configs claim capabilities the widget does not have.** (cards 1, 10)

`Configs/*.json` is the per-widget capability matrix, but its entries are aspirational rather than
descriptive. Two are demonstrably wrong against the shipped design:

- `Configs/stripSliderFeature.json` lists `Show Review Date`. The design spec for the Strip Slider
  puts Ratings and Source Icon on the compact slider card but **Date only in the popup**
  (`docs/design/Widgets/Strip-Slider/Index.md:43-44` in `feedspace-embed-astro`).
- `Configs/companyLogoSliderFeature.json` lists `Show Review Date`, `Show Review Ratings` and
  `Show Social Platform Icon`. The Company Logo Slider's row has **no card surface at all**
  (`Surface: none - no card, no background, no border`); every one of those three lives in the
  popover (`docs/design/Widgets/Company-Logo-Slider/Index.md:19-26`).

There is a `commented_features` array already available as the exclusion mechanism, but it does not
distinguish "not supported" from "supported, but only inside a popover", which is the actual
situation for both widgets.

**QA-2. Missing config keys resolve to Absent instead of the product default.** (card 9)

`helpers/promptBuilder.js:77-80` treats an absent key as "feature off":

```js
} else {
  // Default behavior for missing keys
  const isInverted = invertedFeatures[featureName];
  expected = isInverted ? "Visible" : "Absent";
}
```

`show_platform_icon` was absent from that widget's payload and the product defaults it to **true**, so
the widget correctly rendered icons and the checker called it a regression. Every key in `featureMap`
needs a declared default that matches backend behaviour; a blanket "Absent" is wrong for any
default-on flag.

### Group B: DOM measurements are treated as infallible and force a FAIL

**QA-3. The popover edge sentinel measures a viewport-anchored surface against the viewport.** (cards 7, 8)

`helpers/interactiveWidgets/avatarGroupHelper.js:245-249` fails any popup within 20px of the viewport
bottom, and line 294 fails any popup whose visible area is under 98%.

The Avatar Group popover is **deliberately viewport-positioned, not container-capped**
(`docs/design/Widgets/Avatar-Group/Popover-Card.md:129`), it flips above the row when there is not
enough room below (line 181-183), and the spec explicitly states that when an expanded card outgrows
the viewport **the page scrolls** (line 124). A popover resting near the viewport edge is the
designed behaviour, so the sentinel is asserting the opposite of the spec.

Compounding it, the measurement is taken immediately after the click, before the flip and clamp have
settled, so `visibleRatio` is sampled against a position the popover is still leaving.

**QA-4. Geometric warnings are injected as non-negotiable truth and force overall FAIL.** (cards 7, 8)

Whatever QA-3 produces is passed into the prompt as `SECTION -1: SYSTEM FORCE OVERRIDE` with
`**MANDATORY**: You MUST prioritize these DOM Facts over your own visual analysis`
(`helpers/promptBuilder.js:131`), and `helpers/aiEngine.js:960-965` then rewrites the category to
FAIL and sets `aiData.overall_status = 'FAIL'` unconditionally.

This is why card 8 reads "None of the issues mentioned are even present in the screenshots": the model
was ordered to report defects it could not see. A bad measurement cannot be caught by the model, and a
FAIL is guaranteed to become a Basecamp card.

### Group C: the reasoning scanner inverts the model's own verdict

**QA-5. `findAdmission` keyword-matches defect words and ignores the surrounding verdict.** (cards 3, 4, 5)

`helpers/aiEngine.js:489+` scans the model's free-text reasoning for defect keywords, then
`helpers/aiEngine.js:668-692` flips any PASS category to FAIL with a "Quality audit override" or
"Visual audit override".

The negation guard only inspects text **before** the keyword, so a sentence that names a defect and
then clears it still trips. Card 5 is the clearest case; the model wrote:

> "cards at the edges are often partially visible/cut off. **This is a PASS for carousel sliders** if
> the main content area is clear."

The verdict sits after the keyword, so the override never saw it and filed a CRITICAL layout failure
against a card the model had explicitly passed. Cards 3 and 4 are the same mechanism on the avatar and
media sharpness keywords, where "soft" and "blurry" appear in reasoning that concludes the image is
acceptable.

**QA-6. Sharpness auditing has no notion of intentional visual effects.** (card 4)

The customer applied a fade/gradient mask to the marquee. The framework has no way to distinguish a
deliberate edge fade from a genuine encoding defect, so the softened edge became "video thumbnails are
noticeably soft and blurry". The marquee fade is a documented part of the design
(`docs/design/Widgets/Company-Logo-Slider/Page.md` covers the fades), not a rendering fault.

### Group D: capture and data-mapping

**QA-7. Only the strip slider freezes motion; other animated widgets are captured mid-flight.** (card 5)

`helpers/interactiveWidgets/stripSliderHelper.js:14-28` injects a motion freeze:

```js
*, *::before, *::after {
  animation-play-state: paused !important;
  transition: none !important;
}
```

`carouselSliderHelper.js`, `companyLogoSliderHelper.js` and the marquee helpers do not. They rely on
Playwright's `animations: 'disabled'`, which finishes or cancels animations rather than freezing an
**infinite** marquee at a stable frame. The result is exactly what card 5 recorded: a slide caught
half-way through its transit, then reported as a clipped card.

**QA-8. Feed mapping is by reviewer name, which collides when one person leaves two reviews.** (card 6)

`helpers/promptBuilder.js:118` instructs the model:

```js
mapping_hint: `Match pixel initials '${initials}' or name '${name}' to Tracking ID: ${trackingId}`
```

Name and initials are not unique. Card 6 had two reviews from the same reviewer, one rated and one
not, so the model bound the on-screen rating to the wrong feed record and reported a rating rendered
against a 0-rating review. `id` and `tracking_id` are already in the payload but the hint steers
matching to the ambiguous fields.

Related and worth noting: `helpers/promptBuilder.js:92` caps ground-truth feeds at 20
(`Limited to 20 for token efficiency`), while marquee widgets duplicate their items to fill the track.
The Company Logo Slider draws from only 10 eligible reviews and repeats them, so the same review
appears many times on screen, which is a second source of duplicate-identity confusion.

### Not a framework defect

**QA-9. Expected widget type came from bad backend data.** (card 2)

`expectedType` is resolved from the API `type` field (`helpers/playwrightHelper.js:401`) and the page
had always embedded a single slider. The framework behaved correctly; the data was wrong. It is
recorded here because the **classification** is wrong: a stale or incorrect expected type is reported
as `configuration mismatch`, which reads as a product regression and reaches the same Basecamp queue
as real UI failures.

**QA-10. Popover bottom spacing (product question, card 7).** Amit asked whether a margin should be
guaranteed below the popover. That is a design decision for the embed team, not a framework change,
and is listed here only so it is not lost.

---

## 3. Changes

Complete list, for the record. Status is filled in as work lands.

| ID | Change | Files | Cards | Status |
| --- | --- | --- | --- | --- |
| C-1 | Added `popover_only_features` to the widget config schema; `Show Review Date` is now popover-only for the strip slider | `Configs/stripSliderFeature.json` | 10166965764 | Done |
| C-2 | `Show Review Date`, `Show Review Ratings` and `Show Social Platform Icon` are now popover-only for the company logo slider | `Configs/companyLogoSliderFeature.json` | 10260035764 | Done |
| C-3 | Prompt builder tags popover-only features and instructs the model to judge them only in popover screenshots, reporting `NOT_APPLICABLE` when no popover was captured | `helpers/promptBuilder.js`, `helpers/widgetConfigLoader.js` (new) | 10166965764, 10260035764 | Done |
| C-4 | Added `configKeyDefaults` carrying each key's real product default; an absent key now resolves to that default instead of "Absent" | `helpers/promptBuilder.js` | 10253013311 | Done |
| C-5 | Audited all 11 remaining configs against `docs/design/Widgets/**`. Avatar Group and Avatar Blocks render nothing per-review at rest, so those features are now popover/modal-only; Cross Slider and Avatar Slider are marked surfaceless; Horizontal Scroll and Masonry had their popover claims cleared because they open no popup at all | `Configs/*.json` | 10166965764, 10260035764 | Done |
| C-6 | Added `_settlePopupBox`, which polls until two consecutive bounding boxes agree, so the popover is measured after the flip and clamp rather than during them | `helpers/interactiveWidgets/avatarGroupHelper.js` | 10224702609, 10246278068 | Done |
| C-7 | Edge sentinel no longer fails on proximity to the viewport edge; it reports only genuine overflow past the viewport, as advisory | `helpers/interactiveWidgets/avatarGroupHelper.js` | 10224702609, 10246278068 | Done |
| C-8 | Introduced an `ADVISORY:` tier. Advisory measurements are excluded from the forced-FAIL filter and presented to the model as evidence it must corroborate against a screenshot | `helpers/aiEngine.js`, `helpers/promptBuilder.js` | 10224702609, 10246278068 | Done |
| C-9 | `findAdmission` now skips any reasoning line carrying a clearing verdict (`is a pass`, `by design`, `acceptable`, `expected behaviour`, and similar) anywhere in the line | `helpers/aiEngine.js` | 10206673133, 10207208742, 10211057218 | Done |
| C-10 | A reasoning override may now flip a PASS only if the line cites something locatable: a named screenshot, card, element or position. A bare defect word in prose is ignored and logged | `helpers/aiEngine.js` | 10246278068 | Done |
| C-11 | Removed the two rules that made a FAIL unavoidable for any photo ("any image softer than the vector text is a defect", "if you cannot see razor-sharp grain matching the 'l' in the name, it is a FAIL") and added explicit exceptions for intentional fades, gradient masks and video poster frames | `helpers/promptBuilder.js` | 10206673133, 10207208742 | Done |
| C-12 | Extracted the motion freeze into `helpers/motionFreeze.js` and applied it to the carousel (around each capture and the sentinel), the company logo slider baseline, and the vertical scroll marquee. Horizontal scroll already paused motion itself; the strip slider was the original. See R-1: the first version of this could not cross the shadow boundary and did nothing | `helpers/motionFreeze.js` (new), `helpers/interactiveWidgets/*` | 10211057218 | Done |
| C-13 | `mapping_hint` now flags ambiguity explicitly and directs binding to `tracking_id` when a reviewer name is not unique | `helpers/promptBuilder.js` | 10214516244 | Done |
| C-14 | Prompt now names duplicate reviewers and states that marquee and logo-strip widgets repeat reviews to fill the track | `helpers/promptBuilder.js` | 10214516244 | Done |
| C-15 | Prompt now declares when the ground-truth list is partial, so unlisted on-screen cards are not read as defects. The cap itself is unchanged | `helpers/promptBuilder.js` | 10214516244 | Done (documented, cap not raised) |
| C-16 | Type mismatch is reported as `Test Data Mismatch` and classified separately from `configuration mismatch` so it routes to the data owner | `helpers/playwrightHelper.js`, `helpers/basecampCardHelper.js` | 10180368782 | Done |
| C-17 | Added `tests/falsePositiveRegression.test.js`: 32 assertions, one group per card, fully offline (no browser, no Gemini call) | `tests/falsePositiveRegression.test.js` (new) | all 10 | Done |

Additionally, the carousel edge sentinel no longer checks horizontal overflow at all. A carousel is
designed to show partially visible slides at its left and right edges, so that check reported the
widget's intended behaviour as a layout failure. Vertical clipping is still checked.

### Files added

| File | Purpose |
| --- | --- |
| `helpers/widgetConfigLoader.js` | Loads a widget's `Configs/*.json` by type and exposes `popover_only_features`. Owns the widget-to-config-file map so the prompt builder does not need a fifth copy of it. |
| `helpers/motionFreeze.js` | Pauses CSS animation and transitions around a capture. Playwright's `animations: 'disabled'` finishes or cancels animations rather than holding an infinite marquee still. |

### Verification

Four offline guard suites run without a browser or a Gemini call:

```bash
npm run test:guards        # all four suites
npm run test:coverage      # widget coverage guard       -> 89 assertions
npm run test:regression    # false-positive corpus       -> 32 assertions
npm run test:engine        # real processResults         -> 13 assertions
npm run test:invariants    # evaluate-argument invariant -> 1 check over 46 call sites
```

**`tests/widgetCoverage.test.js`** asserts that every widget type the product ships is either supported
or explicitly exempt with a stated reason, that every supported type has a capability config, and that
no config contradicts itself. Point it at the live source of truth with
`EMBED_CONSTANTS_PATH=<path>/feedspace-embed-astro/src/embed/constants.ts`; it passes against both that
and the pinned table. It caught a real bug in the Review Badge config written minutes earlier, where two
popover-only features were absent from `features` and so would never have been checked. It also
resolves every backend `Widget::TYPE` name, because that name, not the ID, is what the runners receive
(G-1 below); `BACKEND_WIDGET_MODEL_PATH=<path>/Feedspace-Backend-3.0/app/Models/Widget/Widget.php`
checks against the live model instead of the pinned table.

**`tests/falsePositiveRegression.test.js`** has one group per source card, asserting the framework no
longer manufactures that specific failure. It imports the engine's clearing and citation rules rather
than copying them.

**`tests/aiEngineProcessResults.test.js`** and **`tests/staticInvariants.test.js`** were added after the
live runs; see Live verification below.

`node --check` passes on every file under `helpers/`, `runners/` and `tests/`, and every
`Configs/*.json` parses. `testData/processed_urls.json` is empty and does not parse as JSON; that
predates this work and is left alone.

The pipeline has since been run end to end against live demo widgets. See **Live verification
(11-09-2026)** for what that did and did not exercise, and **Production-path verification** for the
two runners production actually calls, fed the input production actually sends.

### Coverage gap: newer widgets the framework could not see (now closed)

**When this review started, none of the fixes above reached the newest widgets, because the framework
did not know they existed.** `helpers/widgetDetector.js` recognised 12 type IDs (4-11, 16-19) while the
product shipped 24. The table below is the state after C-18 to C-22.

| Type ID | Widget | Detector | `Configs/*.json` | Interactive helper | Prompt section |
| --- | --- | --- | --- | --- | --- |
| 22 | Floating Badge | **Added** | **floatingBadgeFeature** | pending, uses generic flow | **Added** |
| 23 | Review Badge | **Added** | **reviewBadgeFeature** | pending, uses generic flow | **Added** |
| 24 | Review and Ratings | **Added** | **reviewAndRatingsFeature** | not needed, opens nothing | **Added** |
| 20 | AI Native Form (inline) | Exempt | n/a - collects reviews, renders none | n/a | n/a |
| 21 | AI Native Form (modal) | Exempt | n/a - collects reviews, renders none | n/a | n/a |
| 15 | SEO Rich Snippet | Exempt | n/a - headless, no visual output | n/a | n/a |
| 1 | WOL | Exempt | n/a - legacy wall-of-love page | n/a | n/a |
| 12, 13 | Native Form (inline, modal) | Exempt | n/a - collects reviews, renders none | n/a | n/a |

Source of truth: `src/embed/constants.ts` `WIDGET_TYPE` in `feedspace-embed-astro`.

**What used to happen when one of these was tested.** Verified by running the detector before the fix:

```text
WidgetDetector.identify({ type: 22 })  =>  "Unknown"
WidgetDetector.identify({ type: 23 })  =>  "Unknown"
WidgetDetector.identify({ type: 24 })  =>  "Unknown"
```

Nothing skipped an unknown type. The runner resolved `typeName` to `Unknown`,
`WIDGET_CONFIG_MAP['Unknown']` missed, `Configs/unknown.json` did not exist, so `staticFeatures`
stayed null and the prompt builder fell back to auto-detecting features from whatever keys appeared in
the payload. The model was then asked to audit `Show Review Date`, `Show Review Ratings` and
`Review Card Border & Shadow` against a **Floating Badge**, which is an aggregate rating badge with
no review cards at all. That is the same false-positive engine this document is about, pointed at
three widgets whose capability matrix did not exist.

**What happens now.** All three resolve, each has a capability config and its own pre-analysis block,
and any type that is still unrecognised is **skipped** with status `SKIPPED` rather than failed, so it
files no Basecamp card:

```text
WidgetDetector.identify({ type: 22 })  =>  "FLOATING_BADGE"
WidgetDetector.identify({ type: 23 })  =>  "REVIEW_BADGE"
WidgetDetector.identify({ type: 24 })  =>  "REVIEW_AND_RATINGS"
```

The Review Badge and Floating Badge are **aggregate** surfaces (one card per source, or a single score
badge). Per-review concepts such as reviewer name, review date and Read More do not apply to their
resting state, so `aggregate_surface: true` in their configs emits a prompt banner telling the model
not to look for review content there, and `unsupported_features` drops the inapplicable checks before
they ever reach the model.

The config schema gained three fields to express this:

| Field | Meaning |
| --- | --- |
| `popover_only_features` | Supported, but rendered only after interaction. Judge in popover/panel/modal screenshots; `NOT_APPLICABLE` if none was captured |
| `unsupported_features` | Not implemented at all. Dropped before the prompt is built |
| `aggregate_surface` | The resting state shows summary values, not review cards |
| `surface_note` | One paragraph telling the model what the widget actually is, injected above the ground-truth data |

| ID | Change | Files | Cards | Status |
| --- | --- | --- | --- | --- |
| C-18 | Add types 22, 23, 24 to `WidgetTypeConstants`, `WidgetTypeNames`, `WidgetAliases` and `CSS_SIGNATURES` | `helpers/widgetDetector.js` | n/a | Done |
| C-19 | Author `Configs/floatingBadgeFeature.json`, `reviewBadgeFeature.json` and `reviewAndRatingsFeature.json` from `docs/design/Widgets/{Floating-Badge,Review-Badge,Reviews-And-Ratings}` | `Configs/*.json` | n/a | Done |
| C-20 | Add an aggregate-widget feature vocabulary so badges are not audited for per-review fields | `helpers/promptBuilder.js` | n/a | Done |
| C-21 | Skip, rather than fail, any widget type the detector does not recognise, and report it as an explicit coverage gap | `runners/*.js`, `helpers/playwrightHelper.js` | n/a | Done |
| C-22 | Add a guard test asserting every `WIDGET_TYPE` in the embed constants has a detector entry and a config file | new | n/a | Done |

C-21 is the one to do first: it converts a guaranteed stream of false-positive cards into a single
honest "not covered" line, and it is a small change.

### Review pass and corrections

The changes above were code-reviewed after the fact. The review found 15 issues; 14 were confirmed
against the code and fixed, 1 was wrong. Recorded here because several were regressions introduced by
the fixes themselves.

| ID | Defect found in review | Severity | Resolution |
| --- | --- | --- | --- |
| R-1 | `MotionFreeze` injected a document-level `<style>`, which cannot cross the shadow boundary. Widgets render in an open shadow root and `animation-play-state` is not inherited, so **all three new call sites were no-ops** and C-12 fixed nothing | Critical | Freeze is now injected into every shadow root as well as the document, and removed from both on release |
| R-2 | The coverage-gap guard skipped any entry with no type at all, breaking `runValidation --url=<page>` (which hard-codes `type: 'Unknown'`) and the on-demand bare-URL-string path. Both are auto-detect flows that used to work | High | The guard now fires only when a type was actually supplied and is unrecognised; a missing type falls through to auto-detection |
| R-3 | `hasClearingVerdict` matched bare substrings, so "unintentional" contained "intentional", and "the text rendering is fine" cleared a blurry avatar named in the same line | High | List narrowed to explicit verdict forms only; a line carrying a hard `FAIL_*` token can never be cleared. Four over-suppression cases added to the corpus |
| R-4 | The rewritten MISSING CONFIG RULE kept its old trailing line, so the prompt said "trust the stated Config Status" and then "if you see it in pixels, flag as FAIL" - re-manufacturing card 10253013311 | High | Trailing line rewritten to defer to the STATUS DETERMINATION table |
| R-5 | The `Review Image / Avatar` alias pair was OR-ed, so a dead legacy key could override the real `show_profile_picture: 0` | Medium | Alias groups now resolve first-key-present, with the live key listed first. Composite features (border OR shadow) keep the OR |
| R-6 | `waitForTimeout` ran **after** `MotionFreeze.apply` in all three call sites, so it was dead time and a track paused mid-transit stayed mid-transit | Medium | Wait moved before the freeze in all four sites |
| R-7 | `iconCited` was computed but missing from the reasoning-audit outer guard | Medium | **No effect.** Wired in, but no aesthetic category contains "ICON", so the branch it feeds can never match. Corrected by L-7 |
| R-8 | `layout_variants` in the Review Badge config was dead: nothing reads it, so the Award Layout was still audited for a platform logo it does not render | Medium | Replaced with a `known_limitation` note. The mechanical drop cannot work here because layout is per-widget and configs are per-type; the prompt block carries the rule |
| R-9 | C-16 was overclaimed. The `test data mismatch` label does not reroute anything: same column, same assignee, still counted as FAIL | Medium | Comment and this document corrected to say it relabels only |
| R-10 | The regression corpus hand-copied the clearing list and citation regex, so it could stay green while production regressed | Medium | Both extracted to `helpers/reasoningVerdict.js` and imported by engine and test alike |
| R-11 | Five divergent copies of `WIDGET_CONFIG_MAP`. The three runner copies were already missing `STRIP_SLIDER`, `AVATAR_SLIDER` and `GRID`, so those silently loaded no features | Medium | One definition in `widgetConfigLoader.js`; all four other sites import it |
| R-12 | `SKIPPED` runs inflated `total` but landed in no bucket. `reportHelper` already renders `summary.skipped`, which no runner ever set | Low | All three runners now report `skipped` |
| R-13 | The live-constants parser required a trailing comma and read to end-of-file | Low | Bounded to the object literal; trailing comma optional. Verified against both forms |
| R-14 | Types 22/23/24 pass the guard and are audited, but there is no interaction branch for them, so their popover-only features report `NOT_APPLICABLE` forever | Known limitation | Documented in Verification below; needs interaction helpers |
| R-15 | Claim that the parser drops the last `WIDGET_TYPE` entry | **Not a defect** | Verified false: the live file has a trailing comma and all 21 types parsed. The fragility was still worth removing (R-13) |

### Live verification (11-09-2026)

Everything above had been verified only statically: syntax checks, config parsing and offline
assertions. It was then run for real against the widget demo pages on `embed.feedspace.io`, which
serve each widget from a live demo ID. No `GEMINI_API_KEY` and no Basecamp credentials exist on the
machine, so the AI verdict is the engine's hardcoded mock and nothing was posted to Basecamp. Every
`Overall Status: FAIL` in these runs is that mock (`aiAnalysis.mock: true` in the report JSON), not a
judgement. What the runs do exercise for real is detection, capability loading, capture, motion
freezing, measurement and reporting.

| Widget | Type | Result | What it proved |
| --- | --- | --- | --- |
| Carousel | 4 | Clean after L-3/L-4 | Freeze reaches 2 shadow roots; the track is captured settled on whole slides (the card 10211057218 scenario) |
| Floating Badge | 22 | Clean after L-6 | Autodiscovered with no `--type`; overlay isolation skipped; the 252x81 bar is captured |
| Review Badge | 23 | Clean after L-2 | Passes every empty-state gate; the Award Layout is captured |
| Review and Ratings | 24 | Clean first run | Config and capture work with no interaction helper, as designed |
| Avatar Group | 7 | Clean | Every popover "sits fully inside the viewport after settling"; no boundary finding (cards 10224702609, 10246278068) |
| Company Logo Slider | 18 | Clean | Freeze reaches 3 shadow roots and releases through `try/finally` |
| Strip Slider | 6 | Clean | 14 captures, no errors |
| Vertical Scroll | 9 | Clean | Freeze on all 3 phases; a stable frame with the intentional edge fade intact |
| Floating Cards | 11 | Clean after L-5 | Modals open and close; 6 unique cards captured (5 before the fix) |
| AI Native Form | 20 | Skipped | Coverage-gap skip, counted in `summary.skipped` |
| Floating Cards page run as `--type 4` | 4 vs 11 | Mismatch reported | `Test Data Mismatch` wording end to end (C-16) |

The runs found eight defects the static checks could not:

| ID | Defect found live | Origin | Resolution |
| --- | --- | --- | --- |
| L-1 | `--url=<page>` split on every `=`, cutting a demo URL's `?id=<uuid>`. With no `--type`, `args[indexOf('--type')+1]` read `args[0]`, so `--url` itself became the widget type and the coverage guard (R-2) skipped the run | Pre-existing parser, made fatal by R-2 | `getArg()` splits on the first `=` only and returns `undefined` for an absent flag. Verified live: the inline form keeps the query string, and a run with no `--type` autodiscovers |
| L-2 | The Review Badge ships `feeds_data: []` beside `feeds: [11]` and `badge_sources: [2]`. **Three** separate inline copies of an "any list empty" rule existed (prevalidation, the DOM-sniff backup, and the engine); the DOM-sniff copy re-condemned the badge immediately after the API bypass had cleared it | Pre-existing, blocked C-19 | One rule, `isEmptyWidgetData` in `helpers/widgetData.js` (empty only when every review list is empty), used at all three sites |
| L-3 | The carousel edge sentinel called `page.evaluate(fn, a, b, c)`. Playwright accepts one argument, so it threw "Too many arguments" on every run and **never measured anything** | Pre-existing | Single object argument |
| L-4 | That throw landed between `MotionFreeze.apply` and `release`, leaving the page frozen for everything after it. The company logo baseline had the same exposure | Introduced by C-12 | `try/finally` release at both sites |
| L-5 | Both floating-toast `evaluate` calls passed two arguments behind a `.catch`, so the modal-close step **has never worked** and `closed` was always `false`. This is the widget from card 10206673133 | Pre-existing | Single object argument; `.catch` handlers kept |
| L-6 | The Floating Badge portals into a body-level `div.feedspace-floating-portal` shadow root and leaves its embed div empty, so discovery saw only hidden candidates and declared the container HIDDEN. Its `-root` wrapper is 1920x0, so matching that failed too | New widget | Discovery targets `.feedspace-floating-badge`, the fixed 252x81 bar. Scroll-to-find and page isolation are skipped for `BODY_LEVEL_OVERLAY_TYPES` (Floating Toast and Floating Badge) |
| L-7 | R-7 wired `iconCited` into the override guard, but no aesthetic category contains "ICON" (A-G are layout, containment, content, avatar, media, theme, popups), so that branch can never match | R-7 was a no-op | Comment corrected and R-7 re-graded. Icon violations are handled at feature level |
| L-8 | `npm test` ran `node runValidation.js`, a file that does not exist at the repo root | Pre-existing | Script points at `runners/runValidation.js` |

Two suites were added as a result. `tests/staticInvariants.test.js` fails on any `page`/`frame.evaluate`
callback taking more than one parameter. Run against the pre-fix helpers it flags exactly the three real
crashes (L-3 and both halves of L-5); on current code it scans 46 calls and passes.
`tests/aiEngineProcessResults.test.js` runs the real `processResults` on synthetic model output (13
assertions), where the earlier corpus only checked what the prompt says.

**Still not exercised live:**

- The AI verdict itself. Without a Gemini key every run returns the mock before the prompt is built,
  so prompt wording and `processResults` are covered only by the offline suites.
- The vertical-scroll `geometricWarnings` crash fix. The demo showed no Read More, so that branch never
  ran. Vertical scroll also tracked **0 columns**: its selectors do not reach the shadow root, so its
  movement verification is inert (pre-existing, not fixed here).
- The carousel sentinel now runs, but it queries `document`, which does not pierce the widget's shadow
  root, and pushes to `interactionContext.geometricWarnings`, which is undefined. It is safe but inert
  (pre-existing, not fixed here).
- Floating Badge and Review Badge have no interaction helper, so their popover-only features report
  `NOT_APPLICABLE`.

### Production-path verification (11-09-2026)

Every run above went through `runners/runValidation.js`, the local runner, which production never
calls. The daily workflow runs `runners/runApiValidation.js` and is currently `disabled_manually` (last
run 30-03-2026). The only live path is `runners/runApiValidation.ondemand.js`, dispatched by the
backend's `WidgetEmbedTestService` when a widget is first embedded on a site.

That dispatch sends `data.url`, `data.type` and `data.configurations`, where `type` is the lowercased
`Widget::TYPE` constant name (`avatar_blocks`, `review_badge`), and it sends **no widget ID**. The
daily API sends the same names. Every earlier run passed a numeric `--type` and a demo UUID, so
neither production path had been exercised the way production calls it. Both runners were then run
with the Gemini and Basecamp variables explicitly unset, so nothing could post.

| Entry point | Input | Result |
| --- | --- | --- |
| Daily runner | 2 records from the live `/v3/embed-widget-urls` (strip slider on two customer sites) | Clean; `testData/processed_urls.json` restored afterwards |
| On-demand | `avatar_carousel_slider` (16) | Resolved to `Unknown`, and so would be skipped, until G-1. Now validated: type confirmed by network intercept, 296 items |
| On-demand | `avatar_blocks` (19) | Same as 16 until G-1. Now validated: 873 items |
| On-demand | `floating_badge` (22) | Clean; the bar is captured |
| On-demand | `review_badge` (23) | Declared an empty state when the widget API timed out, until G-2. Now the DOM counts its 2 source cards without the API |
| On-demand | `review_and_ratings` (24) | Clean |

| ID | Defect found on the production path | Origin | Resolution |
| --- | --- | --- | --- |
| G-1 | The backend names types 16 and 19 `avatar_carousel_slider` and `avatar_blocks`. The detector knew only `avatarcarousel` and `avatarblock`, so both resolved to `Unknown` and the coverage-gap guard (R-2) would have skipped every such widget in production. The coverage test checked numeric IDs only, which is not what the runners receive | Pre-existing alias gap, made fatal by R-2 | Both names added to `WidgetAliases`. `tests/widgetCoverage.test.js` now also resolves every backend `Widget::TYPE` name, from a pinned table or the live model via `BACKEND_WIDGET_MODEL_PATH`. It failed on exactly these two names before the fix and passes 89/89 after |
| G-2 | The DOM item count had no selector for the Review Badge, whose Award layout has no logo or avatar, so it counted 0 and the badge survived only through the API bypass. When `/v3/embed/<id>` missed its 5 s timeout, the badge was declared an empty state | Pre-existing, masked by the L-2 bypass | `.feedspace-review-badge-card` added to the item selectors: one per source card, in both the Card and Award layouts |
| G-3 | Both API runners' dedup calls `.toLowerCase()` on the raw `widget_type` or `type`, which throws on a number and aborts the whole run | Pre-existing | **Not fixed**: unreachable today, because both producers send strings. Worth a `String(...)` guard if a producer ever sends IDs |

Production traffic, read from the last 12 on-demand runs on GitHub: types arrive as names (`masonry`,
`avatar_group`, `carousel_slider`, `marquee_stripe`, `review_and_ratings`); the Gemini key works in CI
(real verdicts, five PASS, none mocked); no cards were filed; and the remaining runs ended in
prevalidation (site unreachable, a `wp-admin` URL blocked, or no Feedspace script on the page). A
`review_and_ratings` dispatch arrived on 06-09-2026, so the new widget types already reach this
pipeline, and on the current `main` that name resolves to `Unknown`.

### Product follow-up (not this repo)

| ID | Item | Owner |
| --- | --- | --- |
| P-1 | Decide whether a minimum margin is guaranteed below the avatar-group popover | Embed team |
| P-2 | Investigate why `/v3/embed-widget-urls` reported FLOATING_TOAST for a single-slider page | Backend |

---

## 4. Why this matters

Each false positive costs a human triage cycle and a Basecamp card, and the failure mode is
self-reinforcing: QA-4 guarantees that any bad measurement becomes a CRITICAL card, and QA-5
guarantees that any mention of a defect word becomes one too. Both bypass the model's own judgement,
which is the one part of the pipeline that was actually looking at the screenshot.

The through-line across all eight framework defects is the same: **the framework asserts more
certainty than its inputs support.** The fixes above are mostly about restoring the model's ability to
overrule a measurement, and about teaching the framework what each widget is actually supposed to
render.
