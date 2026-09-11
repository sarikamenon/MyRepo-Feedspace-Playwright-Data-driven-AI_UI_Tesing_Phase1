# AI Validation Context Manual: Truth vs. Pixels

This document defines the hierarchy of "Truth" used by the AI Visual Validation Orchestrator. It explains how the automation script synthesizes backend data, DOM facts, and visual evidence into a single prompt for the Gemini AI.

## 1. The Hierarchy of Truth

When the AI encounters a discrepancy between data and visual evidence, it follows this strict precedence:

| Priority | Source | Description | AI Rule |
| :--- | :--- | :--- | :--- |
| **1 (Highest)** | **Widget Capability** | What this widget type is physically built to render (`Configs/*.json`). | **GATE**: A feature the widget cannot render is never audited. A feature it renders only in a popover is judged only in popover screenshots. |
| **2** | **Section -1: DOM Facts** | Hard technical facts from the DOM (e.g. "Empty State", "Modal Open"). | **MANDATORY**: AI must prioritize these over visual analysis. |
| **2b** | **Section -1: ADVISORY measurements** | Geometric measurements that are frequently wrong about viewport-anchored surfaces. | **EVIDENCE, NOT VERDICT**: AI must corroborate against a screenshot and may overrule with a stated reason. |
| **3** | **Section 0: Ground Truth** | Backend review data (ID, Name, Text, Rating, Platform Slug). | **VALIDATION**: AI uses this to match specific cards to IDs. Bind by `tracking_id`, never by name. |
| **4** | **Config Status** | Configuration settings, already resolved against product defaults. | **AUTHORITY**: Config is the permission to render a feature. |
| **5 (Lowest)** | **Visual Pixels** | The raw screenshot images. | **SUPREME AUTHORITY within scope**: if it is not in the pixels it is "Absent" in the UI, provided the widget renders it on the surface that was captured. |

⚠️ **Priority 1 was added after a review of ten `[Widget FAIL]` cards**, eight of which were the checker
asserting a widget should render something it was never designed to render. Capability now gates
everything below it. See `qa-automation-improvement-10-09-2026.md`.

---

## 2. Special Contextual Exceptions

### A. Manual Review Exception (RULE 26)

- **Indicator**: Section 0 data shows `slug: "manual"` or `platform: "Unknown"`.
- **Logic**: Manual reviews are added directly by users and do **NOT** have social platform icons (Google, Facebook, etc.).
- **Verdict**: If a review is identified as `manual`, the AI must mark "Show Social Platform Icon" as **PASS**, even if the icon is physically missing.

### B. Config Dominance (RULE 27)

- **Logic**: If the Config says a feature should be `Absent`, and the AI sees it is `Absent` in the UI, the result is a **PASS**.
- **Anti-Hallucination**: The AI is forbidden from reporting a FAIL for a correctly-hidden feature, regardless of what the backend data (Section 0) contains.

### C. The "Literal Eye" Policy (RULE 21)

- **Logic**: Even if Config says "Visible", if the AI cannot see the element with 100% pixel clarity, it MUST report UI Status: **Absent**.
- **Result**: This triggers a **FAIL** (Configuration mismatch), ensuring we detect rendering bugs where the backend thinks something is on-screen but it is actually missing or broken.
- ⚠️ **Scope limit**: this applies only to features the widget renders on the captured surface. A
  popover-only feature with no popover screenshot is **NOT_APPLICABLE**, never a FAIL, and a per-review
  feature on an `aggregate_surface` widget is not looked for on the resting state at all.

### D. Resolved Config Defaults

- **Logic**: A key missing from the payload does **not** mean the feature is off. The embed applies
  product defaults, and most of the review-card flags default **on** (`show_platform_icon`,
  `is_show_ratings`, `allow_to_display_feed_date`, `show_profile_picture`, `is_show_border`).
- **Result**: `promptBuilder.js` resolves the Config Status against those defaults before the prompt is
  built, so the AI is told the real expected state and must trust it rather than re-deriving it.

### E. Motion and Capture Artifacts

- **Logic**: A widget photographed mid-animation, or a viewport-anchored popover resting against the
  capture boundary, is a property of the **capture**, not a defect in the widget.
- **Result**: animated widgets are frozen (document and shadow root) before capture, and boundary
  measurements are emitted as `ADVISORY:` evidence rather than as forced failures.

### F. Reasoning Overrides

- **Logic**: The engine scans the model's own reasoning for admissions of defects it did not put in the
  JSON. Two guards keep that from inverting the model's verdict:
  - a line that carries an explicit clearing verdict ("this is a PASS", "by design") is not an admission,
    unless it also carries a hard `FAIL_*` token;
  - an override may only flip a PASS when the reasoning **cites** something locatable: a named
    screenshot, card, element or position.
- **Source of truth**: `helpers/reasoningVerdict.js`, imported by both the engine and the regression suite.

---

## 3. Automation Script Context Flow

1. **Orchestrator (`runners/runValidation.js`)**: Loads the target URL and Config. An unrecognised widget
   type is **skipped** as a coverage gap rather than validated.
2. **Widget Detector**: Resolves the numeric type ID, alias or CSS signature to a known widget type.
   The runners receive the backend's lowercased `Widget::TYPE` name (for example `avatar_blocks`),
   never the ID, so every such name needs an alias.
3. **Capability Loader (`widgetConfigLoader.js`)**: Loads that widget's `Configs/*.json`, which declares
   what it renders, what is popover-only, and what it cannot do at all.
4. **Playwright Helper**: Navigates to the site and captures the **DOM Truth** (Geometric Warnings),
   splitting them into authoritative facts and `ADVISORY:` measurements.
5. **Widget Helper**: Interacts with the slider/marquee and captures **High-Res Snapshots**, freezing
   motion first where the widget animates.
6. **Prompt Builder**: Merges **Capability**, **DOM Truth (Section -1)**, **Backend Data (Section 0)** and
   the resolved **Config Status** into the AI instruction set.
7. **AI Engine**: Sends the prompt and snapshots to Gemini, applies the **Forensic Rules** (21, 26, 27) and
   the reasoning guards, then returns the final verdict.
8. **Report and Card Helpers**: Write the dashboard and file a Basecamp card for genuine failures.
   `SKIPPED` runs never produce a card.
