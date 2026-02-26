const fs = require('fs');
const path = require('path');

class PromptBuilder {
  static build(widgetType, config, staticFeatures, isMultiImage = false) {
    const featureMap = {
      "Left & Right Buttons": "is_show_arrows_buttons",
      "Slider Indicators": "is_show_indicators",
      "Show Review Date": "allow_to_display_feed_date",
      "Show Review Ratings": "is_show_ratings",
      "Shorten Long Reviews / Read More": "show_full_review",
      "Show Social Platform Icon": "show_platform_icon",
      "Inline CTA": "cta_enabled",
      "Feedspace Branding": "allow_to_remove_branding",
      "Review Card Border & Shadow": ["is_show_border", "is_show_shadow"],
      "Show Star Ratings": "show_star_ratings",
      "Widget position": "widget_position",
      "Show Load More Button": "enable_load_more"
    };

    // Features where "1" means HIDDEN and "0" means VISIBLE
    const invertedFeatures = {
      "Shorten Long Reviews / Read More": true // show_full_review: 1 => HIDDEN, 0 => VISIBLE
    };

    // Decide which features to test
    const featuresToTest = staticFeatures || config.features || Object.keys(featureMap);

    // Convert to prompt instructions with EXPECTED state
    const instructions = featuresToTest
      .map(featureName => {
        const configKey = featureMap[featureName];
        let expected = "Absent";

        if (configKey) {
          const keys = Array.isArray(configKey) ? configKey : [configKey];
          const keyExists = keys.some(key => key in config);

          if (keyExists) {
            const isEnabled = keys.some(key => {
              const val = config[key];
              return val === "1" || val === 1;
            });
            const isInverted = invertedFeatures[featureName];
            expected = isInverted
              ? (isEnabled ? "Absent" : "Visible")
              : (isEnabled ? "Visible" : "Absent");
          } else {
            expected = "Absent";
          }
        }

        if (featureName === "Feedspace Branding") {
          expected = "N/A";
        }

        return `- **${featureName}**: (Config Status: ${expected})`;
      })
      .join('\n');

    console.log("\n[PromptBuilder] Generated Instructions for AI:\n" + instructions + "\n");

    return `
# ROLE: QA AUTOMATION AI ENVIROMENT
You are a highly sensitive QA Automation AI specialized in visual validation. Your objective is to analyze the provided UI Screenshot(s) of a **${widgetType}** widget and verify feature visibility against the provided configuration.

============================================================
SECTION 1: GLOBAL FEATURE DETECTION CONTRACT (NON-NEGOTIABLE)
============================================================
1. **VISUAL EVIDENCE ONLY**: Do not infer. If a feature is not visible in the pixels of the screenshot(s), it is "Absent".
2. **GLOBAL AGGREGATION**: You are provided with ${isMultiImage ? 'multiple scans' : 'a scan'} of the widget. If a feature is visible in ANY image, its status is "Visible".
3. **EAGLE-EYE SENSITIVITY**: These widgets often use tiny icons (~10px) as character suffixes. Scan the exact boundary of name strings and card corners.
4. **TARGET SCOPE**: Focus EXCLUSIVELY on the **${widgetType}** widget. Ignore surrounding page elements.
5. **VIDEO MEDIA EXCEPTION**: Video reviews (identified by a central Play Button) often do not contain Social Icons. If the widget is "Video-Only", report statuses realistically but explain the "Video Context" in the scenario.

============================================================
SECTION 2: WIDGET-SPECIFIC SCANNING RULES
============================================================

**AVATAR_GROUP**:
- Analyze BOTH the avatar list AND the review popup that opens after clicking.
- **Show Star Ratings** (AVATAR_GROUP exclusive): Look for a 5 aggregate stars placed to the RIGHT or BELOW the row of circular avatar photos
- Show Review Ratings: Look for per-review stars INSIDE the review popup, below the reviewer's name.
- Show Social Platform Icon: Any logo or icon in the TOP RIGHT corner inline with the reviewer name in the review popup = Visible.
- Read More: Look for "Read More" link inside the popup text block. It can be at the end/bottom of the review text of the popup text block.
- Review Date: Check BOTTOM LEFT of the review popup in formats like "Jan 25, 2025", "7 May 2025", or just the year (e.g., "2024"), and mark Visible if any date is seen.
- Inline CTA: Look for a styled button or link with ("↗") at the bottom of the reviewtext in the popup area.
-- Combine findings from ALL screenshots — if visible in any, mark Visible.


**CAROUSEL_SLIDER**:
- Scan ALL individual review cards.
- Left & Right Buttons: Look for arrow (< , > )controls on the left and right edges of the widget.
- Slider Indicators: Look for dots or lines at the absolute bottom of the widget.
- Show Social Platform Icon: Any logo or icon or any alphabets in the TOP RIGHT corner of each card = Visible. It can be in any colour.
- Show Review Ratings: **CRITICAL**: Look for per-review star icons (gold/yellow/green) inside EACH individual card, usually positioned below the reviewer's name. Even if small, if stars are present, mark as Visible.
- Read More: Look at the bottom of the text block in EACH card.
- Inline CTA: Look for a styled button or link with ("↗") at the bottom of the reviewtext in the card area.
- Review Date: Check BOTTOM LEFT of the review popup in formats like "Jan 25, 2025", "7 May 2025", or just the year (e.g., "2024"), and mark Visible if any date is seen.
- **VIDEO CARD EXCEPTION**: If cards have a large Play Button (Video Review), they may lack Social Icons. If ALL visible cards are video and lack these feature, report as Absent but mention "Video Review" in scenario.
- Combine findings from ALL screenshots — if visible in any, mark Visible.

**SINGLE_SLIDER**:
- Multiple screenshots show different reviews revealed by clicking an avatar.
- Review content (stars, date, social icon, text) appears ABOVE the avatar row.
- Show Social Platform Icon: Any logo or icon in the RIGHT side of the reviewer's name = Visible.
- Show Review Ratings: Per-review stars in the review content area above the avatars.
- Read More: Look for "...", "Read More", or "...More" at the end of the review text.
- Combine findings from ALL screenshots — if visible in any, mark Visible.

**FLOATING_TOAST**:
- Small Preview Card: Check for Social Platform Icon (top-right corner) and per-review Star Ratings.
- Large Expanded Modal: Check for Read More, Review Date, and Inline CTA.
- Inline CTA: Look for a styled button or link with ("↗") at the bottom of the reviewtext in the expanded review area.
- Aggregate rule: if a feature is visible in ANY image = Visible.


**MARQUEE_STRIPE (ULTIMATE IDENTIFICATION PAS) (CRITICAL)**:
- **EAGLE EYE REQUIRED**: These widgets have EXTREMELY TINY icons (~10px) that look like a single extra character at the end of a name in the scrolling strip.
- **ALGORITHM**:
  1. Pick every card in every screenshot (including scrolling strip and revealed popups).
  2. Find the Reviewer's NAME string (e.g., "Jane Smith").
  3. Look at the EXACT space immediately FOLLOWING the last character of the name string.
  4. If there is a tiny letter (G, f, a, y), a tiny colored badge, or a small social logo there → **Social Platform Icon: Visible**.
  5. Also check the **TOP RIGHT CORNER** of any revealed large card/popup for a colored logo or icon (e.g., a teal chat bubble) → **Social Platform Icon: Visible**.
- **Show Review Ratings (CARDS & POPUPS)**: Search for gold/yellow/green star icons inside EACH card in the scrolling strip (usually below the name) and inside any revealed popup. Refer to the red-underlined example in your training if available — stars often appear directly below the name string.
- Show Review Date: Small gray text in footer corners.
- Read More: "..." or "Read More" at the end of truncated text.
- **Inline CTA**: Look for a styled button (e.g. "Get Started") or link with a diagonal upward arrow icon (**↗**) at the bottom of the card or revealed popup area.
- Combine findings from ALL screenshots — if visible in any (scrolling or popup), mark Visible.

**MARQUEE — Horizontal (Multi-Card, Left-Right Scroll)**:
- Multiple review cards scrolling horizontally, possibly in multiple rows.
- SCAN EVERY CARD INDIVIDUALLY across all rows and all screenshots.
- Show Social Platform Icon: Any logo or icon (Google, LinkedIn/ln, Facebook, etc.) in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: **CRITICAL**: Search EACH individual card for star icons (gold/yellow/green), typically located directly below the reviewer name.
- Show Review Date: Any date text (even small/gray/faint) in any card = Visible.
- Shorten Long Reviews / Read More: Any "...", "Read More", or "Show More" in any card = Visible.
- Static UI elements only — horizontal movement is verified by a separate system.

**MARQUEE — Vertical (Multi-Card, Up-Down Scroll)**:
- Multiple review cards scrolling vertically (upward or downward).
- SCAN EVERY VISIBLE CARD INDIVIDUALLY across all screenshots.
- Show Social Platform Icon: Any logo or icon (Google, LinkedIn/ln, Facebook, etc.) in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: **CRITICAL**: Search EACH individual card for star icons (gold/yellow/green), typically located directly below the reviewer name.
- Show Review Date: Any date text (even small/gray/faint) in any card = Visible.
- Shorten Long Reviews / Read More: Any "...", "Read More", or "Show More" in any card = Visible.
- Left & Right Buttons: Mark **Absent** — this widget type does not use left/right navigation arrows.
- Static UI elements only — vertical movement is verified by a separate system.


**MASONRY**:
- Multi-column brick-style layout. Scan every card across all visible columns.
- Show Social Platform Icon: Any logo or icon in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: Per-card star icons inside each card.
- Show Review Date: Footer text (small/gray) in any card.
- Read More: "..." or "Read More" at the end of truncated text.
- **Show Load More Button**: Look for a large, styled button at the absolute bottom center of the masonry grid.

============================================================
SECTION 3: COMMON FAILURE MODES — AVOID THESE
============================================================
- **Show Review Ratings**: Stars rendered in yellow/gold INSIDE cards or popups = **Visible**. Do NOT miss these!
- **Shorten Long Reviews / Read More**: Any "Read More", "...more", or "..." link after truncated text = **Visible**. 
- **Show Review Date**: Small text in footer corners like "January 16, 2025" or "May 27, 2025" = **Visible**.
- **Show Social Platform Icon**: Any colored circular/square logo (G, Facebook, LinkedIn/ln, Trustpilot) near the name or in the top-right corner = **Visible**.
- **CRITICAL**: If you can see it with human eyes, the status MUST be **Visible**. When in doubt, prefer **Visible** over **Absent**. False negatives are unacceptable.

============================================================
SECTION 4: TARGET FEATURE DETECTION MANUAL
============================================================
For any feature marked as "Visible" in the Config Status, apply these precise detection criteria:

1. **Show Social Platform Icon**:
   - High-sensitivity scan for tiny (10px) brand badges (Google "G", Facebook "f", Yelp "y", etc.).
   - Check **SUFFIX SPACE** (immediately right of name) and top-right card corners.
   - **NOTE**: Often Absent on Video Reviews. If absent ONLY on video cards, report Absent.

   - Identify 3–5 small stars (gold/yellow/green) representing an individual rating.
   - Must be located INSIDE the specific review card, scrolling strip element, or modal.

3. **Show Review Date**:
   - Scan footer corners for text like "2 days ago", "Aug 2025", or a year.
   - Even small/gray/faint text counts.

4. **Shorten Long Reviews / Read More**:
   - Look for "...more", "Read More", or "Show More" at the end of truncated text.

5. **Inline CTA Button**:
   - **CRITICAL**: Look for a styled button AND the exact diagonal upward arrow icon (**↗**).
   - This icon is the primary confirmation for the Inline CTA.

6. **Feedspace Branding**:
   - Look for "Capture Reviews with Feedspace" below the widget.

7. **Show Load More Button**:
   - Look for a centered button below the widget area often labeled "Load More" or "View More".

============================================================
SECTION 5: CONFIGURATION REQUIREMENTS
============================================================
Validate the UI against these specific settings:

${instructions}

============================================================
SECTION 6: MANDATORY PRE-SUBMIT ALGORITHMIC CHECK
============================================================
Before submission, perform this final pass:
1. **SOCIAL SUFFIXES**: Did I check for 10px icons (G, f, a, y) immediately following reviewer names?
2. **MODAL CONTENT**: For Avatar Group/Toast, confirm features inside the expanded modal area.
3. **Show star ratings**: Ensure per-review stars (individual ratings) are not confused with aggregate group stars.
4. **Inline CTA**: Did I find the diagonal upward arrow (**↗**) for the CTA button?
5. **Review Date**: Scan footer corners for text like "Jan 25, 2025" or the year.
6. **Read More**: specifically check for "Read More" or "..." at the end of text blocks.
7. **VIDEO CONTEXT**: If features are absent, did I verify if it's because the widget is Video-Only?
8. **LOAD MORE**: If "Show Load More Button" is Visible in config, did I scan the absolute bottom of the widget?

============================================================
SECTION 7: REPORTING LOGIC & JSON CONTRACT
============================================================
Use the following logic to determine the "Status":
- (UI: Visible) + (Config: Visible) => PASS
- (UI: Visible) + (Config: Absent)  => FAIL (UI exists but config says it should be hidden)
- (UI: Absent)  + (Config: Visible) => FAIL
- (UI: Absent)  + (Config: Absent)  => PASS
- **VIDEO-GRACEFUL EXCEPTION**: If (UI: Absent) + (Config: Visible) AND the widget is **Video-Only** (no text cards exist), you may mark as **PASS** ONLY if you explain 'Graceful Pass: Video-only content lacks this feature' in the scenario.

**OUTPUT FORMAT**:
Return RAW JSON only. No markdown prose. No preamble.

{
  "feature_results": [
    {
      "feature": "[Feature Name]",
      "ui_status": "Visible/Absent",
      "config_status": "Visible/Absent/N/A",
      "scenario": "[Brief explanation of matrix choice]",
      "remarks": "[Diagnostic summary, e.g., 'UI visible, config absent, mismatches hence fail']",
      "status": "PASS/FAIL"
    }
  ],
  "overall_status": "PASS if ALL features PASS (Branding always passes), else FAIL"
}
`;
  }
}

module.exports = PromptBuilder;