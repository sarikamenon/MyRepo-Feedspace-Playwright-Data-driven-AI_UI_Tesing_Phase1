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
      "Feedspace Branding": "hideBranding",
      "Review Card Border & Shadow": ["is_show_border", "is_show_shadow"],
      "Show Star Ratings": "show_star_ratings",
      "Widget position": "widget_position",
      "Show Load More Button": "enable_load_more",
      "Displays Gray mode": "enable_grey_mode",
      "Review Image / Avatar": "allow_to_display_feed_image"
    };

    const invertedFeatures = {
      "Read More": true,
      "Feedspace Branding": true
    };

    const featuresToTest = (staticFeatures && staticFeatures.length > 0)
      ? staticFeatures
      : (config.features || Object.keys(featureMap).filter(featureName => {
        const configKey = featureMap[featureName];
        if (!configKey) return false;
        const keys = Array.isArray(configKey) ? configKey : [configKey];
        const lookupContexts = [config, config.widget_customization, config.data].filter(Boolean);
        return keys.some(key => lookupContexts.some(ctx => key in ctx));
      }));

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

        // --- DATA-AWARE OVERRIDE (GRANULAR RATING LOGIC) ---
        if (expected === "Visible") {
          const rawFeeds = config.feeds_data || config.data?.feeds_data || [];
          if (rawFeeds.length > 0) {
            if (featureName === "Show Review Ratings") {
              const allQualifyForAbsent = rawFeeds.every(f => {
                const hasNoRating = (f.rating === null || f.rating === 0 || f.rating === "0");
                return hasNoRating;
              });

              if (allQualifyForAbsent) {
                expected = "Absent (Data-Driven / Social Exception)";
              }
            } else if (featureName === "Show Social Platform Icon") {
              const anySocial = rawFeeds.some(f => f.feed_type === "social_feed" || f.social_platform);
              if (!anySocial) expected = "Absent (Data-Driven)";
            }
          }
        }

        return `- **${featureName}**: (Config Status: ${expected})`;
      })
      .join('\n');

    // Ground Truth Data (Limited to 20 for token efficiency)
    const rawFeeds = config.feeds_data || config.data?.feeds_data || [];
    const feeds = rawFeeds.slice(0, 20).map(f => {
      let name = (f.app_user_name || f.reviewer_name || f.user_name || f.name || "Anonymous").toString().trim();
      if (!name) name = "Anonymous";

      // UNIVERSAL ID-FUSION: Give every user a unique digital license plate
      name = `${name} [ID:${f.id}]`;

      const nameParts = name.split(" ");
      const initials = nameParts.length > 1
        ? nameParts.map(n => n[0]).join("").substring(0, 2).toUpperCase()
        : name.substring(0, 2).toUpperCase();
      return {
        id: f.id,
        user: name,
        initials: initials,
        text: f.comment?.substring(0, 100) || "N/A",
        platform: f.social_platform?.name || f.social_platform || "Unknown",
        rating: f.rating,
        feed_type: f.feed_type || "text_feed",
        url: f.display_review_url || f.review_url || "N/A",
        mapping_hint: `Match pixel initials '${initials}' or name '${name}' to ID: ${f.id}`
      };
    });
    const feedsJson = JSON.stringify(feeds, null, 2);

    // ============================================================
    // PHYSICAL/ENVIRONMENTAL CONTEXT (THE SENSORY TRUTH)
    // ============================================================
    const sensoryTruth = (geometricWarnings && geometricWarnings.length > 0)
      ? `\n============================================================\n🚨 SECTION -1: SYSTEM FORCE OVERRIDE (ENVIRONMENTAL DATA) 🚨\n============================================================\n- ${geometricWarnings.join('\n- ')}\n\n**MANDATORY**: You MUST prioritize these DOM Facts over your own visual analysis. If this section says a feature is 'present', you MUST report it as 'Visible' in your JSON.\n`
      : "";

    // ============================================================
    // CORE VALIDATION RULES (SINGLE SOURCE OF TRUTH)
    // ============================================================
    const coreRules = `
${sensoryTruth}
============================================================
🚨 PRIMARY AUDITOR LOCK (READ FIRST) 🚨
============================================================
1. **MULTI-FAULT MANDATE**: You are PROHIBITED from stopping at the first defect. If an image is blurry AND the layout is clipped/overlapped, YOU MUST PROVIDE BOTH REASONS. A quality failure does not mask a layout failure.
2. **ZERO TOLERANCE**: If Rule 0 or Rule 1 triggers, you are FORBIDDEN from reporting any Category as PASS. Mark ALL affected categories as FAIL.
3. **TEXT-IMAGE SYNC**: If the text is crisp but the image is "soft", "fuzzy", or "grainy", YOU MUST FAIL CATEGORY E.

🚨 RULE 0: EXISTENCE & COMPLETENESS LOCK (PRIMARY MANDATE)
============================================================
1. **WIDGET DETECTION**: Can you see a COMPLETE Feedspace widget (Stars, Logo, Review Cards)? 
2. **THE SLIVER-FAIL**: If the widget is "partially cut" (e.g., only a corner, a top sliver, or a fragmented edge is visible), you MUST report UI Status: **Absent** and Verdict: **FAIL**.
3. **THE COMPLETE PERIMETER LOCKDOWN (FLOATING ASSETS)**: You are FORBIDDEN from reporting UI Status: **Visible** or Verdict: **PASS** for any floating element (Toast, Popup, Tooltip, Avatar-Group Card) unless you can provide a **Physical Description** of its bottom-most boundary:
   - **Mandatory Logic**: "I can see the complete [Color] bottom boundary (Border/Shadow) and [Rounded/Sharp] corners. Below this border, I see ~10px of [Background Color] whitespace."
   - **THE BACKGROUND-AIR TEST**: If the card border is the very last thing in the image (no whitespace below it), or if it 'bleeds' into the page edge, you MUST trigger **FAIL_LAYOUT_CLIPPED**.
4. **RULE 19: THE PERIMETER CLEARANCE MANDATE (Text & Ratings)**: Specifically audit the last visible line of content on every review card (Descenders OR Stars).
   - **THE GUTTER CHECK**: You MUST zoom your attention to the **BOTTOM EDGE** of the card content.
   - **RASTER PROOF (AUTO-FAIL)**: You are FORBIDDEN from reporting a PASS for layout unless you can state the **Pixel Gutter Count** (e.g., "There are ~8px of white space below the stars").
   - **ZERO-GAP FAIL**: If a letter tail OR a Star point is touching the card border, or if there is < 4px of 'air' below it, you MUST report **SQUEEZED-FAIL** and token **FAIL_LAYOUT_CLIPPED**.
   - **PRE-ANALYSIS MANDATE**: If you identify **ACTUAL_SQUEEZE_DETECTED** in your step-by-step thinking (Pre-Analysis), you are PROHIBITED from reporting a PASS for Category A.
   - **THE SLICE-FAIL**: If the "tails" of these letters are flat, missing, or truncated horizontally, it is a clinical **FAIL_TEXT_TRUNCATED**. 
   - **TRANSCRIPTION TEST (EXPANDED POPUPS)**: For expanded popups, you MUST compare the last word in the screenshot to the last word in the Ground Truth JSON (SECTION 0). 
   - **DOT-FAIL MANDATE**: If a word ends in multiple dots (e.g., "kn...", "know..", or "...."), it is a clinical **FAIL_TEXT_TRUNCATED**. 
   - **WORD-SYNC**: If JSON ends with "know" but screenshot says "kn..." or has an ellipsis not in the source, trigger **FAIL_TEXT_TRUNCATED**.
5. **LIQUID VIEWPORT SCAN**: Specifically check the BOTTOM and RIGHT edges. If a card ends in a sharp, non-rounded vertical line (rectilinear cut), it is a clinical **FAIL_LAYOUT_CLIPPED**.
6. **CORNER SYMMETRY AUDIT**: You must verify that the Top-Right and Bottom-Right corners mirror their Left-Hand counterparts. If the left side is rounded but the right side is sharp, it is a clinical **FAIL**.
7. **FOREIGN POPUP BLOCKAGE**: If a Cookie Consent, Chat Bubble, or Modal is overlapping/blocking the widget, you MUST report **FAIL** and use the token **FAIL_LAYOUT_BLOCKED**.

🚨 RULE 1: THE FORENSIC DETAIL MANDATE (ZERO TOLERANCE)
============================================================
- **THE MICRO-TEXTURE HANDSHAKE**: You are PROHIBITED from reporting a PASS for sharpness unless you can prove **1px Micro-Texture Presence**.
- **Digital Benchmark**: The Name/Role text has razor-sharp 1px edges.
- **Forensic Proof**: Look for the thinnest possible detail in the image (eyelashes, individual hair strands, 1px logo grain).
- **THE "SMOOTHNESS" FAIL**: If an image looks "smooth", "clean", or "creamy" but lacks 1px-thin textures, it is defined as **INTERPOLATION BLUR**. Smoothness is a defect.
- **DIFFERENTIAL SHARPNESS AUDIT (COMPARISON REFERENCE MANDATE)**:
    - You MUST compare a target photo (e.g., "Jennifer W." avatar) to a reference vector (e.g., the name "Jennifer W.").
    - **Logic**: "The text 'Jennifer W.' has razor edges @ 1px, but the avatar photo has muddy edges @ 3-5px."
    - **Trigger**: If the disparity is > 1px in edge-width, you MUST report **FAIL_HYBRID_SHARPNESS**.
    - **Prohibited Phrase**: You are BANNED from saying "Appears sharp" unless you name the reference element you used to prove it.
- **SYSTEM VERDICT**: Any image that is even 0.5px softer than the vector text is a clinical defect. You MUST use tokens **FAIL_SHARP_AVATAR** or **FAIL_SHARP_MEDIA**.

============================================================
🚨 SECTION 0: SUPREME DATA AUTHORITY (NON-NEGOTIABLE) 🚨
============================================================
**GROUND TRUTH DATA (MANDATORY)**:
${feedsJson}

============================================================
🚨 RULE 18: THE CLINICAL SYMMETRY LOCK (MIRROR TEST)
============================================================
- **HORIZONTAL PARITY**: You MUST compare the left-hand padding/rounding to the right-hand padding/rounding.
- **THE RECTIPHOBIA MANDATE**: If a card has a "Straight Edge Cut" on the right (looks like it's bleeding off the screen or container) while the left edge has a rounded corner, it is a clinical **FAIL_LAYOUT_ASYMMETRIC**.
- **SYMMETRY PROOF**: State: "The Left edge has [X] rounding, but the Right edge is a sharp [Y]-degree cut."
- **WIDGET-LEVEL CENTER**: Is the widget centered in its own container, or is it shoved against a boundary?

============================================================
🚨 RULE 16: SCOPED VISION MANDATE (BEIGE CARDS ONLY) 🚨
============================================================
- **BOUNDARY**: You are auditing the **Beige Rectangular Review Cards** AND any **Promotional/CTA Cards** injected into the grid.
- **PROHIBITION**: You are FORBIDDEN from reporting on, or using as evidence, any elements (like yellow stars or logos) that appear on the background website page OUTSIDE of these card boundaries.
- **TARGET**: Focus on what is rendered INSIDE the card boundaries (ID, Reviewer, Icons, OR Promotion labels like "Get Started").

${isMultiImage ? `
============================================================
🚨 RULE 17: STORYBOARD AUDIT (INITIAL vs EXPANDED) 🚨
============================================================
- **IMAGE 1 (INITIAL)**: This is the widget's state BEFORE any interactions. Use this to verify the presence of the "Load More" button if configured.
- **IMAGE 2+ (EXPANDED)**: These represent the widget AFTER pagination/interactions. Use these to verify the arrival of new cards and the final visibility of features.
- **MANDATE**: If "Show Load More Button" is expected, it MUST be visible in IMAGE 1. If it vanishes in IMAGE 2 because all content was loaded, this is a PASS.
` : ''}


============================================================
🚨 THE PASS/FAIL DECISION TREE (IRON LOCK) 🚨
============================================================
1. **IDENTIFY CARD**: Match the card in the screenshot to a record in **SECTION 0** using **Name**, **ID**, **Text snippet**, or **Initials** (e.g., 'AN' = 'Anonymous').
2. **VERIFY FIELD (RATING/ICON)**:
    - **IF (\`rating\` > 0 in Section 0)** → **Expected State: VISIBLE**. (Fail if absent).
    - **IF (\`rating\`: null or 0 in Section 0)**:
        - **IF (\`feed_type\`: "social_feed")** → **Expected State: ABSENT**.
        - **VERDICT: PASS**. 
        - **REMARK**: "[Card: INSERT_NAME] Review ratings are not present as the rating in the data is null or 0 for this social source (Proof: SECTION 0 - ID:REAL_ID_HERE, Platform:REAL_PLATFORM_HERE)"
        - **IF (\`feed_type\`: "text_feed" AND \`rating\` = 0)** → **Expected State: ABSENT**.
        - **VERDICT: PASS**.
        - **IF (\`feed_type\`: "text_feed" AND \`rating\` = null)** → **Expected State: ABSENT**.
        - **VERDICT: PASS**.
        - **REMARK**: "[Card: INSERT_NAME] Review ratings are not present as the rating in the data is null for this text source (Proof: SECTION 0 - ID:REAL_ID_HERE, Platform:REAL_PLATFORM_HERE)"
0. **RULE 0: IDENTIFY SKELETONS vs VIDEOS**: 
    - **SKELETON BARS**: These are elongated, horizontal, pulsating bars (often light gray) that mimic text lines.
    - **VIDEO PLACEHOLDERS**: A solid gray, brown, or black rectangular box with a centered "Play" triangle icon is a **Video Placeholder**, NOT a skeleton bar. Do NOT trigger skeleton pass logic for these.
1. **REMARKS MANDATE & IDENTIFICATION**: 
    - You MUST identify the card you are auditing by Name (e.g., "[Card: Hayden Arnold]").
    - If a rating/icon is absent because Section 0 data is null/0, you MUST provide a remark following this pattern: "[Card: INSERT_NAME] Review ratings are not present as the rating in the data is null or 0 (Proof: SECTION 0 - ID:REAL_ID_HERE, Platform:REAL_PLATFORM_HERE)".
4. **SHARPNESS BENCHMARK**: Look at anti-aliasing. If text is sharp, diagonal text or icons may have minor smoothing. This is **PASS**.
5. **STATUS LOCK (ABSOLUTE)**: If you use the remark "Review ratings are not present as the rating in the data is null or 0" or "Social platform icon is not present as the data is null", you MUST mark the status as **PASS**.
6. **PROOF-ID MANDATE (CRITICAL)**: You are FORBIDDEN from outputting literal "XXXX", "YYYY", or "N/A" if a matching record exists in SECTION 0. You MUST find the actual \`id\` and \`platform\`.
   - **Identity Mapping Log**: Your reasoning MUST begin with a map: "Pixel [AN] -> ID:33769".
   - **System Failure**: Using placeholders will result in an immediate rejection.

============================================================
🚨 SYSTEM MANDATE (NON-NEGOTIABLE) 🚨
============================================================
1. **TEXT-IMAGE SYNC**: If the text is crisp but the image is "soft", "fuzzy", or "grainy", YOU MUST FAIL CATEGORY E.
2. **MANDATORY VERDICT**: ONLY mark "FUZZY-FAIL" or "BLURRY-FAIL" if letter shapes are shattered, ghosted, or impossible to read.

============================================================
🚨 MANDATORY RESPONSE MANDATE: ABSOLUTE AUDITOR
============================================================
- You are a **PIXEL AUDITOR**, not a reviewer.
- You MUST scan **EVERY screenshot** for **DIFFERENT reviewers**.
- **MANDATORY AUDIT LOG**: Your \`analysis_message\` MUST include a line/table for **EVERY unique reviewer** found.
- **FAILURE PROPAGATION**: If ANY single reviewer fails a rule, the entire Category MUST be marked **FAIL**.
- **MULTI-FAULT MANDATE**: You are PROHIBITED from stopping at the first defect. If an image is blurry AND the layout is clipped/overlapped, YOU MUST PROVIDE BOTH REASONS. A quality failure does not mask a layout failure.

============================================================
🚨 CORE VALIDATION RULES (IRON LOCK) 🚨
============================================================

**RULE 1: THE FORENSIC DETAIL MANDATE (ZERO TOLERANCE)**
- **THE MICRO-TEXTURE HANDSHAKE**: You are PROHIBITED from reporting a PASS for sharpness unless you can prove **1px Micro-Texture Presence**.
    - **Digital Benchmark**: The Name/Role text has razor-sharp 1px edges.
    - **Forensic Proof**: Look for the thinnest possible detail in the image (eyelashes, individual hair strands, 1px logo grain).
    - **THE "SMOOTHNESS" FAIL**: If an image looks "smooth", "clean", or "creamy" but lacks 1px-thin textures, it is defined as **INTERPOLATION BLUR**. Smoothness is a defect.
- **THE CLOUD-TRIGGER**: If an image matches the **LEFT SIDE** of the benchmark samples (Watercolor/Cloud effect), it is an absolute FAIL.
- **SYSTEM VERDICT**: Any image that is even 0.5px softer than the vector text is a clinical defect. You MUST use tokens **FAIL_SHARP_AVATAR** or **FAIL_SHARP_MEDIA**.
- **HALLUCINATION BLOCK**: Do not "repair" the image in your mind. If you cannot see razor-sharp grain matching the 'l' in the name, it is a FAIL.
- **Triggers**: Categories D (Avatar Rendering) and E (Media & Images)

**RULE 2: EDGE INTEGRITY (Card Clipping & Containment)**
- ALL cards must show complete boundaries (all 4 edges visible).
- **THE SLIVER-AUDIT**: If the widget is clipped at the viewport edge (only a sliver visible), mark as **FAIL_LAYOUT_CLIPPED**.
- Rounded corners must be fully visible (no 90° sharp chops).
- **"Flat wall"** (0px padding at container edge) → FAIL using token **FAIL_LAYOUT_FLAT_WALL**.
- Rightmost/leftmost card narrower than peers → FAIL "Card width parity".
- Content must NOT touch container edges (minimum 10px padding).
- **TEXT-GRAPHIC COLLISION (ZERO TOLERANCE)**:
    - If ANY character (Name, Role, or Body) overlaps the avatar/logo boundary → **FAIL** using token **FAIL_CONTAINMENT_COLLISION**.
    - Look for "Character Slicing": If a letter sits on top of the image color, it is a defect.
- **BLEEDING DETECTION (ZERO TOLERANCE)**:
    - If ANY element (Stars, Footer, Avatar) touches or overlaps the container border line, it is defined as **BLEEDING**.
    - Trigger: **FAIL_LAYOUT_CLIPPED**.
- **Triggers**: Categories A (Layout), B (Containment), G (Popups).

**RULE 3: FIRST-LINE TRUNCATION (NAME & ROLE ONLY)**
- **Audit Domain**: **Reviewer Name** and **Job Role** (Designation) fields only.
- **REVIEW BODY POLICY**: 
    - **GRID/MARQUEE**: Truncation in the **Review Body** is a **PASS** (expected behavior).
    - **EXPANDED POPUPS/MODALS (Avatar Group, Toast, Carousel Popup)**: Any truncation in the review body is a clinical **FAIL**. If the text is mid-sentence or mid-word, it is a FAIL.
- **FAIL CRITERIA**: FAIL ONLY if the ellipsis ("...") appears on the **FIRST line** of the **NAME** or **JOB ROLE**.
- **MANDATORY TRIGGER**: If failing, use the exact token **FAIL_CONTENT_TRUNCATED**.
- **FAIL**: Characters cut off or sliced in the middle.
- **JSON LEAKAGE**: FAIL [Category C] if the review body contains JSON-like structures (e.g., '{"pros":...', 'null', '{"cons":...') instead of natural language. Use token **FAIL_CONTENT_JSON_LEAK**.
- **LITERAL NAME TRANSCRIPTION**: For Category C, you MUST transcribe the first line of the **NAME** to prove truncation.
- **Triggers**: Category C (Content & Text Rendering).

**RULE 4: GHOST CARDS (Invisible/Illegible Text)**
- White-on-white text → FAIL
- Text rendered as solid bar/blob (no distinct characters) → FAIL
- Text color matching background → FAIL
- **Triggers**: Categories C (Content) and F (Theme & Color)

**RULE 5: READ MORE / DATE SEARCH (LITERAL-EYE MANDATE)**
- **TWO-PASS MANDATE**: You MUST perform two separate visual passes:
    1.  **PASS 1 (Body)**: Audit the review text/body for defects.
    2.  **PASS 2 (Footer)**: Zoom your attention specifically to the **BOTTOM-LEFT CORNER** of the card.
- **LITERAL TRUTH ABOVE CONFIG**: If you cannot see the literal glyphs "Read" and "more", it is **ABSENT**. You are PROHIBITED from reporting "Visible" based on an ellipsis ("...") or because the config expects it.
- **PASS CRITERIA**: ONLY report "Visible" if the literal words "Read more" or "Show More" are transcribed from the pixels.
- **"..." IS NOT READ MORE**: An ellipsis \`...\` alone is an **ABSENT** state for this feature.
- **MANDATORY**: Quote the text and color (e.g., "Blue Read More") to verify visibility.


**RULE 6: FEATURE DISTINCTION (Critical)**
- **"Show Star Ratings"** = AGGREGATE score (e.g., "4.8/5", "5 stars") appearing OUTSIDE individual cards.
- **"Show Review Ratings"** = INDIVIDUAL stars/ratings INSIDE each card.
- **"Inline CTA"** = A specific card in the grid (often white or themed) containing promotional text like **"Ready to get started?"** and a primary button (e.g., **"Get Started"**).
- **Never conflate these features**.

**RULE 7: POPUP VALIDATION (DESIGN-AWARE)**
- **BORDERED STATE** (Border/Shadow enabled): Must see complete rounded border closure with visible padding (min 10px).
- **BORDERLESS STATE** (Border/Shadow disabled): "Flat wall" appearance (where card touches edge) is **PASS**.
- **THE SLICING PROOF (IRON LOCK)**: You are FORBIDDEN from reporting a "Flat Wall" or "Slicing" fail unless you can explicitly name the character (letter/number) whose shape is cut in half.
- **LEGAL TOUCH**: If the bottom of a 'p', 'y', or 'g' touches the edge but the loop is complete and legible → **PASS**.
- **Triggers**: Category G (Popups & Modals)

**RULE 8: CASCADE FAILURES (Multi-Category Impact)**
- If Category A fails for clipping → MUST also fail:
  - Category C if text is cut
  - Category E if images are cut
- No masking allowed—fail ALL affected categories

**RULE 9: CARD IDENTIFIER REQUIREMENT**
- EVERY failure MUST include the specific identifier from **SECTION 0**:
  - Use format: "[Card: Name]" or "[ID: 33769]"
- Generic descriptions like "The image" are FORBIDDEN without identifier

**RULE 10: SPACING SYMMETRY & INTERNAL BALANCE (THE SYMMETRY LOCK)**
- **THE SYMMETRY LOCK (IRON LOCK)**: Layout 'Symmetry', 'Imbalance', and 'Squeezing' are SECONDARY to Legibility.
- **PROOF QUOTE MANDATE**: You are FORBIDDEN from failing Category A or G for "Half-cut" or "Sliced" text unless you quote the words exactly: 'The word [WORD] is sliced in half'.
- **FLAT-WALL PASS**: If the text inside a popup is 'Fully Readable', you are FORBIDDEN from failing Category G for a 'Flat Wall' or 'Zero Bottom Margin'. Legibility is the ONLY truth.
- **EXTERNAL**: FAIL [Category A] ONLY if spacing on any side is > 4x the opposite side AND content is clipped.
- **BOTTOM-SQUEEZE (LEGAL)**: If you cannot name the specific word being cut, you MUST mark this as **PASS**.

**RULE 11: VIEWPORT TRUNCATION & BANNERS**
- **ZERO TOLERANCE**: If any part of the widget is missing (tiny sliver or 80%) → **FAIL Category A**.
- **BOUNDARY MASK**: If a card hits the bottom/right edge without a closing border/shadow → **FAIL**.
- **POPUP INTEGRITY**: For popups (Avatar Group), YOU MUST see a complete rounded bottom border or a visible shadow cast on the background. If the card ends in a sharp white line at the image edge → **FAIL Category A**.
- **GEOMETRIC PARITY**: Every card MUST show 4 rounded corners. Top-only rounded = **FAIL**.
- **BANNER DETECTOR**: Inline CTA may appear as a **WIDE HORIZONTAL BANNER**. Signature: Contains "Ready to get started?" text + a primary colored button (e.g., "Get Started ↗").
- **MANDATE**: If visible ANYWHERE on the page, you MUST report "Inline CTA: Visible".
- **Triggers**: Category A (Layout & Spacing).

**RULE 12: RATING VISIBILITY (HYBRID & MULTI-COLOR)**
- **SIGNATURES**: Supports Stars, Numerical badges, Tacos, Hearts, Dots.
- **DOM_TRUTH**: If Section -1 shows detection, you MUST report Visible.

**RULE 13: SOCIAL PLATFORM ICON (POSITION LOCK)**
- **CONFIG INDEPENDENCE (CRITICAL)**: You MUST report "Visible" if you see a Facebook, Google, Yelp, or Brand logo in the Top-Right, **EVEN IF** SECTION 0 says "Manual" or "N/A" and Config says "Absent".
- **THE GOOGLE SIGNAL**: Look specifically for the 4-color 'G' insignia or a monochromatic brand badge anchored in the Top-Right.
- **LOCATION**: Top-Right corner of the review card boundary ONLY.
- **LEFT-SIDE PROHIBITION**: Do NOT use the top-left Feedspace "F" logo to satisfy Rule 13.

**RULE 14: DATE VALIDATION (STRICT-FORMAT Mandate)**
- **FORMAT REQUIREMENT**: Must match "Month DD, YYYY" (e.g., "Jan 10, 2024" or "January 10, 2024").
- **COMPONENTS**: Must contain (1) Month Name (3-letter or full), (2) Day Number, (3) Comma, and (4) 4-digit Year.
- **LOCATION (MANDATORY)**: The date MUST be anchored in the **absolute bottom-left corner** of the review card boundary.
- **FORBIDDEN (REPORT AS ABSENT)**: "Month Year" (e.g., "October 2025"), "MM/DD/YYYY", or any format missing the day, comma, or positioned anywhere other than the bottom-left. 
- **LITERAL TRUTH**: If you see a date that does NOT match this exact format or location, you MUST report UI Status: **Absent**.
- **REGRESSION LOCK (CRITICAL)**: If "Show Review Date" is reported as **Visible** in the UI but the **Config Status** is **Absent**, you MUST report Verdict: **FAIL** and trigger the token **VIOLATION: Product Regression**.
- **Triggers**: Category C (Text) or Category G (Date check).

**RULE 15: THIRD-PARTY INTERFERENCE (COLLISION LOCK)**
- **THE COLLISION-FAIL**: Audit for NON-Feedspace elements (e.g., WhatsApp Bubbles, Accessibility "Key" Icons, GDPR Banners, Chat Tabs) overlapping the widget.
- **ZERO TOLERANCE**: If a third-party icon covers even 1px of a Feedspace card, logo, or text, it is an absolute **FAIL Category B**.
- **MANDATORY TOKEN**: Use the exact token **FAIL_ELEMENT_OVERLAP**.
- **Triggers**: Category B (Element Containment).
- **PASS CRITERIA**: If the formatted date is visible on **ANY** card, report UI Status: **Visible** and Verdict: **PASS**.
- **STRICT FAIL**: FAIL if the format is "Month Year" (missing the Day) or missing the comma.
- **MANDATORY TRIGGER**: If the day number or comma is missing, you MUST use the token **FAIL_DATE_RULE14**.
- **RELIABILITY LOCK**: If the format matches the gold standard, you are PROHIBITED from flagging it as FAIL.

**RULE 15: BRANDING & LOGO AUDIT**
- **SIGNATURE**: White pill badge ("Capture reviews with Feedspace" + ⚡).
- **LOCATION**: Bottom center/right of widget (Exceptions: Toast/Cross - Popup only).

**RULE 16: TEXT CORRUPTION & STUTTERING**
- **DEFECT**: Duplicated labels (e.g., "ReviewsReviews").
- **FAIL**: If any label is layered on top of itself.

============================================================
🚨 FEATURE-SPECIFIC AUDITS (IRON LOCK) 🚨
============================================================

**RULE 11: SKELETON & DATA-AWARE HYDRATION AUDIT (IRON LOCK)**
- **STEP 1: SKELETON DETECTION**: If a card shows gray "skeleton" bars (rectangles) instead of text:
    - You MUST still perform the **SECTION 0 LOOKUP**.
    - **RULE 11.A (THE NULL OVERRIDE)**: If SECTION 0 shows \`rating: null\` or \`0\`, the absence of stars is a **PASS**, even if the rest of the card is a skeleton.
    - **RULE 11.B (THE DATA FAIL)**: Only FAIL if the data says \`rating > 0\` but the skeleton hasn't loaded it yet.
    - **RULE 11.C (FORCE PASS)**: If applying RULE 11.A, you MUST include the keyword **SKELETON_PASS_FORCE** in your reasoning to prevent manual overrides.

**RULE 12: RATING VISIBILITY (HYBRID & MULTI-COLOR)**
- **PASS CRITERIA**: If ratings are visible on **ANY** card, report UI Status: **Visible** and Verdict: **PASS**.
- **HYBRID SUPPORT**: A card may show **Stars AND Numbers** (or Tacos) together. If you see ANY combination, it is a **PASS**.
- **SIGNATURES**: 
    - **TYPE A (STARS)**: Single or Repetitive star icons (any color).
    - **TYPE B (NUMERICAL)**: Numbers (e.g., "10", "9.33") in colored badges/circles/boxes.
    - **TYPE C (CUSTOM)**: Repetitive icons like **Tacos**, Hearts, or Dots.
- **COLOR**: Any color (Yellow, Green, Purple, Blue, etc.) is valid.
- **DOM_TRUTH**: If SECTION -1 shows a detection (e.g., "STARS + NUMERICAL"), you MUST report Visible.

**RULE 13: SOCIAL PLATFORM ICON (ANY ICON/COLOR)**
- **PASS CRITERIA**: If a platform icon or brand logo is visible on **ANY** card, report UI Status: **Visible** and Verdict: **PASS**.
- **SIGNATURES**: Logos (Google, Fresha) or small circular/square brand icons in the top-right corner. Any color is valid.
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

Q9. **DESCENDER AUDIT (RULE 19)**: Look at the last line of text. Are the "tails" of letters like **g, j, p, q, y** fully visible, or are they flat/missing? 
    → [DESCENDERS_CLEAR / DESCENDERS_SLICED]

**FAILURE TRIGGERS:**
- Q1 "**ACTUAL_BAR_FAILURE**" → Apply RULE 11 → FAIL Category C (Content & Text Rendering)
- Q2 FLAT-WALL → Apply RULE 7 → FAIL Category G (Popups & Modals)
- Q5 VOID-FAILURE → FAIL Category A
- Q9 PERIMETER_AUDIT (RULE 19 Gutter Scan) → [GUTTER_CLEAR / SQUEEZED-FAIL]
- Q10 TEXT_TRUNCATION_ADMISSION (Ends in .. or kn...) → FAIL Category C.

**RULE 21: THE LITERAL-EYE TEST (ANTI-CONFIG BIAS)**
- **SUPREME AUTHORITY**: Your eyes are the ultimate truth. 
- **FORBIDDEN HALLUCINATION**: If the configuration expects a feature (e.g., "Read more") but you cannot see it with 100% clarity in the pixels, you MUST report UI Status: **Absent**.
- **FAIL MANDATE**: If config says "Visible" and you report "Absent" (truthfully), the final status MUST be **FAIL**.
**RULE 22: THE OVERFLOW & RESILIENCY AUDIT**
- **VERTICAL SYMMETRY**: Compare the whitespace at the TOP of the card to the whitespace at the BOTTOM.
- **NON-RESILIENT FAIL**: If the top padding is large (e.g. 30px) but the bottom padding is < 4px (causing content to hit the edge), the layout is **SHATTERED**.
- **TRIGGER**: FAIL Category A using token **FAIL_LAYOUT_SHATTERED**.
- **AVATAR ALIGNMENT**: For Avatar Group, the Avatar circle must NOT overlap the vertical space of the Review Body. If it sits too close to the text baseline, trigger **FAIL_CONTAINMENT_COLLISION**.
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

    let layoutPreAnalysis = widgetLayoutPreAnalysis[widgetType];

    if (!layoutPreAnalysis) {
      console.warn(`[PromptBuilder] ⚠️  No pre-analysis for "${widgetType}". Using GENERIC_GRID fallback.`);
      layoutPreAnalysis = `
