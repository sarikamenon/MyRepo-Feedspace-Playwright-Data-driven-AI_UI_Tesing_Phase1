const fs = require('fs');
const path = require('path');

class PromptBuilder {
  static build(widgetType, config, staticFeatures, isMultiImage = false, geometricWarnings = []) {
    const featureMap = {
      "Left & Right Buttons": "is_show_arrows_buttons",
      "Left & Right Shift Buttons": "is_show_arrows_buttons",
      "Show Cross Bar": "show_crossbar",
      "Slider Indicators": "is_show_indicators",
      "Show Review Date": "allow_to_display_feed_date",
      "Show Review Ratings": "is_show_ratings",
      "Read More": "show_full_review",
      "Show Social Platform Icon": "show_platform_icon",
      "Inline CTA": "cta_enabled",
      "Feedspace Branding": "allow_to_remove_branding",
      "Review Card Border & Shadow": ["is_show_border", "is_show_shadow"],
      "Show Star Ratings": "show_star_ratings",
      "Widget position": "widget_position",
      "Show Load More Button": "enable_load_more",
      "Displays Gray mode": "enable_grey_mode"
    };
    // Features where "1" means HIDDEN and "0" means VISIBLE
    const invertedFeatures = {
      "Read More": true // show_full_review: 1 => HIDDEN, 0 => VISIBLE
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

          // NESTED LOOKUP: Features often live inside 'widget_customization' or 'data'
          const lookupContexts = [config, config.widget_customization, config.data].filter(Boolean);

          const keyExists = keys.some(key => lookupContexts.some(ctx => key in ctx));

          if (keyExists) {
            const isEnabled = keys.some(key => {
              return lookupContexts.some(ctx => {
                const val = ctx[key];
                return val === "1" || val === 1 || val === true || val === "true";
              });
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

        let statusSuffix = "";
        if (featureName === "Read More" && expected === "Visible") {
          statusSuffix = " << MANDATORY: IF INVISIBLE OR WHITE-ON-WHITE AFTER '...', MARK ABSENT & FAIL THEME >>";
        }

        return `- **${featureName}**: (Config Status: ${expected})${statusSuffix}`;
      })
      .join('\n');

    const widgetLayoutPreAnalysis = {
      FLOATING_TOAST: `
**FLOATING TOAST — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Is the bottom edge of the floating card touching or hidden behind a footer/black bar? → [YES / NO]
Q2. Is the card positioned so far down the viewport that its lower portion is invisible? → [YES / NO]
Q3. Can you see the full review text, or is it cut off mid-sentence? → [FULL / CUT OFF — quote last visible word]
Q4. Is only a partial sliver of the card visible (e.g., just avatar + stars, no review text)? → [YES / NO]
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
🚨 MANDATORY QA FAIL: If Q1, Q2, or Q4 is YES, or Q5 is "SOME PARTIALLY VISIBLE" → status MUST be "FAIL", severity "CRITICAL".`,

      MASONRY: `
**MASONRY — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
Q6. **INVISIBLE LINK CHECK (VERTICAL ANCHOR)**: Look at the ellipsis "...". Is there a legible "Read More" link next to it or on the LINE BELOW it? → [VISIBLE / INVISIBLE-SPACE]
Q7. **GHOST CARD CHECK**: Does any card look empty or have invisible/white-on-white text where a review body should be? → [YES / NO]
RULE: If Q1 is CLIPPED (and severe), Q2 is CUT OFF, Q3 is YES, Q5 is "SOME PARTIALLY VISIBLE", Q6 is INVISIBLE-SPACE, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      MARQUEE_STRIPE: `
**MARQUEE STRIPE — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
Q6. **INVISIBLE LINK CHECK**: Does any card show an ellipsis "..." but NO legible "Read More" link? → [YES / NO]
Q7. **GHOST CARD CHECK**: Does any card look empty or have invisible/white-on-white text where a review body should be? → [YES / NO]
RULE: If Q1 is SLICED, Q2 is CLIPPED, Q3 is YES, Q4 is YES, Q5 is "SOME PARTIALLY VISIBLE", Q6 is YES, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      AVATAR_GROUP: `
**AVATAR_GROUP — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Is the avatar circles row fully visible? → [FULLY VISIBLE / CHOPPED]
Q2. Does the widget's shadow or border overlap any unrelated page content below it? → [YES / NO]
Q3. CRITICAL: Examine the review popup bottom edge. Can you see a COMPLETE, rounded bottom border with padding below it? Or does the card hit a "flat wall" at the viewport bottom? → [ROUNDED BORDER VISIBLE / FLAT WALL TRUNCATION]
Q4. Is any text or element inside the popup card cut off mid-line or vertically sliced? → [YES / NO]
Q5. Are all elements (avatars, stars, text) fully contained within their respective containers? → [YES / NO]
Q6. **INVISIBLE LINK CHECK (VERTICAL ANCHOR)**: Look at the ellipsis "...". Is there a legible, high-contrast "Read More" link directly next to it or on the LINE BELOW it? (Note: If that space is empty, it's NOT hidden in truncation; it's an invisible rendering failure). → [VISIBLE / INVISIBLE-SPACE]
Q7. **GHOST CARD CHECK**: Does any review popup look empty or have invisible/white-on-white text where a review body should be? → [YES / NO]
🚨 MANDATORY QA FAIL: If Q1 is CHOPPED, Q2 is YES, Q3 is FLAT WALL TRUNCATION, Q4 is YES, Q5 is NO, Q6 is INVISIBLE-SPACE, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      SINGLE_SLIDER: `
**SINGLE SLIDER — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Is the review content area (above the avatar row) fully visible, or sliced at the top by a container boundary? → [FULLY VISIBLE / SLICED]
Q2. Is the avatar row at the bottom fully visible, or are avatars cut off? → [FULLY VISIBLE / CUT OFF]
Q3. Does the widget bleed outside the page viewport on any side? → [YES / NO]
Q4. Is there any element floating outside the main widget boundary? → [YES / NO]
Q5. Are all elements (avatars, stars, text) fully contained within their respective containers? → [YES / NO]
Q6. **INVISIBLE LINK CHECK (VERTICAL ANCHOR)**: Look at the SPACE DIRECTLY BELOW the ellipsis "...". Is it empty/blank though config expects Read More? → [INVISIBLE-SPACE / VISIBLE]
Q7. **GHOST CARD CHECK**: Does the review content look empty or have invisible/white-on-white text where the review body should be? → [YES / NO]
RULE: If Q1 is SLICED, Q2 is CUT OFF, Q3 is YES, Q4 is YES, Q5 is NO, Q6 is INVISIBLE-SPACE, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      MARQUEE_UPDOWN: `
**MARQUEE_UPDOWN — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
Q6. **INVISIBLE LINK CHECK (VERTICAL ANCHOR)**: Look at the SPACE DIRECTLY BELOW the ellipsis "...". Is it empty/blank though config expects Read More? → [INVISIBLE-SPACE / VISIBLE]
Q7. **GHOST CARD CHECK**: Does any card look empty or have invisible/white-on-white text where the review body should be? → [YES / NO]
RULE: If Q1 is CLIPPED, Q2 is YES, Q3 is YES, Q4 is YES, Q5 is "SOME PARTIALLY VISIBLE", Q6 is INVISIBLE-SPACE, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      MARQUEE_LEFTRIGHT: `
**MARQUEE_LEFTRIGHT — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
Q6. **INVISIBLE LINK CHECK (VERTICAL ANCHOR)**: Look at the SPACE DIRECTLY BELOW the ellipsis "...". Is it empty/blank though config expects Read More? → [INVISIBLE-SPACE / VISIBLE]
Q7. **GHOST CARD CHECK**: Does any card look empty or have invisible/white-on-white text where the review body should be? → [YES / NO]
RULE: If Q1 is CLIPPED, Q2 is YES, Q3 is YES, Q4 is YES, Q5 is "SOME PARTIALLY VISIBLE", Q6 is INVISIBLE-SPACE, or Q7 is YES → status MUST be "FAIL", severity "CRITICAL".`,

      AVATAR_CAROUSEL: `
**AVATAR_CAROUSEL — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Look at the RIGHT-MOST avatar/card. Does its right edge have natural rounded corners, or a sharp 90-degree vertical chop? → [ROUNDED / CHOPPED]
**MANDATORY QUADRANT AUDIT (CoT)**: Look exclusively at the top-right and bottom-right corners of the rightmost card. Are they curved gracefully (allowing transparency/background to show behind the curve), or do they form sharp 90-degree right angles creating a perfectly flat vertical line? 
**ZERO-PADDING RULE**: If the right edge of the card touches the pixel-limit of the image without any blue background visible to its right, it is MANDATORY FAIL (Clipped).
Q2. Is any avatar in the row sliced horizontally (top half visible, bottom half cut off)? → [YES / NO]
Q3. If a review popup is open — is it fully visible or truncated with a "Flat Wall" at the bottom? → [FULLY VISIBLE / FLAT-WALL TRUNCATED / NO POPUP]
**FLAT-WALL RULE**: If the bottom edge of a popup forms a perfectly straight horizontal line that touches the image boundary with 0 padding, it is CRITICAL FAIL.
Q4. Are navigation arrows (if expected) fully visible or partially hidden? → [VISIBLE / HIDDEN / ABSENT]
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
RULE: If Q1 is CHOPPED or Q2 is YES or Q3 is FLAT-WALL TRUNCATED or Q4 is HIDDEN or Q5 is "SOME PARTIALLY VISIBLE" → status MUST be "FAIL", severity "CRITICAL".
**REPORTING RULE**: If BOTH the right-edge (Q1) and the popup (Q3) have clipping issues, you MUST combine them in the final JSON "issue" field for A. LAYOUT & SPACING.
`,
      CROSS_SLIDER: `
**CROSS SLIDER — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Are the diagonally scrolling review cards fully visible, or are any clipped at the container edges? → [FULLY VISIBLE / CLIPPED]
Q2. **TWO-BAR INTERSECTION CHECK**: Can you clearly see **TWO distinct diagonal bars** intersecting each other (the black review bar AND the light grey background bar)? → [YES - TWO BARS INTERSECTING / NO - ONLY ONE BAR VISIBLE]
Q3. If a popup is open — is it fully contained within the viewport? → [FULLY VISIBLE / CLIPPED / NO POPUP]
Q4. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
RULE: If Q1 is CLIPPED, Q2 is "ONLY ONE BAR VISIBLE", Q3 is CLIPPED, or Q4 is "SOME PARTIALLY VISIBLE" → status MUST be "FAIL", severity "CRITICAL".`,

      COMPANY_LOGO_SLIDER: `
**LOGO SLIDER — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q2. **BROKEN TOKEN CHECK**: Can you see "(t)(t)(t)" or "(t)" tokens in the logo names or labels? → [YES - BROKEN TOKENS / NO - NORMAL TEXT]
Q3. **COLOR SPECTRUM AUDIT**: Do the logos appear in full color, or are they specifically rendered in "Gray mode" (Grayscale / Black-and-White)? → [FULL COLOR / GRAYSCALE / B&W]
**MANDATORY FAIL RULE**: If Q1 is SLICED, Q2 is YES, or Q3 mismatches 'enable_grey_mode' config → status MUST be "FAIL", severity "CRITICAL".
`,

      CAROUSEL_SLIDER: `
**CAROUSEL SLIDER — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Look at the RIGHT-MOST card. Does its right edge have natural rounded corners, or a sharp 90-degree vertical chop? → [ROUNDED / CHOPPED]
Q2. Is any card sliced horizontally — top half visible, bottom half cut off? → [YES / NO]
Q3. Are left/right arrow buttons fully visible or partially hidden outside the viewport? → [VISIBLE / HIDDEN]
Q4. Are any cards floating detached from the main slider container? → [YES / NO]
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
RULE: If Q1 is CHOPPED, Q2 is YES, Q3 is HIDDEN, Q4 is YES, or Q5 is "SOME PARTIALLY VISIBLE" → status MUST be "FAIL", severity "CRITICAL".`,

      GRID: `
**GRID — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Are all grid cards fully visible, or are any cards in the outer rows/columns clipped? → [FULLY VISIBLE / CLIPPED]
Q2. Is the grid symmetrical, or are there orphaned single cards floating detached from the grid? → [SYMMETRICAL / ORPHANED]
Q3. Does the grid maintain consistent column widths, or are any columns squeezed/stretched? → [CONSISTENT / BROKEN]
Q4. Do any cards overlap each other within the grid? → [YES / NO]
Q5. Are all review cards (square/rectangular boxes) fully visible? → [ALL FULLY VISIBLE / SOME PARTIALLY VISIBLE]
RULE: If Q1 is CLIPPED, Q2 is ORPHANED, Q3 is BROKEN, or Q4 is YES, or Q5 is "SOME PARTIALLY VISIBLE" → status MUST be "FAIL", severity "CRITICAL".`,
      FLOATING_TOAST: `
**FLOATING TOAST — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Initial state: Is the floating badge/toast fully visible in the bottom corner? → [VISIBLE / CLIPPED]
Q2. Expanded state: Is the expanded review card/modal fully visible, or truncated with a "Flat Wall" at the bottom? → [FULLY VISIBLE / FLAT-WALL TRUNCATED]
**ZERO-PADDING RULE**: If the bottom edge of the expanded card touches the image boundary with 0 pixels of padding, it is MANDATORY FAIL (Truncated).
Q3. Does the toast overlap any critical page text? → [YES / NO]
Q4. Are navigation buttons (if any) fully visible? → [VISIBLE / HIDDEN]
RULE: If Q1 is CLIPPED or Q2 is FLAT-WALL TRUNCATED or Q4 is HIDDEN → status MUST be "FAIL", severity "CRITICAL".`,
      MARQUEE_STRIPE: `
**MARQUEE_STRIPE — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Is the scrolling stripe's content fully visible height-wise, or sliced at top/bottom? → [FULLY VISIBLE / SLICED]
Q2. Does the stripe bleed outside the page's left/right boundaries? → [YES / NO]
Q3. Are any individual review snippets overlapping? → [YES / NO]
RULE: If Q1 is SLICED or Q3 is YES → status MUST be "FAIL", severity "CRITICAL".`,
      AVATAR_GROUP: `
**AVATAR GROUP — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. Are any circular avatars in the main group sliced at the edge of the viewport or container? → [ALL CIRCULAR / SOME SLICED]
Q2. Expanded state: Does the expanded review card hit a "Flat Wall" at the bottom or top of the image? → [FULLY VISIBLE / FLAT-WALL TRUNCATED]
**ZERO-PADDING RULE**: If the bottom edge of the expanded card touches the image boundary with 0 pixels of padding, it is MANDATORY FAIL (Truncated).
Q3. Is the expanded card content fully legible or is it cut off mid-paragraph at the edge? → [FULLY LEGIBLE / CUT-OFF]
RULE: If Q1 is "SOME SLICED", Q2 is "FLAT-WALL TRUNCATED", or Q3 is "CUT-OFF" → status MUST be "FAIL", severity "CRITICAL".`,
    };

    const layoutPreAnalysis = widgetLayoutPreAnalysis[widgetType];

    if (!layoutPreAnalysis) {
      throw new Error(
        `[PromptBuilder] No layout pre-analysis defined for widget type: "${widgetType}". ` +
        `Add it to widgetLayoutPreAnalysis before proceeding.`
      );
    }

    // ─────────────────────────────────────────────────────────────
    // SECTION 6.6 — AESTHETIC PRE-ANALYSIS (B through G)
    // General Q&A for all widget types. AI must answer before
    // writing any JSON. Answers must NOT be copied into JSON —
    // only the conclusion goes into each category's "issue" field.
    // ─────────────────────────────────────────────────────────────
    const aestheticPreAnalysis = `
**B. ELEMENT CONTAINMENT:**
Q0. **SECTION 0 CHECK**: Does Section 0 mention "OVERBLEED", "CLIPPED", or "LAYOUT OVERLAP"? → [YES / NO]
Q1. Pick any card — does its text block touch or overflow the card border? → [YES / NO]
Q2. Is any avatar overflowing its circular boundary? → [YES / NO]
Q3. Is any image/media element bleeding outside its container? → [YES / NO]
Q4. Are there any very long unbroken words stretching a card wider than others? → [YES / NO]
RULE: If Q0 is YES, or any other answer is YES → FAIL, severity HIGH.

**C. CONTENT & TEXT RENDERING:**
Q0. **SECTION 0 CHECK**: Does Section 0 mention "TEXT TRUNCATION"? → [YES / NO]
Q1. Do you see any raw placeholder tokens, unrendered code, or repeating structural garbage like "(t)(t)(t)"? → [YES / NO]
Q2. Is any review text cut off abruptly mid-sentence at the bottom of a card WITHOUT an ellipsis or "Read More"? → [YES / NO — quote the cut word if YES]
Q3. Are any emojis or special characters overflowing outside their text line? → [YES / NO]
Q4. Does the text truncation end cleanly with "..." where expected? → [YES / NO]
RULE: If Q0 is YES, Q1 is YES, or Q2 is YES → FAIL, severity CRITICAL. If Q3 is YES or Q4 is NO → FAIL, severity MEDIUM.

**D. AVATAR RENDERING:**
Q1. Are all avatars perfectly circular? Or do any appear oval, square, or have clipped corners? → [CIRCULAR / DISTORTED — describe which card]
Q2. Do any avatar photos look unnaturally stretched vertically or squished horizontally? → [YES / NO]
Q3. Are any avatars noticeably blurry, pixelated, or low-resolution compared to the surrounding text sharpness? → [YES / NO — name which card]
Q4. Are avatar sizes consistent across all cards, or does one appear significantly larger/smaller? → [CONSISTENT / INCONSISTENT]
Q5. For missing avatars — do they show a clean initial/placeholder, or a broken image icon? → [CLEAN / BROKEN / NO MISSING AVATARS]
RULE: If Q1 is DISTORTED, Q2 is YES, Q3 is YES, Q4 is INCONSISTENT, or Q5 is BROKEN → FAIL. Q2/Q3 = CRITICAL, others = HIGH.

**E. MEDIA & IMAGES:**
Q1. Are there any broken image icons, gray placeholder boxes, or raw URLs visible instead of actual photos/logos? → [YES / NO]
Q2. Do any photos or logos look unnaturally stretched, squished, or elongated (funhouse mirror effect)? → [YES / NO — describe if YES]
Q3. Are any images, thumbnails, or photos noticeably pixelated or blurry compared to the surrounding text sharpness? → [YES / NO — name which element]
Q4. Is all media fully visible within its container, or is any partially hidden? → [FULLY VISIBLE / PARTIALLY HIDDEN]
RULE: If Q1 is YES → FAIL, severity CRITICAL. If Q2 or Q3 is YES → FAIL, severity CRITICAL. If Q4 is PARTIALLY HIDDEN → FAIL, severity HIGH.

**F. THEME & COLOR VISIBILITY:**
Q1. Is there any text that is difficult to read due to low contrast (e.g., dark text on dark background, light text on light background)? → [YES / NO — describe if YES]
Q2. If there is both a preview card and an expanded popup — are they the same theme (both dark or both light)? → [SAME THEME / MISMATCHED / NO POPUP]
Q3. Are all interactive elements (buttons, links, arrows) clearly visible against their background? → [YES / NO]
RULE: If Q1 is YES → FAIL, severity CRITICAL. If Q2 is MISMATCHED → FAIL, severity HIGH. If Q3 is NO → FAIL, severity MEDIUM.

**G. POPUPS & MODALS:**

🚨 **CRITICAL PRE-CHECK (ANSWER FIRST, BEFORE ANALYZING OTHER CATEGORIES):**

STEP 1: Is there ANY popup, modal, or expanded review card visible in the screenshot? 
(Note: For Logo Sliders, a large white card appearing on top of the moving logo strip is a popup.)
→ [YES / NO]

If NO: Mark this category as PASS (N/A) and skip to next category.

If YES, proceed to STEP 2:

STEP 2: BOTTOM EDGE TRUNCATION TEST (MANDATORY)
- Locate the absolute BOTTOM edge of the popup/modal card
- Look at the last visible element (text, button, or border)
- Ask: Can I see a complete, rounded bottom border with padding below it?

Visual Test:
✓ PASS: Clean rounded border + whitespace/padding below content
✗ FAIL: Content/background hits a "flat wall" at viewport edge
✗ FAIL: Text is cut off mid-line horizontally
✗ FAIL: Bottom border is not visible

If STEP 2 shows ANY flat wall or missing border → IMMEDIATE FAIL (CRITICAL)

STEP 3: Additional Popup Checks (only if STEP 2 passed)
Q1. Is the popup fully visible at ALL edges (top/bottom/left/right)? → [FULLY VISIBLE / SLICED]
Q2. Is the popup logically positioned (centered or near trigger)? → [WELL POSITIONED / MISALIGNED]
Q3. Is all text inside fully readable (no half-cut lines)? → [FULLY READABLE / HALF-CUT]
Q4. Does text touch card edges with no padding? → [YES / NO]

FAILURE RULES:
- Q1 SLICED or Q3 HALF-CUT → FAIL (CRITICAL)
- Q2 MISALIGNED or Q4 YES → FAIL (HIGH)`;

    // ─────────────────────────────────────────────────────────────
    // 🚨 SECTION 0: AUTOMATION SYSTEM FEEDBACK (DIAGNOSTIC SUPREMACY)
    // ─────────────────────────────────────────────────────────────
    let automationFeedback = "";
    if (geometricWarnings && geometricWarnings.length > 0) {
      automationFeedback = `
============================================================
🚨 SECTION 0: AUTOMATION SYSTEM FEEDBACK (HARD FACTS)
============================================================
The automation engine has mathematically verified the following facts.
**DIAGNOSTIC SUPREMACY RULE**: These facts represent GROUND TRUTH. 
If a fact indicates a failure, you ARE PROHIBITED from reporting "PASS" for that category.
MATHEMATICAL DETECTION OVERRIDES VISUAL ESTIMATION.

${geometricWarnings.map(w => `- ${w}`).join('\n')}

**MAPPING RULES:**
- If "TRUNCATED" or "FLAT WALL" is mentioned -> FAIL "A. LAYOUT & SPACING" and "G. POPUPS & MODALS".
- If "OVERBLEED" or "CLIPPED" is mentioned -> FAIL "A. LAYOUT & SPACING" and "B. ELEMENT CONTAINMENT".
- If "TEXT TRUNCATION" is mentioned -> FAIL "A. LAYOUT & SPACING" and "C. CONTENT & TEXT RENDERING".
- If "LAYOUT OVERLAP" is mentioned -> FAIL "A. LAYOUT & SPACING" and "B. ELEMENT CONTAINMENT".
- If "STAR RATING VISIBLE" is mentioned -> MUST report "Visible" for "Show Star Ratings".

============================================================
`;
    }

    return `
${automationFeedback}
# ROLE: QA AUTOMATION AI ENVIROMENT
You are a highly sensitive QA Automation AI specialized in visual validation. Your objective is to analyze the provided UI Screenshot(s) of a **${widgetType}** widget and verify feature visibility against the provided configuration.

============================================================
SECTION 1: GLOBAL FEATURE DETECTION CONTRACT (NON-NEGOTIABLE)
============================================================
1. **VISUAL EVIDENCE ONLY**: Do not infer. If a feature is not visible in the pixels of the screenshot(s), it is "Absent".
2. **GLOBAL AGGREGATION**: You are provided with ${isMultiImage ? 'multiple scans' : 'a scan'} of the widget. For functional features (like logos or buttons), if it's visible in ANY image, mark it "Visible". **CRITICAL AESTHETIC OVERRIDE**: Aesthetic bugs (cropping, overlaps) apply in reverse—if an aesthetic bug ruins EVEN ONE image in the batch, you MUST FAIL the Aesthetic Layout category.
3. **EAGLE-EYE SENSITIVITY**: These widgets often use tiny icons (~10px) as character suffixes. Scan the exact boundary of name strings and card corners.
4. **TARGET SCOPE**: Focus EXCLUSIVELY on the **${widgetType}** widget. Ignore surrounding page elements. **CRITICAL EXCEPTION:** Do NOT ignore large, disjointed review cards, buttons, or videos that appear floating far away from the main slider/container. These are NOT "surrounding page elements"; they are shattered widget fragments and MUST trigger a layout failure.
5. **REPORTING SCOPE**: Report EXCLUSIVELY on features explicitly listed in Section 5. If a feature is not in Section 5, DO NOT include it in the JSON output.
6. **VIDEO MEDIA EXCEPTION**: Video reviews (identified by a central Play Button) often do not contain Social Icons. If the widget is "Video-Only", report statuses realistically but explain the "Video Context" in the scenario.


**CRITICAL ANTI-HALLUCINATION RULES:**
- If a feature is not clearly legible or its location cannot be specified, mark it as **Absent**
- If you mark a feature as "Visible", you MUST provide evidence (location, description)
- Blurry, cut-off, or unclear features = **Absent**
- Do NOT assume features based on layout patterns alone


**VIDEO MEDIA EXCEPTION:**
- Video reviews (identified by Play Button) often lack Social Icons
- For video-only widgets, report realistically and note "Video Context" in scenario

============================================================
🚨 CRITICAL CARD CLIPPING DETECTION (HIGHEST PRIORITY)
============================================================
STEP 1: Identify all review cards / boxes (square or rectangular containers).

STEP 2: For EACH card, check:
- Is the FULL boundary visible? (top, bottom, left, right)
- Are ALL 4 edges clearly visible?
- Are corners fully rounded OR abruptly cut?

STEP 3: Look specifically for:
- Bottom half missing (card cut horizontally)
- Right side cut (sharp vertical edge instead of rounded corner)
- Card disappearing into footer or page boundary
- Only partial content visible (e.g., avatar visible but text missing)

STEP 4: DECISION:
If ANY card is NOT fully visible:
→ YOU MUST FAIL "A. LAYOUT & SPACING"
→ Severity = CRITICAL

MANDATORY ISSUE FORMAT:
"Review card is partially cut off at [top/bottom/left/right] causing incomplete visibility of content"

⚠️ Even ONE half-cut card = FAIL (Aesthetic Category Only)
⚠️ You are NOT allowed to mark PASS for the Layout category if ANY card is clipped.
⚠️ **CRITICAL FEATURE ACCESS**: Even if a card is clipped at the screenshot boundary, you ARE MANDATED to search it for functional features like "Read More" and "Date". If those features are legible, report them as "Visible". Layout failures should NEVER cause feature extraction failures.

============================================================
SECTION 2: WIDGET-SPECIFIC SCANNING RULES
============================================================

**AVATAR_GROUP**:
- 🚨 CRITICAL POPUP TRUNCATION CHECK (HIGHEST PRIORITY):
  BEFORE analyzing ANY features, examine the expanded review popup:
  1. Locate the absolute BOTTOM edge of the white popup card.
  2. Look for a clean, rounded bottom border with visible background padding below it.
  3. If the card background or text hits a "flat wall" at the viewport bottom edge (zero padding) → CATASTROPHIC FAILURE.
  4. If you cannot see the complete, closed-loop bottom border of the popup → FAIL "A. LAYOUT & SPACING" with severity CRITICAL.
  5. MANDATORY: If the popup is cut off at the bottom, even by 1 pixel, it is a FAIL.
  
- Analyze BOTH the avatar list AND the review popup that opens after clicking.
- **Show Star Ratings** (Aggregate Rating): Look for 1, 2, 3, 4, or 5 aggregate stars typically placed ABOVE, BELOW, or to the RIGHT of the row of circular avatar photos. This is the OVERALL rating for the group. It is OUTSIDE the popup.
- **Show Review Ratings** (Individual Rating): Look for per-review star ratings INSIDE the review popup, usually below the reviewer's name.
- Show Social Platform Icon: Any logo or icon in the TOP RIGHT corner inline with the reviewer name in the review popup = Visible.
- **Read More**: If config "show_full_review" is "0", you MUST find a "Read More" or "More" link inside the popup text block. If present, mark Visible. If "show_full_review" is "1", "Read More" should be Absent.
- Review Date: Check BOTTOM LEFT of the review popup in formats like "Jan 25, 2025", "7 May 2025", or just the year (e.g., "2024"), and mark Visible if any date is seen.
- Inline CTA: Look for a styled button or link with ("↗") at the bottom of the reviewtext in the popup area.
-- Combine findings from ALL screenshots — if visible in any, mark Visible.

**AVATAR_CAROUSEL**:
- Analyze BOTH the avatar row AND the expanded review popup that opens after clicking an avatar.
- Navigation may include left/right arrows for the avatar row.
- **Left & Right Shift Buttons**: Look at the absolute bottom of the widget (below the avatar cards). Check for circular arrow buttons like "←" or "→" or "<" or ">". If visible in any screenshot -> Visible.
- **Show Review Date**: Look ONLY inside the opened review. YOU MUST explicitly quote the exact date. The expected format is strictly 'Month DD, YYYY' (e.g., "February 08, 2026"). **ANTI-CHEAT WARNING**: Do NOT invent relative dates like '5 months ago' or '7 months ago' just because the config expects it! If the exact date format is not visible, you MUST mark it "Absent".
- **Inline CTA**: Look inside the opened review. Look for a styled button or link like "Get Started" or "Click Here". (It often has an arrow "↗" but it is NOT required).
- IMPORTANT VALIDATION RULES: If something is blurry, cut off, or unclear -> mark "Absent". Do NOT assume features based on layout.
- Combine findings from ALL screenshots — if visible in any, mark Visible.

**CAROUSEL_SLIDER**:
- Scan ALL individual review cards.
- Left & Right Buttons: Look for arrow (< , > )controls on the left and right edges of the widget.
- Slider Indicators: Look for dots or lines at the absolute bottom of the widget.
- Show Social Platform Icon: Any logo or icon or any alphabets in the TOP RIGHT corner of each card = Visible. It can be in any colour.
- Show Review Ratings: **CRITICAL**: Look for per-review star icons (gold/yellow/green) inside EACH individual card, usually positioned below the reviewer's name. Even if small, if stars are present, mark as Visible.
- Read More: Look at the bottom of the text block in EACH card.
- Inline CTA: Look for a styled button or link with ("↗") at the bottom of the reviewtext in the card area.
- Review Date: Check BOTTOM LEFT of the review text area. The expected format is strictly 'Month DD, YYYY' (e.g., "February 08, 2026"). Mark Visible ONLY if this explicit format is seen.
- **VIDEO CARD EXCEPTION**: If cards have a large Play Button (Video Review), they may lack Social Icons. If ALL visible cards are video and lack these feature, report as Absent but mention "Video Review" in scenario.
- Combine findings from ALL screenshots — if visible in any, mark Visible.

**SINGLE_SLIDER**:
- Multiple screenshots show different reviews revealed by clicking an avatar.
- Review content (stars, social icon, text) appears ABOVE the avatar row.
- Show Social Platform Icon: Any logo or icon in the RIGHT side of the reviewer's name = Visible.
- Show Review Ratings: Per-review stars in the review content area above the avatars.
- Read More: Look for "Read More" at the end of the review text.
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
- Read More: "Read More" at the end of truncated text.
- **Inline CTA (CRITICAL)**: Look for a large, styled button at the absolute bottom of the revealed popup. It often has a distinct color (e.g., lavender/pink/blue/white/black/gray) and **MANDATORILY** contains a diagonal upward arrow icon (**↗**). Even if the label is "Get Started?" or another phrase, report as **Visible** if the icon and button style are present.
- Combine findings from ALL screenshots — if visible in any (scrolling or popup), mark Visible.

**CROSS_SLIDER**:
- Analyze BOTH the cross slider view AND the expanded review popup that opens after clicking on a review text.
- Reviews scroll in a cross format (diagonal, left-right, or right-left).
- **Show Cross Bar**: Look at the reviews scrolling diagonally. Look for the presence of the cross bar visual element. If visible in any screenshot -> "Visible".
- **Show Review Date**: Check ONLY inside the expanded review. Look for readable date text strictly in the 'Month DD, YYYY' format (e.g., "February 08, 2026").
- **Inline CTA**: Check ONLY inside the expanded review. Look for a button or link (e.g., "Get Started", "Visit"). (Note: The arrow symbol "↗" is NOT strictly required).
- IMPORTANT VALIDATION RULES: Blurry, cut-off, or unclear features -> mark "Absent". Do NOT assume features based on layout. Date must be readable -> else "Absent".
- Return details explicitly focusing on these features.


**COMPANY_LOGO_SLIDER**:
- **🚨 BROKEN TOKEN CHECK (CRITICAL)**: Scan all text labels. If you see "(t)(t)(t)" tokens, FAIL "C. CONTENT & TEXT RENDERING".
- **🚨 MANDATORY STEP 0: THE SPECTRUM ANCHOR (PIXEL SUPREMACY)**:
  - **COLOR REFERENCE**: Locate the **Feedspace Branding logo** or any **Blue/Red buttons** in the widget. These are your "True Color" reference points.
  - **SATURATION COMPARISON**: Compare the scrolling logos to these references. If the logos appear as shades of gray/black/white while the buttons/branding are vibrant, THE LOGOS ARE IN GRAY MODE.
  - **REPORTING RULE**: If your Color Reference shows saturation but the logos do not -> YOU MUST mark "Displays Gray mode" as **Visible**. Do NOT guess based on config.
- **🔍 THE MICROSCOPIC DATE SCAN (DISCOVERY SUPREMACY)**:
  - **ZONE OF INTEREST**: Look EXCLUSIVELY at the small white space (usually 10-15px height) directly BELOW the logo image and ABOVE the 'Get Started' button (arrow ↗).
  - **SINGLE-HIT RULE**: If 'Month DD, YYYY' is visible in **EVEN ONE** of the provided images, the feature is **Visible**. You MUST ignore screenshots where the date is cut off or missing.
  - **PERCEPTION RULE**: If ANY text characters exist in this specific gap, "Show Review Date" IS **Visible**. You MUST quote the string (e.g., 'October 12, 2023') in your remarks.
- **GRAY-SPECTRUM AUDIT & WIDGET SPEC**:
  1. If logos have ZERO color saturation (Grayscale/B&W) -> Mark "Displays Gray mode" as **Visible**.
  2. If logos show ANY primary colors -> Mark "Displays Gray mode" as **Absent**. 
  3. Comparison Logic: After determining visibility from pixels, check config **enable_grey_mode**. 
     - If (UI: Visible) + (Config: 1) -> Pass.
     - If (UI: Absent) + (Config: 1) -> FAIL Category F.
     - If (UI: Visible) + (Config: 0) -> FAIL Category F.
- **ANCHOR-BASED POPUP SCAN**: A white card appearing over the logo strip (usually Center or Bottom-Center quadrant) IS a popup. When visible, ignore any "(t)" tokens and scan DOWNWARDS from the top of the card:
  1. Skip the media/image area.
  2. Find the **Review Date**: Look for small gray text (strictly format 'Month DD, YYYY') immediately below the media but above the CTA. YOU MUST explicitly quote the date string in your remarks.
  3. Find the **Inline CTA**: Look for a styled button characterized by a diagonal arrow (↗) at the absolute bottom. The label text can vary (e.g., 'Get Started'). YOUR REMARKS MUST explicitly specify the label.


**MARQUEE — Horizontal (Multi-Card, Left-Right Scroll)**:
- Multiple review cards scrolling horizontally, possibly in multiple rows.
- SCAN EVERY CARD INDIVIDUALLY across all rows and all screenshots.
- Show Social Platform Icon: Any logo or icon (Google, LinkedIn/ln, Facebook, etc.) in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: **CRITICAL**: Search EACH individual card for star icons (gold/yellow/green), typically located directly below the reviewer name.
- Show Review Date: Any date text (even small/gray/faint) in any card = Visible.
- Read More: Any "Read More" or "Show More" in any card = Visible.
- Static UI elements only — horizontal movement is verified by a separate system.

**MARQUEE — Vertical (Multi-Card, Up-Down Scroll)**:
- Multiple review cards scrolling vertically (upward or downward).
- SCAN EVERY VISIBLE CARD INDIVIDUALLY across all screenshots.
- Show Social Platform Icon: Any logo or icon (Google, LinkedIn/ln, Facebook, etc.) in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: **CRITICAL**: Search EACH individual card for star icons (gold/yellow/green), typically located directly below the reviewer name.
- Show Review Date: Any date text (even small/gray/faint) in any card = Visible.
- Read More: Any "Read More" or "Show More" in any card = Visible.
- Left & Right Buttons: Mark **Absent** — this widget type does not use left/right navigation arrows.
- Static UI elements only — vertical movement is verified by a separate system.


**MASONRY**:
- Multi-column brick-style layout. Scan every card across all columns in all screenshots.
- **Read More (CRITICAL DETECTION)**: Look for the blue,black or colored text "Read More" positioned **immediately after the review text** and **BEFORE the date**. It frequently acts as a bridge between the review and the meta-data.
- **EAGLE EYE RULE**: If you see "..." at the end of a long review, almost certainly there is a "Read More" link nearby. Zoom in on the pixels between the text end and the date. If seen on any visible card (even a clipped one), mark as **Visible**.
- Show Social Platform Icon: Any logo or icon in the TOP RIGHT corner of each card = Visible.
- Show Review Ratings: Per-card star icons inside each card.
- Show Review Date: Footer text (small/gray) in any card.
- **Show Load More Button**: Look for a large, styled button at the absolute bottom center of the masonry grid.


============================================================
SECTION 3: COMMON FAILURE MODES — AVOID THESE
============================================================
- **Show Star Ratings (AGGREGATE ONLY)**: These are the **OVERALL** ratings (e.g., "4.8/5" ,"5"or "Used by leading teams") appearing **OUTSIDE** the popup, near the avatar row or bottom of the Avatar Row.
  - **EVIDENCE RULE**: If marked as Visible, you **MUST** specify where they are (e.g., "Top right of avatar row", "Center below avatars").
- **Show Review Ratings (INDIVIDUAL ONLY)**: These are the ratings **INSIDE** the individual review cards/popups.
- **MANDATORY DISTINCTION**: Do NOT mark stars inside a card as "Show Star Ratings". They are "Show Review Ratings". If Aggregate stars are not present outside the popup, mark "Show Star Ratings" as **Absent**.
- **Read More**: **[HARD REQUIREMENT]** If you mark this as **Visible**, you **MUST** provide the exact 3 words preceding the link.
  - **THE ELLIPSIS RULE**: The presence of an ellipsis ("...") or "..." dots is **NOT** evidence that "Read More" is Visible. It only confirms the text is truncated. 
  - **LITERAL VISION ONLY**: You must ONLY mark "Read More" as Visible if you can physically see the distinct words "Read More", "Show More", or a styled, high-contrast button.
  - **LEGIBILITY & CONTRAST (CRITICAL)**: If you see "..." but the following link area is blank, white-on-white, or illegible, you **MUST** mark it as **Absent** AND YOU MUST FAIL "F. THEME & COLOR VISIBILITY".
- **Show Review Date**: Check corners/footer of the review popup. Mark as Visible ONLY if a specific date is legible.
- **CRITICAL ANTI-HALLUCINATION**: If a feature is not clearly legible or its specific location/text evidence cannot be provided, mark it as **Absent**.

============================================================
SECTION 4: VISUAL AESTHETIC CHECKLIST (GENERAL)
============================================================
Analyze the UI images for these critical aesthetic defects. **You must aggressively look for these layout, rendering, or styling issues.**

A. LAYOUT & SPACING
- **CATASTROPHIC MISALIGNMENT**: Check if any large review cards, videos, or elements are floating awkwardly entirely outside the main structural flow of the widget (e.g. stranded on the left margin, overlapping unrelated white space). **DO NOT assume these scattered pieces are 'surrounding page elements' to be ignored**—they are broken, disorganized widget fragments. You MUST FAIL this category with priority.
- **SEVERE OBSCURATION & CLIPPING**: Check the TOP and BOTTOM edges of the widget. Is the widget being cut off horizontally? Is it hiding behind another webpage element? If the top half or bottom half of the widget (e.g., sliced avatars, cut-off text, half-hidden stars) is visibly obscured, YOU MUST FAIL this category.
- **HOVER FLIP EXCEPTION**: Some widgets (like Avatar Carousels) are designed to flip from a photo avatar to a text-heavy white review box when hovered. If you see one card showing text while all the others show photos, THIS IS INTENDED FUNCTIONALITY. Do NOT fail it for mismatched templates. Focus entirely on whether the text inside that flipped box is being chopped off or overflowing its borders.
- **PARTIAL CARD VISIBILITY (CRITICAL)**:
  If any review card (square/rectangular box) is NOT fully visible 
  (e.g., bottom half missing, top cut off, or only a portion visible),
  it MUST be marked as FAIL.

  This includes:
  - Half-visible grey boxes
  - Cards cut horizontally (top or bottom missing)
  - Cards appearing as incomplete placeholders
  - Only skeleton/partial UI visible

  RULE:
  If even ONE card is not fully visible → FAIL (CRITICAL)
- **Widget does not bleed outside the viewport**
- Cards do not overlap each other
- Proper spacing between cards (no double gaps)
- First and last cards are not flush against edges
- Widget does not stretch excessively on wide screens
- Widget maintains spacing from surrounding page content (top/bottom)

B. ELEMENT CONTAINMENT
- **Card boundaries**: The entire card must be fully visible; edges must not be arbitrarily cropped by the parent container.
- No element overlaps within the same card
- Text does not touch card borders
- Avatar stays within circular/rounded boundary
- Images/media elements do not overflow container
- Very long words or unbroken text do not break layout

C. CONTENT & TEXT RENDERING
- **GHOST CARDS (CRITICAL / PRIORITY #1)**: If you see a card box (container) but its interior appears empty or text is invisible (white-on-white), YOU MUST FAIL THIS CATEGORY IMMEDIATELY. This is the most severe rendering error possible.
- **BROKEN TOKENS / RAW CODE**: Look closely at the text payload. If you see raw placeholder tokens, unrendered code, or weird repeating structural characters like "(t) (t) (t)" instead of actual content, YOU MUST FAIL THIS CATEGORY.
- Long text truncated properly with ellipsis (no text cut abruptly midway vertically without visual fade)
- Emojis/special characters do not overflow
- Review text clamped at configured lines with ellipsis

D. AVATAR RENDERING
- Avatar perfectly circular (not oval/square)
- Avatar does not overflow boundary
- Avatar not stretched/squished
- Avatar size consistent across cards
- Avatar not pixelated/blurry
- Missing avatar shows initials/placeholder text clearly

E. MEDIA & IMAGES
- **BROKEN IMAGES / MISSING ASSETS**: If you see missing image icons, broken image placeholders, or raw text instead of actual logos/photos, YOU MUST FAIL THIS CATEGORY.
- **ASPECT RATIO / STRETCHING FATAL ERROR**: Look closely at the faces/photos in the avatars. If any photo or logo looks unnaturally stretched, squished, or elongated (e.g., a person's face looks visibly squeezed horizontally or stretched vertically like a funhouse mirror), the aspect ratio is broken. YOU MUST FAIL THIS CATEGORY IMMEDIATELY.
- **IMAGE QUALITY CHECK**: Images, thumbnails, and photos MUST NOT be noticeably pixelated, blurry, or show severe low-resolution compression artifacts. Compare the sharpness of the image to the text. If it is badly pixelated, YOU MUST FAIL this category.
- Media fully visible or scrollable

F. THEME & COLOR VISIBILITY
- **FATAL ILLEGIBILITY**: All text and clickable links MUST have high contrast against their background. 
- **INVISIBLE LINKS (CRITICAL)**: Look for "Read More" or buttons near "..." ellipses. If the text or button is present but invisible due to color matching (e.g., White text on White background), YOU MUST FAIL THIS CATEGORY. This is a severe rendering defect.
- **BAD CONTRAST**: If you see dark text on a dark background or light text on a light background, making it hard to read, YOU MUST FAIL THIS CATEGORY.
- **THEME INCONSISTENCY**: Widget components must share the same theme. If a floating/preview card is Dark Theme but its expanded popup is Light Theme (or vice versa), FAIL the category for "Theme Mismatch".

G. POPUPS & MODALS
- First determine: Is any popup/modal visible in the screenshot?
- IF YES:
  - **FATAL POPUP CLIPPING**: The entire popup card MUST be 100% visible. If any edge of the popup is sliced off, YOU MUST FAIL this category immediately. 
  - **LOCATION REQUIREMENT**: If you fail for clipping, you **MUST** specify which edge is truncated (**Top, Bottom, Left, or Right**) and describe the visual evidence (e.g., "Review text cut off midway at the bottom edge").
  - **MODAL PLACEMENT**: The popup should be logically centered or positioned cleanly relative to its trigger. If the popup is severely misaligned (e.g., shoved into the absolute bottom left corner, overlapping things disjointedly), FAIL this category.
  - Popup content is fully readable (no half-cut text lines).
  - Proper padding inside popup (text does not touch edges).
  - Popup appears safely above the widget and is not hidden by other page elements.

============================================================
SECTION 5: CONFIGURATION REQUIREMENTS
============================================================
**IMPORTANT - COGNITIVE BIAS WARNING**: You are about to see the "Config Status" (what the system EXPECTS to be there). YOU MUST NOT LET THIS BIAS YOUR VISION. Do not invent, hallucinate, or falsely detect a feature just because the config says "Visible". If the pixels aren't there, you MUST mark "Absent" and let it FAIL.

Validate the UI against these specific settings:

${instructions}

============================================================
SECTION 6: MANDATORY PRE-SUBMIT ALGORITHMIC CHECK
============================================================
1. SOCIAL SUFFIXES: Check for 10px icons (G, f, a, y) immediately following reviewer names
2. MODAL CONTENT: Confirm features inside expanded modal area (Avatar Group/Toast)
3. Show star ratings: Ensure per-review stars are not confused with aggregate group stars
4. Inline CTA: Look for actionable CTA buttons/links (FOR CROSS_SLIDER: the arrow ↗ IS MANDATORY; for others it is common but optional)
5. Review Date: Scan footer corners for legible date text
6. Read More: Look for "Read More" or " More" at the end of text blocks
7. VIDEO CONTEXT: If features absent, verify if widget is Video-Only
8. LOAD MORE: If "Show Load More Button" is visible in config, scan bottom of widget
9. **STRICT CAROUSEL EDGE CLIPPING CHECK (CRITICAL)**: Locate the very last avatar or card on the far-right side of the widget. Look closely at the right-hand edge of that final photograph. Does the photo end naturally with its intended rounded CSS corners, or does it hit an invisible wall and form a sharp 90-degree straight vertical line? If you see a sharp, 90-degree chop on the outer edge, the image is being clipped by the CSS container. YOU MUST FAIL "A. LAYOUT & SPACING". Do not generalize or make assumptions—look exclusively at the geometry of the rightmost edge.
9b. CARD WIDTH PARITY CHECK: Visually compare the width of every card in
    the widget row. If the rightmost (or leftmost) card is noticeably
    narrower than the others — even if it has visible rounded corners on
    both sides — the container is clipping its width. A card with corners
    but reduced width is still a clipped card. FAIL "A. LAYOUT & SPACING"
    and label it "Card width inconsistency — rightmost card narrower than peers".
10. Z-INDEX & POPUP CLIPPING CHECK: Look at the top and bottom edges of the widget and any open popup cards. Is any structural element or review text sliced horizontally? (e.g., the bottom row of a review text is visibly cut in half by a container boundary). If yes, FAIL the relevant Aesthetic category.
11. CONTRAST & THEME CHECK: Look at the text inside the widget and popups. Is the text illegible due to poor contrast (e.g., dark text on a dark background)? Do the preview card and popup have mismatched themes (one dark, one light)? If yes to either, FAIL F. THEME & COLOR VISIBILITY.
12. SHATTERED WIDGET CHECK: Look for large, disjointed pieces of the widget (like a big red video card) floating far away from the main slider/container. If any piece is stranded or overlapping empty space awkwardly, FAIL A. LAYOUT & SPACING.


**QUADRANT AUDIT — EDGE INTEGRITY (NON-NEGOTIABLE):**
1. **RIGHT EDGE**: Look at the rightmost element in the widget. Is there whitespace/background visible to its right? If not, and it has a 90-degree vertical edge, it is CLIPPED.
2. **BOTTOM EDGE**: Look at the bottommost element (card or popup). Is there whitespace/background visible below it? If it hits the edge of the image with a flat horizontal line, it is TRUNCATED.
3. **MANDATORY QA FAIL**: If either check finds a "Flat Wall" edge → FAIL A. LAYOUT & SPACING.
You MUST answer the following questions by examining the screenshot pixels directly.
Do NOT copy these questions into the JSON output.
Carry ONLY your final conclusion into the JSON "issue" field for A. LAYOUT & SPACING.

${layoutPreAnalysis}

============================================================
SECTION 6.6: MANDATORY AESTHETIC PRE-ANALYSIS — ANSWER BEFORE WRITING JSON
============================================================
You MUST answer every question below by examining the screenshot pixels directly.
Do NOT copy these questions into the JSON output.
Carry ONLY your final conclusion into each category's "issue" field in the JSON.

${aestheticPreAnalysis}

Only after answering ALL questions in Sections 6.5 and 6.6, proceed to Section 6.7.
============================================================
SECTION 6.7: MANDATORY POPUP/MODAL FINAL VERIFICATION
============================================================
Before writing your JSON output, if ANY popup/modal/expanded card is visible:

FINAL CHECKPOINT — POPUP TRUNCATION:
□ I can see the COMPLETE bottom border of the popup card (all 4 corners rounded)
□ There is visible padding/whitespace (at least 10px of background) below the last element
□ No text is cut off mid-line at the bottom edge
□ The card does not hit a "flat wall" at the viewport boundary

🚨 **ZERO TOLERANCE**: If the card background hits the bottom of the screenshot with a flat line, it is a FAIL in Category G.
🚨 **THE VERTICAL-PROXIMITY ANCHOR (READ MORE)**: The "Read More" link lives either on the same line as the ellipsis "..." or **directly on the line below it**. If that specific space is empty but the config expects visibility, YOU MUST NOT assume it is "hidden in truncation." It is a RENDERING FAILURE. You MUST FAIL Categories C and F.

Evidence Required: Describe what you see at the bottom of the popup:
Example: "Clean rounded bottom border with 16px padding below 'Get Started' button"

⚠️ If you are uncertain or cannot clearly see the bottom edge → mark as FAIL
============================================================
SECTION 7: REPORTING LOGIC & JSON CONTRACT
============================================================
Use the following logic to determine the "Status" for features in Section 5:
- (UI: Visible) + (Config: Visible) => PASS
- (UI: Visible) + (Config: Absent/Missing) => FAIL (Unintended Feature / Leakage)
- (UI: Absent)  + (Config: Visible) => FAIL
- (UI: Absent)  + (Config: Absent/Missing)  => PASS

🚨 **MISSING CONFIG RULE**: If a configuration key for a feature listed in Section 5 is MISSING or UNDEFINED in the provided data, YOU MUST assume the expected state is **"Absent"**. If you see the feature in the pixels, you MUST report it as **"Visible"** and flag it as a **FAIL**.

    **AESTHETIC REPORTING INSTRUCTIONS**:
    - **AESTHETIC FAILURES ARE ABSOLUTE**: If you see a layout defect, cropped card, overlapping text, or any aesthetic violation in **EVEN ONE** of the provided screenshots, you MUST fail that category. Do not pass it just because another screenshot in the batch looks correct.
    - You MUST actively evaluate and report on ALL 7 Aesthetic Categories from Section 4 (A through G).
    - You MUST return exactly 7 objects in the \`aesthetic_results\` array (one for each category).
    - "category": The section prefix and name, e.g., "A. LAYOUT & SPACING"
    - "issue": If the JSON template below requires a MANDATORY CHAIN OF THOUGHT for a specific category, you MUST write your full analysis here first. 
    
    **ISSUE WRITING RULE (MANDATORY)**:
    - If ANY answer in the Pre-Analysis (Sections 6.5 or 6.6) triggers a FAIL condition:
      → Clearly state WHAT is broken + WHERE + IMPACT
      → **RUTHLESS REPORTING RULE**: Do NOT copy the Chain of Thought, question text, or entire analysis into the JSON. ONLY write the final summary verdict using the format below.
      → Format: "[Element] is [problem] causing [impact]"
      → Examples: 
          - "Review text is cut off at the bottom of cards causing incomplete readability"
          - "Avatars are distorted and not circular causing visual inconsistency"
          - "Right edge of card is chopped at 90-degrees causing layout failure"
    - If NO issues:
      → "No visual defects detected"

    - **ZERO TOLERANCE (RENDERING)**: If any "GHOST CARD CHECK" (Q7) or "INVISIBLE LINK CHECK" (Q6) triggered a YES result, you are FORBIDDEN from marking "C. CONTENT & TEXT RENDERING" or "F. THEME & COLOR VISIBILITY" as PASS. You must report: "Card body or functional text is invisible causing fatal rendering failure".
    - **COUPLED-FAULT RULE (MANDATORY)**: If you fail Category A or G for clipping/truncation, you MUST also fail Category F. Truncation = Lack of Visibility. You are FORBIDDEN from reporting "No visual defects detected" for Theme/Visibility if the card is physically cut off.
    - **MULTI-FAULT REPORTING (MANDATORY)**: Do NOT let a layout failure (clipping) mask a rendering failure (invisible text). If both exist, you MUST fail BOTH categories. "No visual defects detected" is FORBIDDEN if ANY defect in that category is observed in the visible pixels.
    - **ZERO TOLERANCE (LAYOUT)**: If any layout pre-analysis question (Q1-Q5) triggered a FAIL/SLICED/CHOPPED/FLAT WALL result, you are FORBIDDEN from marking the category as PASS.

**OUTPUT FORMAT**:
Return RAW JSON only. No markdown prose. No preamble.

{
  "feature_results": [
    {
      "feature": "[Feature Name]",
      "ui_status": "Visible/Absent/Issue Detected",
      "config_status": "Visible/Absent/N/A",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "remarks": "[Diagnostic summary, e.g., 'UI visible, config absent, mismatches hence fail']",
      "status": "PASS/FAIL"
    }
  ],
  "aesthetic_results": [
    {
      "category": "A. LAYOUT & SPACING",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "CRITICAL, HIGH, MEDIUM, LOW, or N/A",
      "status": "PASS or FAIL"
    },
    {
      "category": "B. ELEMENT CONTAINMENT",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    },
    {
      "category": "C. CONTENT & TEXT RENDERING",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    },
    {
      "category": "D. AVATAR RENDERING",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    },
    {
      "category": "E. MEDIA & IMAGES",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    },
    {
      "category": "F. THEME & COLOR VISIBILITY",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    },
    {
      "category": "G. POPUPS & MODALS",
      "issue": "[Format: \"[Element] is [problem] causing [impact]\" OR \"No visual defects detected\"]",
      "severity": "[CRITICAL/HIGH/MEDIUM/LOW/N/A]",
      "status": "[PASS or FAIL]"
    }
  ],
  "overall_status": "PASS if ALL features PASS and NO Aesthetic issues, else FAIL"
}
`;
  }
}

module.exports = PromptBuilder;