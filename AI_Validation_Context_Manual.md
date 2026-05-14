# AI Validation Context Manual: Truth vs. Pixels

This document defines the hierarchy of "Truth" used by the AI Visual Validation Orchestrator. It explains how the automation script synthesizes backend data, DOM facts, and visual evidence into a single prompt for the Gemini AI.

## 1. The Hierarchy of Truth

When the AI encounters a discrepancy between data and visual evidence, it follows this strict precedence:

| Priority | Source | Description | AI Rule |
| :--- | :--- | :--- | :--- |
| **1 (Highest)** | **Section -1: DOM Overrides** | Hard technical facts from the DOM (e.g., "Empty State", "Modal Open"). | **MANDATORY**: AI must prioritize these over visual analysis. |
| **2** | **Section 0: Ground Truth** | Backend review data (ID, Name, Text, Rating, Platform Slug). | **VALIDATION**: AI uses this to match specific cards to IDs. |
| **3** | **Config Status** | Configuration settings (Visible vs. Absent). | **AUTHORITY**: Config is the ONLY permission to render a feature. |
| **4 (Lowest)** | **Visual Pixels** | The raw screenshot images. | **SUPREME AUTHORITY**: If it's not in the pixels, it's "Absent" in the UI. |

---

## 2. Special Contextual Exceptions

### A. Manual Review Exception (RULE 26)
*   **Indicator**: Section 0 data shows `slug: "manual"` or `platform: "Unknown"`.
*   **Logic**: Manual reviews are added directly by users and do **NOT** have social platform icons (Google, Facebook, etc.).
*   **Verdict**: If a review is identified as `manual`, the AI must mark "Show Social Platform Icon" as **PASS**, even if the icon is physically missing.

### B. Config Dominance (RULE 27)
*   **Logic**: If the Config says a feature should be `Absent`, and the AI sees it is `Absent` in the UI, the result is a **PASS**.
*   **Anti-Hallucination**: The AI is forbidden from reporting a FAIL for a correctly-hidden feature, regardless of what the backend data (Section 0) contains.

### C. The "Literal Eye" Policy (RULE 21)
*   **Logic**: Even if Config says "Visible", if the AI cannot see the element with 100% pixel clarity, it MUST report UI Status: **Absent**.
*   **Result**: This triggers a **FAIL** (Configuration mismatch), ensuring we detect rendering bugs where the backend thinks something is on-screen but it's actually missing or broken.

---

## 3. Automation Script Context Flow

1.  **Orchestrator (`runValidation.js`)**: Loads the target URL and Config.
2.  **Playwright Helper**: Navigates to the site and captures the **DOM Truth** (Geometric Warnings).
3.  **Widget Helper**: Interacts with the slider/marquee and captures **High-Res Snapshots**.
4.  **Prompt Builder**: Merges the **DOM Truth (Section -1)**, **Backend Data (Section 0)**, and **Config Status** into the AI instruction set.
5.  **AI Engine**: Sends the prompt and snapshots to Gemini, which applies the **Forensic Rules** (21, 26, 27) to provide the final verdict.