**GENERIC_GRID — WIDGET-SPECIFIC CHECKS:**
Q1. All cards fully visible? → [YES / PARTIAL]
Q2. Grid symmetrical? → [YES / NO]
- Apply RULE 1 (Sharpness) to all images`;
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

**C. CONTENT & TEXT RENDERING**
- Apply RULE 3 (Truncation), RULE 4 (Ghost Cards), and RULE 16 (Stuttering)
Q1. Any text rendered as "invisible" (white-on-white) or ghosted? → [NO / GHOST-FAIL]
Q2. **NAME/ROLE TRUNCATION (RULE 3 - IRON LOCK)**:
    - Look ONLY at the first line of NAME and JOB ROLE.
    - Does it end in "..." or an abrupt fade? → [FAIL / PASS]
    - **REVIEW BODY**: Elipsis here is **PASS**.
    - **TRANSCRIPTION**: Transcribe first row of Name for any failing card.
Q3. **READ MORE AUDIT**: Apply RULE 5—literal words "Read More" present?
    - **ANY CARD PRINCIPLE**: It is **NOT mandatory** for all cards to have "Read More". It only appears on long reviews.
    - **PASS CRITERIA**: If "Read More" is visible on **ANY** card in the widget, report UI Status: **Visible** and Verdict: **PASS**.
    - **ELLIPSIS**: "..." alone on some cards is acceptable if "Read More" text is present elsewhere.
    - Quote its text and color: → ["[Color] Read More" / "ABSENT"]
Q4. **DATE AUDIT**: Grey date text visible? Apply RULE 14.

**D. AVATAR RENDERING**
- Apply RULE 1 (Sharpness), RULE 9 (Identifiers), and RULE 11 (Skeletons)
Q1. **SKELETON CHECK**: Are avatars rendered as vibrating gray circles or blocks?
    - If YES, look up Section 0 ID. If rating is null → [SKELETON_PASS_FORCE].
    - If NO → [ACTUAL AVATARS].
Q2. Any photo looks distorted or has muddy edges? → [NO / YES—specify card]
Q3. **MANDATORY REVIEWER AUDIT LOG (PER-CARD ANALYSIS)**:
    - You MUST list every unique name found and their sharpness/truncation status.
    - Format: "[Name]: [Initial/Photo] Sharpness Log (Text 1px/Img Xpx) | Truncation (FAIL/PASS)"
    - **CRITICAL**: Apply Rule 1 (>1.1px = FAIL) to EVERY name listed. If failing, use token **FAIL_SHARP_AVATAR**.
Q4. Avatar sizes consistent across cards? → [CONSISTENT / INCONSISTENT]

Q3. **SHARPNESS BENCHMARK (MANDATORY)**: 
    - Apply the **ADAPTIVE RESOLUTION LOCK** (Rule 1).
    - Compare logo/media image to current page text.
    - **FORENSIC PROOF**: You are FORBIDDEN from reporting 'SHARP' unless you can describe the texture: (e.g., 'I can see 1px razor edges on the logo grain' or 'Text anti-aliasing is crisp').
    - Does image show interpolation blur or 'Watercolor/Cloud' effect compared to text? → [Passing - SHARP / Failing - **FAIL_SHARP_MEDIA**]
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

    const widgetScanningRules = `
