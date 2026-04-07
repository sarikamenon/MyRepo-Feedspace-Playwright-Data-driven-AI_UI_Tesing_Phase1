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
      "Displays Gray mode": "enable_grey_mode",
      "Review Image / Avatar": "allow_to_display_feed_image"
    };

    const invertedFeatures = {
      "Read More": true
    };

    const featuresToTest = staticFeatures || config.features || Object.keys(featureMap);

    const instructions = featuresToTest
      .map(featureName => {
        const configKey = featureMap[featureName];
        let expected = "Absent";

        if (configKey) {
          const keys = Array.isArray(configKey) ? configKey : [configKey];
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

        return `- **${featureName}**: (Config Status: ${expected})`;
      })
      .join('\n');

    // ============================================================
    // CORE VALIDATION RULES (SINGLE SOURCE OF TRUTH)
    // ============================================================
    const coreRules = `
============================================================
🚨 SECTION 0: SYSTEM MANDATE (NON-NEGOTIABLE) 🚨
============================================================
**DIAGNOSTIC SUPREMACY RULE**: The following facts represent GROUND TRUTH.
1. **SHARPNESS BENCHMARK (RETINA-SCAN)**: Look at the anti-aliasing of the review text (e.g. Names/Roles). Rotated text (like Cross Sliders) or high-speed marquees may have minor anti-aliasing (smoothing/fuzziness up to 3px). This is **NORMAL** browser behavior. Do **not** mark as blurry/absent if the content/words are still clearly readable.
2. **TEXT-IMAGE SYNC**: If the text is crisp but the image is "soft", "fuzzy", or "grainy", YOU MUST FAIL CATEGORY E.
3. **MANDATORY VERDICT**: ONLY mark "FUZZY-FAIL" or "BLURRY-FAIL" if letter shapes are shattered, ghosted, or impossible to read.

============================================================
🚨 MANDATORY RESPONSE MANDATE: ABSOLUTE AUDITOR
============================================================
- You are a **PIXEL AUDITOR**, not a reviewer.
- You MUST scan **EVERY screenshot** for **DIFFERENT reviewers**.
- **MANDATORY AUDIT LOG**: You are PROHIBITED from providing a generic PASS/FAIL summary. Your \`analysis_message\` MUST include a line/table for **EVERY unique reviewer** found.
- **FAILURE PROPAGATION**: If ANY single reviewer fails a rule (Sharpness, Truncation, JSON), the entire Category MUST be marked **FAIL**.
- **NO DEBT**: You cannot ignore a blurred Mel B just because Jesse Cooke is sharp.
- **IMAGE DEFINITION**: "Image/Graphic" includes **Photos, Logos, Icons, and INITIALS-BASED boxes**. All must be audited for sharpness.

============================================================
🚨 CORE VALIDATION RULES (IRON LOCK)
============================================================

**RULE 1: FORCED SHARPNESS & QUALITY (IRON LOCK)**
- **STEP 1**: Identify the sharpest text visible.
- **STEP 2**: Identify the avatar/icon/logo/diagonal-text edge.
- **STEP 3**: Compare edge transition:
    - Text edge: 1-2px boundary
    - Image/Diagonal text: 1px → **PASS**, 2-3px soft gradient (anti-aliasing) → **PASS**, >4px motion blur/ghosting → **FAIL**.
- **OUTPUT**: You MUST provide a **SHARPNESS LOG**:
    - "[Name]: Text Xpx / Image Ypx → PASS/FAIL"
- **Triggers**: Categories D (Avatar Rendering) and E (Media & Images)

**RULE 3: TEXT TRUNCATION (NAME & ROLE ONLY)**
- **Audit Domain**: **Reviewer Name** and **Job Role** only.
- **IGNORE**: Review Body (Review body truncation is PASS).
- **FAIL**: Any "..." (ellipsis) in the **First Line** of Name or Job Role.
- **FAIL**: Characters cut off or sliced in the middle.
- **OUTPUT**: Add to audit table: "[Name] [Field]: ... detected → FAIL" (Use keywords: clipped-fail, sliced-fail)

**RULE 2: EDGE INTEGRITY (Card Clipping & Containment)**
- ALL cards must show complete boundaries (all 4 edges visible)
- Rounded corners must be fully visible (no 90° sharp chops)
- **"Flat wall"** (0px padding at container edge) → FAIL
- Rightmost/leftmost card narrower than peers → FAIL "Card width parity"
- Content must NOT touch container edges (minimum 10px padding)
- **TEXT-GRAPHIC COLLISION (ZERO TOLERANCE)**:
    - If ANY character (Name, Role, or Body) overlaps the avatar/logo boundary → **FAIL**.
    - Look for "Character Slicing": If a letter sits on top of the image color, it is a defect.
- **Bottom edge test**: Must see complete rounded border + whitespace below
- **Right edge test**: Must see whitespace to the right (not vertical chop)
- **Triggers**: Categories A (Layout), B (Containment), G (Popups)

**RULE 3: FIRST-LINE TRUNCATION (Pixel-Based Edge Audit)**
- **SCOPE (CRITICAL)**: Concentrate ONLY on the **NAME** and **JOB ROLE** (Designation) fields for truncation. 
- **REVIEW BODY EXCEPTION**: Truncation in the **Review Body** is a **PASS** (it is expected/valid behavior). Do NOT report Body truncation.
- **FAIL CRITERIA**: FAIL ONLY if the ellipsis ("...") appears on the **FIRST line** of the **NAME** or **JOB ROLE**.
- **User Example (FAIL)**: **Jesse Cooke** (Single line NAME ends in "...").
- **User Example (PASS)**: **Review Body** ending in "..." (Valid state).
- **JSON LEAKAGE**: FAIL [Category C] if the review body contains JSON-like structures (e.g., '{"pros":...', 'null', '{"cons":...') instead of natural language.
- **LITERAL NAME TRANSCRIPTION**: For Category C, you MUST transcribe the first line of the **NAME** to prove truncation.
- **Triggers**: Category C (Content & Text Rendering)

**RULE 4: GHOST CARDS (Invisible/Illegible Text)**
- White-on-white text → FAIL
- Text rendered as solid bar/blob (no distinct characters) → FAIL
- Text color matching background → FAIL
- **Triggers**: Categories C (Content) and F (Theme & Color)

**RULE 5: READ MORE / DATE SEARCH (TWO-PASS AUDIT)**
- **TWO-PASS MANDATE**: You MUST perform two separate visual passes:
    1.  **PASS 1 (Body)**: Audit the review text/body for defects.
    2.  **PASS 2 (Footer)**: Zoom your attention specifically to the **BOTTOM-LEFT CORNER** of the card (the last ~50 pixels of height).
- **DEFECT ISOLATION**: If you see "Read More" or a Date in the bottom-left, it is **PASS (Visible)**. You are PROHIBITED from marking it "Absent" just because the body has JSON leakage or Skeleton loaders.
- **LITERAL TRUTH**: If legible to the human eye → Visible.
- **ABBREVIATION TOLERANCE**: Accept "Feb" vs "February" as a valid parity match.

**RULE 6: FEATURE DISTINCTION (Critical)**
- **"Show Star Ratings"** = AGGREGATE score (e.g., "4.8/5", "5 stars") appearing OUTSIDE individual cards, often with "Trusted by..." text
- **"Show Review Ratings"** = INDIVIDUAL stars/ratings INSIDE each card, above review text
- **Never conflate these two features**

**RULE 7: POPUP VALIDATION (DESIGN-AWARE)**
- **BORDERED STATE** (Border/Shadow enabled): Must see complete rounded border closure with visible padding (min 10px).
- **BORDERLESS STATE** (Border/Shadow disabled): "Flat wall" appearance is **PASS**. Do NOT fail based on lack of border closure.
- **ABSOLUTE FAIL**: Mark FAIL ONLY if actual characters/letter-shapes are sliced or cut-off mid-word horizontally or vertically.
- **PADDING TEST**: If borderless, is there still a visually distinct gap below the date? → [Visible Gap = PASS / No Gap = FAIL].
- **Triggers**: Category G (Popups & Modals)

**RULE 8: CASCADE FAILURES (Multi-Category Impact)**
- If Category A fails for clipping → MUST also fail:
  - Category C if text is cut
  - Category E if images are cut
- No masking allowed—fail ALL affected categories

**RULE 9: CARD IDENTIFIER REQUIREMENT**
- EVERY failure MUST include specific identifier:
  - Card name: "[Card: Jodie Sprague]"
  - Element role: "[Element: Vice President Role]"
  - Position: "[Element: Third card from left]"
- Generic descriptions like "The image" are FORBIDDEN without identifier

**RULE 10: SPACING SYMMETRY & INTERNAL BALANCE (The 2x Rule)**
- **EXTERNAL**: FAIL [Category A] if spacing on any side (Top vs Bottom, Left vs Right) is > 2x the opposite side.
- **INTERNAL**: All sections within a card (Header, Body, Footer) must have visually balanced gaps.
- **BREATHING ROOM**: Minimum 10px margin required at ALL edges.
- **BOTTOM-SQUEEZE (CRITICAL)**: FAIL if the gap below the last line of text/date is smaller than the gap above the first line of text.
- **ROTATION EXCEPTION**: For **CROSS_SLIDER**, the diagonal rotation (usually 10-15 degrees) is the **CORRECT ALIGNMENT**. Do NOT fail for "crooked text" or "unaligned bars" if they are diagonal.
- **Triggers**: Category A (Layout & Spacing)
- **INDIVIDUAL CARD AUDIT**: Scan EVERY card individually across ALL screenshots

**RULE 11: SKELETON LOADER AUDIT**
- FAIL [Category C] if review text is rendered as solid grey/colored bars (skeleton states) with no distinct letter shapes.
- **TRANSCRIPTION TEST**: If you cannot transcribe at least 3 distinct words because they are "rectangles" or "blocks" → respond "ACTUAL_BAR_FAILURE".
- **SKELETON HYDRATION**: Even if review body is a skeleton, you MUST scan the footer for "Show Review Date" and "Read More". Do NOT mark them Absent just because the body is a skeleton.
- **EXISTENCE LOCK**: If you identify skeleton bars, a Date, or "Read More", then **Category G (Popups & Modals)** MUST be marked as Visible. You are prohibited from saying "No popup visible" if you found its internal elements.
- **Triggers**: Category C (Content & Text Rendering)
`;

    // ============================================================
    // UNIVERSAL MANDATES (Simplified)
    // ============================================================
    const universalMandates = `
============================================================
🚨 UNIVERSAL SCANNING MANDATES
============================================================
- **NO HALLUCINATION**: Do NOT invent features because config expects them.
- **ANTI-BIAS (CRITICAL)**: If config says "Absent" but you see the feature in pixels → Mark "Visible" and mark status "FAIL". Your eyes must override the config.
- **CROSS SLIDER EXCEPTION**: Diagonal or tilted layout is **INTENDED**. Do NOT report "Horizontal Misalignment" or "Crooked Layout" for these elements.
- **PIXEL-FIRST SCANNING**: Analyze the image BEFORE reading the configuration. If you see a feature (like Stars), it is "Visible".
- **APPLY CORE RULES**: Reference Rules 1-10 throughout validation
- **NO IMAGE CASE**: If no images/avatars present → use "SHARP_PASS_FORCE" in reasoning
- **TARGET SCOPE**: Focus ONLY on the widget; ignore page elements UNLESS they're shattered widget fragments
- **VIDEO EXCEPTION**: Video reviews (Play button) may lack Social Icons—note context
`;

    // ============================================================
    // AUTOMATION FEEDBACK (Geometric Warnings)
    // ============================================================
    let automationFeedback = '';
    if (geometricWarnings && geometricWarnings.length > 0) {
      automationFeedback = `
============================================================
🚨 SYSTEM LOG: VISUAL ARTIFACTS DETECTED
============================================================
${geometricWarnings.map(w => `- ${w}`).join('\n')}

**MAPPING RULES:**
- "TRUNCATED" or "FLAT WALL" → Apply RULE 2 → FAIL Categories A & G
- "OVERBLEED" or "CLIPPED" → Apply RULE 2 → FAIL Categories A & B
- "TEXT TRUNCATION" → Apply RULE 3 → FAIL Categories A & C
- "LAYOUT OVERLAP" → Apply RULE 2 → FAIL Categories A & B
- "STAR RATING VISIBLE" → MUST report "Visible" for "Show Star Ratings"
- "CROSS BAR DETECTED" → **ALERT: THIS DOM-BASED SIGNAL IS FREQUENTLY A FALSE POSITIVE**. The engine confirmed CSS rendering for two tracks (L2R/R2L) but NOT necessarily the presence of content. You are PROHIBITED from marking "Visible" unless you can VISUALLY identify and name reviewers from BOTH intersecting tracks. If you only see content on ONE track, the system signal reflects a background layout shape—report "ABSENT" and trust your eyes over the system.
============================================================
`;
    }

    // ============================================================
    // WIDGET-SPECIFIC PRE-ANALYSIS (Simplified - Only Unique Checks)
    // ============================================================
    const widgetLayoutPreAnalysis = {
      FLOATING_TOAST: `
**FLOATING_TOAST — WIDGET-SPECIFIC CHECKS:**
Q1. Initial badge state: Fully visible or clipped? → [VISIBLE / CLIPPED]
Q2. Expanded popup: Apply RULE 7 (bottom edge complete?) → [PASS / FLAT-WALL FAIL]
Q3. Card width parity across states? → [PASS / NARROW-CLIPPED]
Q4. Popup content fully rendered (no invisible elements)? → [VISIBLE / GHOST]

**FAILURE TRIGGERS:**
- Q1 CLIPPED → Apply RULE 2 → FAIL Category A
- Q2 FLAT-WALL → Apply RULE 7 → FAIL Category G
- Q3 NARROW-CLIPPED → Apply RULE 2 → FAIL Category A
- Q4 GHOST → Apply RULE 4 → FAIL Categories C & F
- Apply RULE 1 (Sharpness) to all visible images`,

      MASONRY: `
**MASONRY — WIDGET-SPECIFIC CHECKS:**
Q1. Grid clipped at container edges? → [FULLY VISIBLE / CLIPPED]
Q2. All cards fully visible (no partial boxes)? → [ALL VISIBLE / SOME PARTIAL]
Q3. Column widths consistent? → [CONSISTENT / INCONSISTENT]
Q4. Orphaned/shattered cards in grid? → [SYMMETRICAL / ORPHANED]

**FAILURE TRIGGERS:**
- Q1 CLIPPED or Q2 SOME PARTIAL → Apply RULE 2 → FAIL Category A
- Q3 INCONSISTENT → Apply RULE 2 → FAIL Category A
- Q4 ORPHANED → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,

      MARQUEE_STRIPE: `
**MARQUEE_STRIPE — WIDGET-SPECIFIC CHECKS:**
Q1. Scrolling stripe sliced at top/bottom? → [FULLY VISIBLE / SLICED]
Q2. **EAGLE EYE**: Tiny social icons (~10px) as character suffix after names? → [VISIBLE / MISSING]
Q3. **DATE TRANSCRIPTION**: Look at bottom-left of popup. Quote exact date: → ["Month DD, YYYY" / "NONE"]
Q4. **INLINE CTA**: Popup bottom—styled button with arrow (↗)? → [VISIBLE / MISSING]
Q5. Platform icons in popup top-right? → [VISIBLE / MISSING]

**FAILURE TRIGGERS:**
- Q1 SLICED → Apply RULE 2 → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images
- Q3 "NONE" (if config expects Visible) → FAIL feature
- Q4 MISSING (if config expects Visible) → FAIL feature`,

      AVATAR_GROUP: `
**AVATAR_GROUP — WIDGET-SPECIFIC CHECKS:**
Q1. **TRANSCRIPTION TEST**: Look at the review body.
    - If you see real letter shapes → quote first 3 words.
    - If text area shows solid filled rectangles with no distinct characters (grey bars, skeleton blocks) → respond "**ACTUAL_BAR_FAILURE**".
    → [ACTUAL WORDS / "ACTUAL_BAR_FAILURE"]
Q2. **POPUP BOTTOM EDGE**: Apply RULE 7—complete rounded border visible? → [PASS / FLAT-WALL FAIL]
Q3. **DATE ANCHOR**: Look at absolute bottom-left of popup. Is there a date string (e.g. "February 10, 2026")?
    → Quote exact date text: [DATE / "ABSENT"]
Q4. **READ MORE ANCHOR**: Apply RULE 5—Look for literal literal text "Read more" (usually blue) above the date or at the text end?
    → Quote exact words: ["Read more" / "ABSENT"]
Q5. **VERTICAL VOID**: Bottom dead space larger than avatar height? → [BALANCED / VOID-FAILURE]
Q6. **BOTTOM SQUEEZE**: Proportional gutter check (>15% total height)? → [BREATHABLE / SQUEEZED-FAIL]
Q7. **LAST WORD TEST**: Quote the last 3 words of the review in the card: → [WORDS / "ACTUAL_SQUEEZE_DETECTED"]
Q8. **HORIZONTAL SYMMETRY**: Is the left padding significantly different (>2x) than the right padding? → [SYMMETRICAL / ASYMMETRIC-FAIL]

**FAILURE TRIGGERS:**
- Q1 "**ACTUAL_BAR_FAILURE**" → Apply RULE 11 → FAIL Category C (Content & Text Rendering)
- Q2 FLAT-WALL → Apply RULE 7 → FAIL Category G
- Q5 VOID-FAILURE → FAIL Category A
- Apply RULE 1 (Sharpness) to avatars`,

      AVATAR_CAROUSEL: `
**AVATAR_CAROUSEL — WIDGET-SPECIFIC CHECKS:**
Q1. **ASYMMETRIC CORNER**: Rightmost card—rounded or 90° chop? → [ROUNDED / CHOPPED]
Q2. **POPUP BOTTOM**: Apply RULE 7 (complete bottom visible?) → [PASS / FLAT-WALL / NO POPUP]
Q3. All cards fully visible? → [ALL VISIBLE / SOME PARTIAL]
Q4. Card width parity (rightmost vs others)? → [PASS / NARROW-CLIPPED]
Q5. **DATE FORMAT**: Inside popup—strict "Month DD, YYYY" visible? → [VISIBLE / ABSENT]

**FAILURE TRIGGERS:**
- Q1 CHOPPED → Apply RULE 2 → FAIL Category A
- Q2 FLAT-WALL → Apply RULE 7 → FAIL Category G
- Q3 SOME PARTIAL or Q4 NARROW-CLIPPED → Apply RULE 2 → FAIL Category A
- Apply RULE 1 (Sharpness) to avatars`,

      SINGLE_SLIDER: `
**SINGLE_SLIDER — WIDGET-SPECIFIC CHECKS:**
Q1. Review content sliced at top/bottom? → [FULLY VISIBLE / SLICED]
Q2. All elements within safe boundaries? → [YES / NO]
Q3. Content parity across slides? → [CONSISTENT / MISMATCHED]

**FAILURE TRIGGERS:**
- Q1 SLICED or Q2 NO → Apply RULE 2 → FAIL Category A
- Q3 MISMATCHED → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,

      MARQUEE_UPDOWN: `
**MARQUEE_UPDOWN — WIDGET-SPECIFIC CHECKS:**
Q1. All cards fully visible (no partial)? → [ALL VISIBLE / SOME PARTIAL]
Q2. Card width/height consistent? → [CONSISTENT / INCONSISTENT]
Q3. Content parity across scrolling cards? → [CONSISTENT / MISMATCHED]

**FAILURE TRIGGERS:**
- Q1 SOME PARTIAL or Q2 INCONSISTENT → Apply RULE 2 → FAIL Category A
- Q3 MISMATCHED → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,

      MARQUEE_LEFTRIGHT: `
**MARQUEE_LEFTRIGHT — WIDGET-SPECIFIC CHECKS:**
Q1. All cards fully visible (no partial)? → [ALL VISIBLE / SOME PARTIAL]
Q2. Card widths consistent? → [CONSISTENT / INCONSISTENT]
Q3. Content parity across scrolling cards? → [CONSISTENT / MISMATCHED]

**FAILURE TRIGGERS:**
- Q1 SOME PARTIAL or Q2 INCONSISTENT → Apply RULE 2 → FAIL Category A
- Q3 MISMATCHED → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,

      CAROUSEL_SLIDER: `
**CAROUSEL_SLIDER — WIDGET-SPECIFIC CHECKS:**
Q1. **ASYMMETRIC CORNER**: Rightmost card—rounded or 90° chop? → [ROUNDED / CHOPPED]
Q2. All cards fully visible? → [ALL VISIBLE / SOME PARTIAL]
Q3. Card width parity (rightmost vs peers)? → [PASS / NARROW-CLIPPED]
Q4. **DATE FORMAT**: Strict "Month DD, YYYY" in cards? → [VISIBLE / ABSENT]

**FAILURE TRIGGERS:**
- Q1 CHOPPED → Apply RULE 2 → FAIL Category A
- Q2 SOME PARTIAL or Q3 NARROW-CLIPPED → Apply RULE 2 → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,

      CROSS_SLIDER: `
**CROSS_SLIDER — LAYOUT PRE-ANALYSIS (answer before writing JSON):**
Q1. **TYPE CHALLENGE**: In plain English, what do you physically see? → [SINGLE DIAGONAL STRIP / TWO INTERSECTING STRIPS (X-SHAPE)]
Q2. **MOVEMENT AUDIT (CRITICAL)**: Compare "part1.png" vs "part10.png". Does EACH track show different content or positions at different timestamps? → [BOTH MOVE / ONE STATIC / NONE MOVE]
Q3. **COLLINEARITY CHECK**: Do all reviewers (avatars/names) form a single straight diagonal axis? → [STRAIGHT LINE / INTERSECTING X]
Q4. **SLOPE VERIFICATION (PHYSICAL INVENTORY)**: List who is on:
    - Track 1 (DESCENDING slope \): [List NAMES or NONE]
    - Track 2 (ASCENDING slope /): [List NAMES or NONE]
Q5. **FINAL CROSS BAR VERDICT**: If Q1 is "SINGLE DIAGONAL STRIP" or Q3 is "STRAIGHT LINE", the Cross Bar is ABSENT. Do NOT hallucinate an X where only one strip exists.
RULE: If Q1 is "SINGLE DIAGONAL STRIP", then "Show Cross Bar" MUST be "Absent".
- Apply RULE 1 (Sharpness) to all visible images`,

      COMPANY_LOGO_SLIDER: `
**COMPANY_LOGO_SLIDER — WIDGET-SPECIFIC CHECKS:**
Q1. **EXPANSION TRIGGER**: Multiple screenshots show a horizontal logo strip AND a detailed review card? → [YES / NO]
Q2. **EXPANSION LOCATION**: Review card appears directly ABOVE, NEAR, or INLINE with the logo row? → [ABOVE / NEAR / INLINE]
Q3. **REVIEW PARITY**: Does the expanded card contain Stars, Reviewer Name, and Review Text? → [PARITY-PASS / MISSING-DETAILS]
Q4. **SLIDER MOTION**: Logos appear horizontally aligned in a continuous strip? → [PASS / MISALIGNED]

**FAILURE TRIGGERS:**
- Q1 NO (if context shows logo click) → FAIL Category G (Popups & Modals)
- Q3 MISSING-DETAILS → Apply RULE 3 → FAIL Category C
- Q4 MISALIGNED → Apply RULE 2 → FAIL Category A
- Apply RULE 1 (Sharpness) to all logos`,

      GRID: `
**GRID — WIDGET-SPECIFIC CHECKS:**
Q1. Outer rows/columns clipped? → [FULLY VISIBLE / CLIPPED]
Q2. Orphaned/shattered cards in grid? → [SYMMETRICAL / ORPHANED]
Q3. All cards fully visible? → [ALL VISIBLE / SOME PARTIAL]
Q4. Card dimensions consistent? → [CONSISTENT / INCONSISTENT]

**FAILURE TRIGGERS:**
- Q1 CLIPPED → Apply RULE 2 → FAIL Category A
- Q2 ORPHANED → FAIL Category A
- Q3 SOME PARTIAL or Q4 INCONSISTENT → Apply RULE 2 → FAIL Category A
- Apply RULE 1 (Sharpness) to all visible images`,
    };

    const layoutPreAnalysis = widgetLayoutPreAnalysis[widgetType];

    if (!layoutPreAnalysis) {
      throw new Error(
        `[PromptBuilder] No layout pre-analysis defined for widget type: "${widgetType}". ` +
        `Add it to widgetLayoutPreAnalysis before proceeding.`
      );
    }

    // ============================================================
    // AESTHETIC PRE-ANALYSIS (Simplified - References Core Rules)
    // ============================================================
    const aestheticPreAnalysis = `
============================================================
AESTHETIC VALIDATION (Answer before writing JSON)
============================================================

**A. LAYOUT & SPACING**
- Apply RULE 2 (Edge Integrity), RULE 8 (Cascade Failures), and RULE 10 (2x Rule)
Q1. **EXTERNAL SYMMETRY**: Is any side gap > 2x its opposite side? → [BALANCED / ASYMMETRIC-FAIL]
Q2. **INTERNAL GAPS**: Visually balanced spaces between Header, Body, and Footer? → [BALANCED / INCONSISTENT]
Q3. **BOTTOM SQUEEZE**: Is the bottom gap significantly smaller than the top gap? → [PASS / SQUEEZED-FAIL]
Q4. **LEFT INDENTATION**: Is text body indented differently than the element above it? → [ALIGNED / MISINDENTED-FAIL]
Q5. **ALIGNMENT**: Do avatars and text share a consistent vertical axis? → [ALIGNED / MISALIGNED]
Q6. **STUCK ELEMENTS**: Any element looking "stuck" with no air (<8px)? → [NO / STUCK-FAIL]

**B. ELEMENT CONTAINMENT**
- Apply RULE 2 (Edge Integrity) and RULE 10
Q1. Any UI element touching container boundary with zero padding (Rule 10)? → [NO / ZERO-PADDING-FAIL]
Q2. Top-most element squeezed against top edge (<10px)? → [GOOD PADDING / SQUEEZED]
Q3. Text touching left/right card edges? → [NO / YES—TOUCHING]
Q4. Excessive inset (huge empty margin before content)? → [NO / YES—EXCESSIVE]
Q5. Avatar overflowing circular boundary? → [NO / YES]

- **NAME/ROLE TRUNCATION (RULE 3 - IRON LOCK)**:
    - Look ONLY at the first line of NAME and JOB ROLE.
    - Does it end in "..." or an abrupt fade? → [FAIL / PASS]
    - **REVIEW BODY**: Elipsis here is **PASS**.
    - **TRANSCRIPTION**: Transcribe first row of Name for any failing card.
Q3. **READ MORE AUDIT**: Apply RULE 5—literal words "Read More" present?
    - Quote its text and color: → ["[Color] Read More" / "ABSENT-ELLIPSIS-ONLY"]
    - **CRITICAL**: "..." alone is NOT "Read More".
Q4. **DATE AUDIT**: Grey date text visible? Quote format: → ["[Month DD, YYYY]" / "ABSENT"]

- **MANDATORY REVIEWER AUDIT LOG (PER-CARD ANALYSIS)**:
    - You MUST list every unique name found and their sharpness/truncation status.
    - Format: "[Name]: [Initial/Photo] Sharpness Log (Text 1px/Img Xpx) | Truncation (FAIL/PASS)"
    - **CRITICAL**: Apply Rule 1 (>1.1px = FAIL) to EVERY name listed.
Q5. Avatar sizes consistent across cards? → [CONSISTENT / INCONSISTENT]

**E. MEDIA & IMAGES**
- Apply RULE 1 (Sharpness Benchmark) and RULE 9 (Identifiers)
Q1. Broken image icons or gray placeholder boxes? → [NO / YES—specify card]
Q2. Photos/logos stretched/squished (funhouse mirror)? → [NO / YES—describe]
Q3. **SHARPNESS BENCHMARK**: 
    - Compare photo/logo detail to sharpest text
    - Image soft/grainy compared to text? → [Passing - SHARP / Failing - BLURRY]
    - **If no images**: → "Passing - SHARP (N/A)"
Q4. All media fully visible within container? → [FULLY VISIBLE / PARTIALLY HIDDEN]

**F. THEME & COLOR VISIBILITY**
- Apply RULE 4 (Ghost Cards)
Q1. Low contrast text (dark-on-dark or light-on-light)? → [NO / YES—describe]
Q2. Theme consistency (preview vs popup)? → [SAME THEME / MISMATCHED / NO POPUP]
Q3. Interactive elements (buttons/links/arrows) clearly visible? → [YES / NO]

**G. POPUPS & MODALS**
- Apply RULE 7 (Popup Validation)

**CRITICAL PRE-CHECK (Answer FIRST):**
STEP 1: **POPUP EXISTENCE & FOOTER AUDIT**
- Can you see ANY card overlaid on the widget (Skeleton bars, whole text, or just a footer)? → [YES / NO]
- **MANDATORY TRANSCRIPTION**: If YES, you MUST quote the following from the pixels:
    - Current Date in footer: → ["Text" / "ABSENT"]
    - "Read More" link: → ["Text" / "ABSENT"]
- **STRICT LOGIC BRIDGE**: If you identified "ACTUAL_BAR_FAILURE" in Q1, or if you can see a Date/Read More, you are **PROHIBITED** from saying NO here. The answer is **MANDATORY YES**.
- If NO (Truly no popup in ANY screenshot): Mark Category G PASS (N/A), skip to next category.

STEP 2: If YES—**BOTTOM EDGE TRUNCATION TEST**:
- Is "Review Card Border" or "Shadow" enabled in config? → [YES / NO]
- If NO (Borderless): Is any character of the date or body text actually sliced/half-cut? → [YES-FAIL / NO-PASS]
- If YES (Bordered): Can you see complete rounded bottom border with padding below? → [YES-PASS / NO-FAIL]
- Visual verdict: → [✓ PASS: Clean content/border / ✗ FAIL: Sliced content/missing border]

STEP 3: If STEP 2 passed—Additional checks:
Q1. Popup fully visible at ALL edges? → [FULLY VISIBLE / SLICED—specify which edge]
Q2. **POPUP SYMMETRY**: Does the popup card have balanced padding on all 4 sides? → [BALANCED / UNBALANCED-FAIL]
Q3. **BOTTOM SQUEEZE**: Is there sufficient breathing room (>10px) between the last text and the bottom border? → [ROOM / SQUEEZED-FAIL—specify card]
Q4. **LEFT ALIGNMENT**: Is the review body indented differently than the name/avatar above? → [ALIGNED / MISINDENTED-FAIL—specify card]
Q5. All text inside fully readable (no half-cut lines)? → [FULLY READABLE / HALF-CUT]
Q6. **INTERNAL GAPS**: Are sections (Avatar, Name, Body, Date) logically spaced? → [PASS / CRIMPED]

**FAILURE RULES:**
- STEP 2 FAIL → Immediate FAIL (CRITICAL)
- Q1 SLICED or Q3 HALF-CUT → FAIL (CRITICAL)
- Q2 UNBALANCED or Q4 NO-TOUCHING → FAIL (HIGH)
- Q5 CRIMPED → FAIL (MEDIUM)
`;

    // ============================================================
    // WIDGET-SPECIFIC SCANNING RULES (Consolidated)
    // ============================================================
    const widgetScanningRules = `
============================================================
WIDGET-SPECIFIC FEATURE DETECTION RULES
============================================================

**AVATAR_GROUP:**
- **STAR RATING AUDIT**: Scan for yellow/gold star icons (★) in TWO places:
  1. Main widget area (Aggregate): Below "Loved & Trusted..." text.
  2. Inside Popups (Individual): Near the green/red platform badge.
- If ANY star is visible → "Show Star Ratings" = Visible.
- **Show Platform Icon**: Logo in TOP RIGHT of popup, inline with reviewer name.
- **Read More**: Apply RULE 5—if config show_full_review=0, look for link in popup text
- **Review Date**: Bottom-left of popup ("Jan 25, 2025" or "2024")
- **Inline CTA**: Styled button with arrow (↗) at bottom of popup

**AVATAR_CAROUSEL:**
- Analyze BOTH avatar row AND expanded popup
- **Left & Right Shift Buttons**: Circular arrows (← →) at absolute bottom of widget
- **Show Review Date**: Inside popup—MUST quote exact "Month DD, YYYY" format
- **Inline CTA**: Styled button (often with ↗) inside popup
- **ANTI-CHEAT**: Do NOT invent relative dates like "5 months ago"

**CAROUSEL_SLIDER:**
- Scan ALL individual review cards
- **Left & Right Buttons**: Arrow controls (< >) on left/right widget edges
- **Slider Indicators**: Dots/lines at absolute bottom
- **Show Social Platform Icon**: Logo/icon/text in TOP RIGHT of each card
- **Show Review Ratings**: Star icons inside EACH card, below reviewer name
- **Read More**: Apply RULE 5—at bottom of text in each card
- **Inline CTA**: Styled button with arrow (↗) at bottom of card
- **Review Date**: Strict "Month DD, YYYY" format in bottom-left
- **VIDEO EXCEPTION**: Cards with Play button may lack Social Icons

**SINGLE_SLIDER:**
- Multiple screenshots show different reviews (avatar click reveals)
- Review content appears ABOVE avatar row
- **Show Social Platform Icon**: Logo to the RIGHT of reviewer name
- **Show Review Ratings**: Stars in review area above avatars
- **Read More**: Apply RULE 5

**FLOATING_TOAST:**
- Small preview + large expanded modal
- **Small card**: Check Social Icon (top-right) and stars
- **Expanded modal**: Check Read More, Date, Inline CTA
- **Inline CTA**: Styled button with arrow (↗) at bottom of expanded review

**MARQUEE_STRIPE:**
- **EAGLE EYE REQUIRED**: Tiny icons (~10px) as character suffix after names
- **ALGORITHM**:
  1. Find reviewer NAME string
  2. Look IMMEDIATELY after last character
  3. Tiny letter/badge/logo there → Social Icon Visible
  4. Also check TOP RIGHT of popup for colored logo
- **Show Review Ratings**: Gold/yellow/green stars inside cards AND popups
- **Show Review Date**: Small grey footer text
- **Read More**: Apply RULE 5
- **Inline CTA**: Large styled button at popup bottom with MANDATORY arrow (↗)

**CROSS_SLIDER:**
- Analyze BOTH cross slider view AND expanded popup
- **Show Cross Bar (HARDENED RULE)**:
  1. **MOVEMENT MANDATE**: You are PROHIBITED from marking "Visible" unless you can prove BOTH tracks are moving and carrying different reviews over time (part1 vs part10).
  2. **GEOMETRY TRAP**: A single black diagonal strip is NOT an "X". If all reviews follow the same slope (e.g., all are \), it is a SINGLE SLIDER, not a Cross Bar.
  3. **INVENTORY VERDICT**: If your pre-analysis Q2 shows a static track or Q3 shows a straight line → Result: ABSENT.
- **[Element: Tilted Cross Slider] Alignment**: The intentional tilt is **CORRECT**.
- **Show Review Date**: Inside popup—strict "Month DD, YYYY"
- **Inline CTA**: Inside popup—button/link (arrow ↗ NOT required)
- **IMPORTANT**: Minority anti-aliasing on the diagonals is NORMAL. Only mark "Absent" if text is completely unreadable.


**COMPANY_LOGO_SLIDER:**
- **SPECTRUM ANCHOR**: Compare logos to Feedspace branding/buttons for color reference
- **GRAY MODE**: If logos are grayscale while reference is vibrant → mark "Displays Gray mode" Visible
- **EXPANSION AUDIT (CRITICAL)**: Look at the white card (popup) that appears after clicking a logo.
- **DATE SCAN**: Scan the area BELOW the reviewer's stars/name and ABOVE the 'Capture reviews with Feedspace' footer.
- **LITERAL DATE**: Look for "Month DD, YYYY" (e.g., "October 16, 2024"). If you see it, you MUST report "Visible" for "Show Review Date".
- **SINGLE-HIT RULE**: Verify if a date is present in any 'partX' screenshot showing an expansion.
- **Popup**: White card over logo strip—scan for date below media, above CTA

**MARQUEE (Horizontal):**
- Multiple cards scrolling left-right, possibly multi-row
- Scan EVERY card individually
- **Show Social Platform Icon**: Logo in TOP RIGHT of each card
- **Show Review Ratings**: Stars in each card, below reviewer name
- **Show Review Date**: Any date text in any card
- **Read More**: Apply RULE 5

**MARQUEE (Vertical):**
- Cards scrolling up-down
- Scan EVERY visible card
- **Show Social Platform Icon**: Logo in TOP RIGHT of each card
- **Show Review Ratings**: Stars in each card, below reviewer name
- **Show Review Date**: Any date text in any card
- **Read More**: Apply RULE 5
- **Left & Right Buttons**: Mark ABSENT (not used in vertical)

**MASONRY:**
- Multi-column brick layout
- **Read More**: Apply RULE 5—literal "Read More" after text, before date
- **EAGLE EYE**: If "..." present, zoom in between text end and date
- **Show Social Platform Icon**: Logo in TOP RIGHT of each card
- **Show Review Ratings**: Stars inside each card
- **Show Review Date**: Footer text in any card
- **Show Load More Button**: Large button at absolute bottom center
- **Inline CTA**: Scan for distinct non-review cards with a large primary-colored button (e.g., "Get Started" or "Join Now").
`;

    // ============================================================
    // FINAL VALIDATION CHECKLIST
    // ============================================================
    const finalChecks = `
============================================================
FINAL VALIDATION CHECKLIST (Before Writing JSON)
============================================================
☑ Applied Core Rules 1-9 to all visible elements
☑ Answered widget-specific pre-analysis questions
☑ Answered ALL aesthetic pre-analysis questions (A through G)
☑ Verified spacing symmetry per Rule 10 (2x Rule)
☑ Verified NO Bottom-Squeeze or Left-Indentation issues (RULE 10)
☑ Verified popup completeness (if applicable)—RULE 7
☑ Checked for cascade failures (RULE 8): A→C, A→E
☑ Distinguished "Show Star Ratings" vs "Show Review Ratings" (RULE 6)
☑ Included [Card: Name] identifier in EVERY failure (RULE 9)
☑ Applied "SHARP_PASS_FORCE" if no images present
☑ Verified "Read More" per RULE 5 (literal text, not just "...")
☑ Checked date format: strict "Month DD, YYYY" where required
☑ Applied edge integrity checks (RULE 2) to all cards
☑ Applied 2-Line Rule (RULE 3) to truncated text
☑ Applied Ghost Card detection (RULE 4) to all text

**ANTI-HALLUCINATION CHECKPOINT:**
- Did I mark ANY feature "Visible" without seeing it in pixels? → [YES = FAIL / NO = PROCEED]
- Did I assume features based on config expectations? → [YES = FAIL / NO = PROCEED]
- Did I provide specific evidence for EVERY "Visible" claim? → [NO = FAIL / YES = PROCEED]
`;

    // ============================================================
    // REPORTING LOGIC
    // ============================================================
    const reportingLogic = `
============================================================
REPORTING LOGIC & JSON OUTPUT
============================================================

**STATUS DETERMINATION:**
- (UI: Visible) + (Config: Visible) => PASS
- (UI: Visible) + (Config: Absent) => FAIL (Unintended Feature)
- (UI: Absent) + (Config: Visible) => FAIL
- (UI: Absent) + (Config: Absent) => PASS

**MISSING CONFIG RULE:**
If a config key is MISSING/UNDEFINED → assume expected state is "Absent"
If you see it in pixels → report "Visible" and flag as FAIL

**AESTHETIC REPORTING:**
- Evaluate ALL 7 categories (A through G)
- Return exactly 7 objects in aesthetic_results array
- Aesthetic failures are ABSOLUTE (defect in ANY screenshot = FAIL)
- **LOGIC MAPPING (MANDATORY)**: If your pre-analysis answer includes keywords like "FAIL", "ASYMMETRIC", "CRAMPED", "SQUEEZED", "STUCK", "MISALIGNED", "INCONSISTENT", "BLURRY", "FUZZY", "SOFT", "DISTORTED", or "SCALING_ARTIFACT" → You MUST mark the final Category Status as **FAIL**. No exceptions.
- Multi-fault cascade (RULE 8): Fail ALL affected categories

**ISSUE FIELD FORMAT:**
- If failure detected: "[Card/Element: Identifier] shows [problem] causing [impact]"
- Examples:
  - "[Card: Suzanne B] - Review text cut off at bottom causing incomplete readability"
  - "[Card: Beverley] - Avatar distorted (oval shape) causing visual inconsistency"
  - "[Card: Global Popup] - Right edge chopped at 90° causing layout failure"
- If no issues: "No visual defects detected"

**SEVERITY LEVELS:**
- CRITICAL: Renders widget unusable (clipping, invisible text, broken images)
- HIGH: Major visual defect (distortion, misalignment, missing features)
- MEDIUM: Minor aesthetic issue (spacing imbalance, slight overflow)
- LOW: Cosmetic imperfection
- N/A: Category not applicable or passed

**MANDATORY EVIDENCE:**
- EVERY "Visible" claim needs location/description
- EVERY failure needs [Card: Name] identifier
- NO generic "The image" or "The text" without context
`;

    // ============================================================
    // FINAL PROMPT ASSEMBLY
    // ============================================================
    return `
${automationFeedback}
${coreRules}
${universalMandates}

============================================================
# ROLE: QA AUTOMATION AI ENVIRONMENT
============================================================
You are a highly sensitive QA Automation AI specialized in visual validation.
Your objective: Analyze UI screenshot(s) of a **${widgetType}** widget and verify feature visibility against configuration.

**GLOBAL INSTRUCTION**: When uncertain between PASS/FAIL → choose FAIL (zero tolerance policy)

============================================================
CONFIGURATION REQUIREMENTS
============================================================
**COGNITIVE BIAS WARNING**: You will see "Config Status" (system expectations).
**STRICT PIXEL MANDATE**: You are a PIXEL OBSERVER, not a config validator.
- If Config says "Absent" but Pixels show it → Report "Visible" (FAIL).
- If Config says "Visible" but Pixels don't show it → Report "Absent" (FAIL).
- NEVER guess "Absent" just to make the test pass.

${instructions}

============================================================
WIDGET-SPECIFIC PRE-ANALYSIS
============================================================
**ANSWER THESE QUESTIONS BEFORE WRITING JSON:**
(Do NOT copy questions into JSON—only carry conclusions into "issue" fields)

${layoutPreAnalysis}

============================================================
AESTHETIC PRE-ANALYSIS
============================================================
**ANSWER ALL QUESTIONS BEFORE WRITING JSON:**
(Do NOT copy questions into JSON—only carry conclusions into "issue" fields)

${aestheticPreAnalysis}

${widgetScanningRules}

${finalChecks}

${reportingLogic}

============================================================
JSON OUTPUT FORMAT
============================================================
Provide mandatory audit trace (chain of thought) as text preamble, then return RAW JSON:

{
  "feature_results": [
    {
      "feature": "[Feature Name]",
      "ui_status": "Visible/Absent/Issue Detected",
      "config_status": "Visible/Absent/N/A",
      "issue": "[Format: '[Element: Identifier] shows [problem] causing [impact]' OR 'No visual defects detected']",
      "remarks": "[Diagnostic summary with identifier]",
      "status": "PASS/FAIL"
    }
  ],
  "aesthetic_results": [
    {
      "category": "A. LAYOUT & SPACING",
      "issue": "[Format: '[Element: Identifier] shows [problem] causing [impact]' OR 'No visual defects detected']",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "B. ELEMENT CONTAINMENT",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "C. CONTENT & TEXT RENDERING",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "D. AVATAR RENDERING",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "E. MEDIA & IMAGES",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "F. THEME & COLOR VISIBILITY",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    },
    {
      "category": "G. POPUPS & MODALS",
      "issue": "[Required format as above]",
      "severity": "CRITICAL/HIGH/MEDIUM/LOW/N/A",
      "status": "PASS/FAIL"
    }
  ],
  "overall_status": "PASS if ALL features PASS and NO Aesthetic issues, else FAIL"
}
`;
  }
}

module.exports = PromptBuilder;