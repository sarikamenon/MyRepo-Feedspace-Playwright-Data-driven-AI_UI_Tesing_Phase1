# Project Architecture and AI Visual Validation Guide

This document provides a comprehensive overview of the AI-driven UI testing and audit system developed for Feedspace widgets.

## Project Overview

The core objective of this project is to automate the visual verification of various Feedspace widgets (Carousel, Avatar Group, Vertical Scroll, etc.) using a combination of **Playwright** for browser automation and **Gemini AI** for high-level visual analysis.

---

## 🏗️ System Architecture

The project follows a modular architecture designed for scalability and robust interaction with complex widgets:

### 1. Orchestration Layer (`runValidation.js` / Step Definitions)
- Loads test configurations and URLs from `testUrls.json`.
- Initializes the environment and triggers the validation process for each widget identified.

### 2. c

### 3. Interaction Specialized Helpers (`helpers/interactiveWidgets/`)
Each complex widget has a dedicated helper to manage its unique lifecycle:
- **`AvatarGroupHelper.js`**:
    - Deduplicates avatars using `data-feed-id`.
    - Filters for visible elements to avoid "clicking hidden" errors.
    - Implements the **Click -> Capture -> Click Outside -> Wait** sequence.
- **`HorizontalScrollHelper.js` / `VerticalScrollHelper.js`**:
    - Verifies programmatic movement and captures state changes.
- **`AvatarSliderHelper.js`**:
    - Manages click-based slider navigation.

### 4. AI Engine (`aiEngine.js` & `promptBuilder.js`)
- **Prompts**: Dynamically builds multi-layered instructions for Gemini based on the widget type and the specific JSON configuration (e.g., `avatarGroupFeature.json`).
- **Feature Matrix**: Maps visual evidence (Stars, Dates, Social Icons, Read More) against expected configuration states to generate PASS/FAIL results.

---

## 🧠 AI Analysis Logic

The AI analyzes provided screenshots based on strictly defined visual rules:

- **Global vs. Local Ratings**: Distinguishes between a widget's overall rating (e.g., "5.0") and individual user ratings inside popups.
- **Platform Icon Detection**: Specifically trained to recognize logos (Google, Twitter/X, Trustpilot) near the reviewer names.
- **Read More Triggers**: Looks for text truncation markers (`...`) or explicit links that expand content.
- **Date Consistency**: Scans the bottom/top corners for various date formats (relative and absolute).

---

## 📊 Areas Covered

| Widget Type | Interaction Level | Specialized Verification |
| :--- | :--- | :--- |
| **Carousel / Slider** | Navigation | Arrow clicks, indicator dots, card counts. |
| **Avatar Group** | High | Focused avatar shots, popup reveal, click-outside logic. |
| **Marquee (H/V)** | State | Programmatic movement verification via timed captures. |
| **Floating Cards** | Medium | Expansion modals and hover states. |
| **Wall of Love** | Medium | Grid alignment and text readability. |

---

## ⚠️ Limitations and Constraints

1. **Rate Limits**: The AI Engine implements a retry-with-exponential-backoff strategy to handle Gemini 429 errors.
2. **Dynamic Content**: Widgets with ultra-fast animations or randomized positions can sometimes result in capture misalignment.
3. **Multi-Widget Interference**: Pages with multiple overlapping widgets of the same type require precise selector targeting.
4. **Resolution**: Extremely high-res screenshots are needed for small markers like social icons, leading to larger buffers.

---

## 📈 Evolution and Roadmap

The project started as a basic screenshot tool and has evolved into an **Interactive Audit System**. 

- **Phase 1**: Static captures and basic detection.
- **Phase 2**: Specialized interaction (helpers) and deduplication.
- **Phase 3 (Current)**: Multi-screenshot AI validation with state cleanup (closing popups).
- **Future**: Automated bug reporting directly to issue trackers and real-time dashboarding of validation results.