============================================================
WIDGET-SPECIFIC FEATURE DETECTION RULES
============================================================

**AVATAR_GROUP:**
- **STAR RATING AUDIT**: Apply RULE 12 in TWO places: Aggregate (Below "Loved & Trusted...") and Popups.
- **Show Social Platform Icon**: Apply RULE 13 (TOP RIGHT of popup).
- **Read More**: Apply RULE 5—if config show_full_review=0, look for link in popup text
- **Review Date**: Apply RULE 14 (Bottom-left of popup)
- **Inline CTA**: Styled button with arrow (↗) at bottom of popup

**AVATAR_CAROUSEL:**
- Analyze BOTH avatar row AND expanded popup
- **Show Social Platform Icon**: Apply RULE 13 (TOP RIGHT of popup)
- **Show Review Ratings**: Apply RULE 12 (Log BOTH Row and popup)
- **Left & Right Shift Buttons**: Circular arrows (← →) at absolute bottom of widget
- **Show Review Date**: Inside popup—Apply RULE 14
- **Inline CTA**: Styled button (often with ↗) inside popup
- **ANTI-CHEAT**: Do NOT invent relative dates like "5 months ago"

**CAROUSEL_SLIDER:**
- Scan ALL individual review cards
- **Left & Right Buttons**: Arrow controls (< >) on left/right widget edges
- **Slider Indicators**: Dots/lines at absolute bottom
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Read More**: Apply RULE 5—at bottom of text in each card
- **Inline CTA**: Styled button with arrow (↗) at bottom of card
- **Review Date**: Apply RULE 14 (in bottom-left)

**SINGLE_SLIDER:**
- Multiple screenshots show different reviews (avatar click reveals)
- Review content appears ABOVE avatar row
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Read More**: Apply RULE 5

**FLOATING_TOAST:**
- Small preview + large expanded modal
**TRUNCATION AUDIT (RULE 19)**: The Expanded Modal MUST show its full bottom shadow/border. If the text ends abruptly at the screenshot edge → **FAIL Category A (Layout)**.
- **ASPECT RATIO CHECK**: A Floating Toast modal is a vertical/square portrait. If it looks like a narrow horizontal sliver → **FAIL (Clipped/Truncated)**.
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Expanded modal**: Check Read More, Date (RULE 14), Inline CTA
- **Inline CTA**: Styled button with arrow (↗) at bottom of expanded review

**MARQUEE_STRIPE:**
- **EAGLE EYE REQUIRED**: Tiny icons (~10px) as character suffix after names
- **ALGORITHM**:
  1. Find reviewer NAME string
  2. Look IMMEDIATELY after last character
  3. Tiny letter/badge/logo there → Apply RULE 13
  4. Also check TOP RIGHT of popup for colored logo
- **Show Review Ratings**: Apply RULE 12 (Log BOTH cards and popups)
- **Show Review Date**: Apply RULE 14 (Small grey footer text)
- **Read More**: Apply RULE 5
- **Inline CTA**: Large styled button at popup bottom with MANDATORY arrow (↗)

**CROSS_SLIDER:**
- Analyze BOTH cross slider view AND expanded popup
- **Show Cross Bar (HARDENED RULE)**:
  1. **MOVEMENT MANDATE**: You are PROHIBITED from marking "Visible" unless you can prove BOTH tracks are moving and carrying different reviews over time (part1 vs part10).
  2. **GEOMETRY TRAP**: A single black diagonal strip is NOT an "X". If all reviews follow the same slope (e.g., all are \), it is a SINGLE SLIDER, not a Cross Bar.
  3. **INVENTORY VERDICT**: If your pre-analysis Q2 shows a static track or Q3 shows a straight line → Result: ABSENT.
- **[Element: Tilted Cross Slider] Alignment**: The intentional tilt is **CORRECT**.
- **Show Review Date**: Inside popup—Apply RULE 14
- **Inline CTA**: Inside popup—button/link (arrow ↗ NOT required)
- **IMPORTANT**: Minority anti-aliasing on the diagonals is NORMAL. Only mark "Absent" if text is completely unreadable.


**COMPANY_LOGO_SLIDER:**
- **SPECTRUM ANCHOR**: Compare logos to Feedspace branding/buttons for color reference
- **GRAY MODE**: If logos are grayscale while reference is vibrant → mark "Displays Gray mode" Visible
- **EXPANSION AUDIT (CRITICAL)**: Look at the white card (popup) that appears after clicking a logo.
- **DATE SCAN**: Scan the area BELOW the reviewer's stars/name and ABOVE the 'Capture reviews with Feedspace' footer.
- **LITERAL DATE**: Look for "Month DD, YYYY" (e.g., "October 16, 2024"). If you see it, you MUST report "Visible" for "Show Review Date" (Apply RULE 14).
- **SINGLE-HIT RULE**: Verify if a date is present in any 'partX' screenshot showing an expansion.
- **Popup**: White card over logo strip—scan for date below media, above CTA

**MARQUEE (Horizontal):**
- Multiple cards scrolling left-right, possibly multi-row
- Scan EVERY card individually
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Show Review Date**: Apply RULE 14
- **Read More**: Apply RULE 5

**MARQUEE (Vertical):**
- Cards scrolling up-down
- Scan EVERY visible card
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Show Review Date**: Apply RULE 14
- **Read More**: Apply RULE 5
- **Left & Right Buttons**: Mark ABSENT (not used in vertical)

**MASONRY:**
- Multi-column brick layout
- **Read More**: Apply RULE 5—literal "Read More" after text, before date
- **EAGLE EYE**: If "..." present, zoom in between text end and date
- **Show Social Platform Icon**: Apply RULE 13
- **Show Review Ratings**: Apply RULE 12
- **Show Review Date**: Apply RULE 14
- **Show Load More Button**: Large button at absolute bottom center
- **Inline CTA**: Scan for distinct non-review cards with a large primary-colored button (e.g., "Get Started" or "Join Now").
`;

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
☑ Checked date format: strict "Month DD, YYYY" per RULE 14
☑ Verified Feedspace Branding visibility and positioning per RULE 15

☑ Applied edge integrity checks (RULE 2) to all cards
☑ Applied 2-Line Rule (RULE 3) to truncated text
☑ Applied Ghost Card detection (RULE 4) to all text

**ANTI-HALLUCINATION CHECKPOINT:**
- Did I mark ANY feature "Visible" without seeing it in pixels? → [YES = FAIL / NO = PROCEED]
- Did I assume features based on config expectations? → [YES = FAIL / NO = PROCEED]
- Did I provide specific evidence for EVERY "Visible" claim? → [NO = FAIL / YES = PROCEED]
`;

    const reportingLogic = `
============================================================
REPORTING LOGIC & JSON OUTPUT
============================================================

**STATUS DETERMINATION:**
- (UI: Visible) + (Config: Visible) => PASS
- (UI: Visible) + (Config: Absent) => FAIL (Unintended Feature)
- (UI: Absent) + (Config: Visible) => FAIL
- (UI: Absent) + (Config: Absent) => Not Applicable

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
      "status": "PASS/FAIL/Not Applicable"
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

**MANDATORY AUDIT TRACE**: End of Prompt.
`;
  }
}

module.exports = PromptBuilder;