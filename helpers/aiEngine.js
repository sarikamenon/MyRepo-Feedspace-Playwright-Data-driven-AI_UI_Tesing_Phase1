const { GoogleGenerativeAI } = require("@google/generative-ai");
const PromptBuilder = require('./promptBuilder');
require('dotenv').config();

class AIEngine {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        if (this.apiKey) {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        } else {
            console.warn("[AIEngine] GEMINI_API_KEY is not set. AI validation will return mock data.");
        }
        this.maxRetries = 5;
        this.initialDelay = 5000; // 5s initial delay
    }

    async analyzeScreenshot(imageBuffers, config, widgetType, staticFeatures, geometricWarnings) {
        if (!this.apiKey) {
            return this.getMockResult(widgetType);
        }

        const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
        let attempts = 0;

        while (attempts <= this.maxRetries) {
            let text = "";
            try {
                attempts++;
                const rawPrompt = PromptBuilder.build(widgetType, config, staticFeatures, buffers.length > 1, geometricWarnings);
                // Force a structured format to prevent truncation and ensure valid JSON
                const prompt = rawPrompt + "\n\nCRITICAL: Respond with your reasoning first, followed by a valid JSON block wrapped in ```json ... ```. Ensure the JSON is complete and well-formed.";

                const imageParts = buffers.map(buffer => ({
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: "image/png",
                    },
                }));

                console.log(`[AIEngine] Sending screenshot to Gemini for ${widgetType} validation (Attempt ${attempts})...`);
                const result = await this.model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                text = response.text().trim();

                // Auto-fix for common AI truncation (missing closing braces)
                if (text.includes('```json') && !text.endsWith('}')) {
                    const openBraces = (text.match(/{/g) || []).length;
                    const closeBraces = (text.match(/}/g) || []).length;
                    if (openBraces > closeBraces) {
                        console.warn(`[AIEngine] Detected truncated JSON (missing ${openBraces - closeBraces} braces). Appending recovery braces.`);
                        text += "\n" + "}".repeat(openBraces - closeBraces) + "\n```";
                    }
                }

                // Enhanced Debug Logging: Show full AI response in terminal
                console.log("\n[AIEngine] --- RAW AI RESPONSE START ---");
                console.log(text);
                console.log("[AIEngine] --- RAW AI RESPONSE END ---\n");

                // Robust JSON and Reasoning Extraction
                const extractData = (str) => {
                    // Method 1: Look for markdown code blocks (standard for Gemini)
                    const mdMatch = str.match(/([\s\S]*?)```json\s*([\s\S]*?)\s*```/i);
                    if (mdMatch) {
                        return {
                            json: mdMatch[2].trim(),
                            reasoning: mdMatch[1].trim()
                        };
                    }

                    // Method 2: Manual brace matching (fallback)
                    const firstBrace = str.indexOf('{');
                    const lastBrace = str.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                        return {
                            json: str.substring(firstBrace, lastBrace + 1),
                            reasoning: str.substring(0, firstBrace).trim()
                        };
                    }

                    return { json: null, reasoning: str.trim() };
                };

                const { json, reasoning } = extractData(text);

                if (!json) {
                    throw new Error(`AI response did not contain a valid JSON block. Raw preamble: "${reasoning.substring(0, 100)}..."`);
                }

                let aiResults;
                try {
                    aiResults = JSON.parse(json);
                } catch (e) {
                    // Fallback: If outer block is invalid (prose in middle?), try to find markdown block
                    const mdMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
                    if (mdMatch) {
                        try {
                            aiResults = JSON.parse(mdMatch[1]);
                        } catch (e2) {
                            throw new Error(`The data payload from this page was invalid or incomplete (JSON Error).`);
                        }
                    } else {
                        throw new Error(`The data payload from this page was invalid or incomplete (JSON Error).`);
                    }
                }

                // Attach the reasoning block so it can be shown in the report
                let cleanReasoning = (reasoning || "No additional reasoning provided.")
                    .replace(/```json/gi, '')
                    .replace(/```/gi, '')
                    .trim();

                aiResults.analysis_message = cleanReasoning;

                // Post-process: Calculate status in JS for stability
                return this.processResults(aiResults, config, widgetType, staticFeatures);

            } catch (error) {
                const isRateLimit = error.message.includes('429') || error.status === 429;
                const isTransientFetch = error.message.includes('fetch failed') ||
                    error.message.includes('ECONNRESET') ||
                    error.message.includes('ETIMEDOUT');

                if ((isRateLimit || isTransientFetch) && attempts <= this.maxRetries) {
                    const delay = this.initialDelay * Math.pow(2, attempts - 1);
                    const reason = isRateLimit ? 'Rate limit (429)' : 'Transient network error';
                    console.warn(`[AIEngine] ${reason}. Retrying in ${delay}ms... (Attempt ${attempts}/${this.maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                console.error("[AIEngine] Error during analysis:", error);
                const features = staticFeatures || (config && config.features) || [];

                // Enhanced Logging for Debugging
                if (text) {
                    console.log("\n[AIEngine] DEBUG - Raw AI Response (Failure Context):");
                    console.log(text);
                    console.log("--------------------------------------------------\n");
                }

                const fallbackResults = (Array.isArray(features) ? features : []).map(f => ({
                    feature: typeof f === 'string' ? f : (f.name || 'Unknown'),
                    ui_status: 'N/A',
                    config_status: 'N/A',
                    scenario: 'AI Analysis Failed',
                    status: 'UNKNOWN',
                    warning: `AI analysis failed: ${error.message}`
                }));

                return {
                    error: error.message,
                    status: "ERROR",
                    feature_results: fallbackResults
                };
            }
        }
    }

    processResults(aiData, config, widgetType, staticFeatures) {
        if (!aiData || !aiData.feature_results) return aiData;

        // 1. Strict Filter: only include features defined in the config (staticFeatures)
        if (Array.isArray(staticFeatures) && staticFeatures.length > 0) {
            aiData.feature_results = aiData.feature_results.filter(res => {
                const normalize = (str) => str.toLowerCase()
                    .replace(/[_\- ]/g, '')
                    .replace(/grey/g, 'gray')
                    .replace(/grayscale/g, 'gray');

                const normAI = normalize(res.feature);
                return staticFeatures.some(sf => {
                    const normSF = normalize(sf);
                    return normSF === normAI ||
                        (normSF.includes('gray') && normAI.includes('gray') &&
                            (normAI.length - normSF.length < 10));
                });
            });
        }

        // 2. Context-Aware Consistency Safety Net
        const analysisMessage = (aiData.analysis_message || "");
        const reasoningLines = analysisMessage.split('\n');

        // NO-IMAGE BYPASS: disable sharpness safety net when no images are present
        const isImageAbsent = (aiData.feature_results || []).some(f =>
            (f.feature === "Review Image / Avatar" || f.feature === "Avatar") && f.ui_status === "Absent"
        );

        // ── findAdmission: Scan answer-part of each reasoning line for defect keywords ──
        // ── findAdmission: Scan answer-part for defect keywords with Negation Guard ──
        const findAdmission = (keys) => {
            const bluntFailures = [
                "blurry-fail", "blurred-fail", "fuzzy-fail", "sharp-fail", "blur-fail", "fail-blur",
                "loss-of-sharpness", "missing-elements", "clipped-fail", "sliced-fail",
                "json-leakage", "raw-code", "json-leak", "muddy"
            ];
            
            const negations = ["no", "not", "none", "absent", "zero", "never", "✓", "passing"]; 

            for (const line of reasoningLines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // Split on separator and take only the answer part
                let answerPart = trimmedLine;
                const separators = ['→', '->', ':'];
                for (const sep of separators) {
                    if (trimmedLine.includes(sep)) {
                        const parts = trimmedLine.split(sep);
                        answerPart = parts[parts.length - 1].trim();
                        break;
                    }
                }

                const lowAnswer = answerPart.toLowerCase();

                // 1. Check for Strict Tokens (Prioritize Case-Sensitive or Strict Match)
                for (const key of keys) {
                    if (key.startsWith("FAIL_") || key.startsWith("CRITICAL_") || key.startsWith("ICON_")) {
                        // Strict tokens must be present and NOT preceded by a negation
                        if (answerPart.includes(key)) {
                            const beforeToken = answerPart.split(key)[0].toLowerCase();
                            if (!negations.some(neg => beforeToken.includes(neg))) {
                                return line;
                            }
                        }
                    } else {
                        // 2. Check for Fuzzy Keywords (Case Insensitive, No Negation)
                        if (lowAnswer.includes(key.toLowerCase())) {
                            // IGNORE lines that are clearly questions or prompt markers
                            if (line.trim().startsWith("* Q") || line.trim().startsWith("Q") || line.toLowerCase().endsWith("? no") || line.toLowerCase().endsWith("no.")) {
                                continue;
                            }
                            const beforeKeyword = lowAnswer.split(key.toLowerCase())[0];
                            if (!negations.some(neg => beforeKeyword.includes(neg))) {
                                return line;
                            }
                        }
                    }
                }

                // 3. Check for Blunt Failures (Case Insensitive, No Negation)
                for (const blunt of bluntFailures) {
                    if (lowAnswer.includes(blunt.toLowerCase())) {
                        const beforeBlunt = lowAnswer.split(blunt.toLowerCase())[0];
                        if (!negations.some(neg => beforeBlunt.includes(neg))) {
                            return line;
                        }
                    }
                }
            }
            return null;
        };

        const extractProof = (line) => {
            if (!line) return "";
            const match = line.match(/\[(Card|Element|Position):?\s*([^\]]+)\]/i);
            return match ? ` on ${match[0]}` : " in widget";
        };

        const friendlyErrorMap = {
            "DESCENDERS_SLICED": "Review text is horizontally clipped/bisected at the bottom boundary (Text Truncation).",
            "Q9": "Review text is horizontally clipped/bisected at the bottom boundary (Text Truncation).",
            "FLAT-WALL": "Container has a sharp, rectilinear cut instead of a rounded border (Clipping Detected).",
            "Q2": "Container has a sharp, rectilinear cut instead of a rounded border (Clipping Detected).",
            "CHOPPED": "Card corners are asymmetric; detected a sharp 90° cut vs. a rounded edge.",
            "ASYMMETRIC": "Layout corners are asymmetric (Uneven rounding/padding detected).",
            "SQUEEZED-FAIL": "Ratings or text are touching the container edge (Gutter failure detected).",
            "FAIL_CONTAINMENT_COLLISION": "Content collision detected (Text or stars overlapping other elements).",
            "FAIL_LAYOUT_CLIPPED": "Widget content is bleeding off the screen or container boundary.",
            "FAIL_TEXT_TRUNCATED": "Text is cut off mid-sentence or lacks vertical clearance (Squeeze Failure).",
            "FAIL_LAYOUT_SHATTERED": "Layout is non-resilient; content is squeezing out of the container boundary (Padding Mismatch).",
            "FAIL_DATE_FORMAT": "Review date format is incorrect (Missing Day/Month/Year components).",
            "FAIL_DATE_RULE14": "Review date format is incorrect; must strictly follow Month DD, YYYY (e.g., Oct 17, 2025).",
            "missing bottom edge": "Widget container is clipped; the bottom border/edge is missing or bleeding off.",
            "kn...": "Text truncation detected (Incomplete word 'know' rendered as 'kn...').",
            "needed to kn...": "Text truncation detected (Incomplete word 'know' rendered as 'kn...').",
            "ended in dots": "Text ends prematurely with an ellipsis in a modal/popup.",
            "no bottom border": "Container bottom boundary is not visible (Possible Horizontal Clipping).",
            "borderless state": "Container bottom edge is missing/borderless (Clipping detected).",
            "bottom part is cut": "The bottom of the widget is visually truncated or cut off.",
            "corners are not visible": "Widget perimeter is compromised; border corners are missing/clipped."
        };

        const toFriendlyError = (line, defaultValue) => {
            if (!line) return defaultValue;
            for (const [key, friendly] of Object.entries(friendlyErrorMap)) {
                if (line.includes(key)) return friendly;
            }
            return line.split('→').pop().split('->').pop().trim() || defaultValue;
        };

        // ── LAYOUT: Strict tokens only (Case-Sensitive) ──
        const layoutKeywords = ["FAIL_LAYOUT_CLIPPED", "FAIL_LAYOUT_BLOCKED", "FAIL_LAYOUT_FLAT_WALL", "CRITICAL_LAYOUT_FAILURE", "FAIL_LAYOUT_ASYMMETRIC", "CHOPPED", "rectilinear", "bleeding off", "sharp cut", "DESCENDERS_SLICED", "SQUEEZED-FAIL", "FAIL_LAYOUT_SHATTERED", "ASYMMETRIC-FAIL", "VOID-FAILURE", "ACTUAL_SQUEEZE_DETECTED", "bisected", "truncated", "cut off", "missing tail", "sliver", "missing bottom edge", "no bottom border", "no visible bottom", "cut horizontally", "bleeding off the bottom", "borderless state", "bottom part is cut", "corners are not visible", "kn...", "needed to kn...", "shattered word", "incomplete word", "ended in dots", "touching the border", "touching the edge", "no air below stars", "squeezed stars", "clipped stars", "bleeding", "broken layout", "asymmetric padding", "squeezing out"];
        const layoutLine = findAdmission(layoutKeywords);
        const mentionsLayoutIssue = (
            analysisMessage.includes("FAIL_LAYOUT_CLIPPED") ||
            analysisMessage.includes("FAIL_LAYOUT_ASYMMETRIC") ||
            analysisMessage.includes("ASYMMETRIC") ||
            analysisMessage.includes("SYMMETRY") ||
            layoutLine
        ) && !analysisMessage.includes("PASS_FORCE_LAYOUT");

        const mentionsBlockageIssue = (
            analysisMessage.includes("FAIL_LAYOUT_BLOCKED") ||
            analysisMessage.includes("FAIL_POPUP_BLOCK") ||
            analysisMessage.includes("WIDGET_NOT_FOUND")
        );

        const layoutProof = extractProof(layoutLine);

        // ── SHARPNESS: Strict tokens + Fuzzy Keyword fallback ──
        const blurKeywords = [
            "slightly soft", "compressed image", "low-res", "fuzzy", "blur", 
            "pixelated", "smeared", "watercolor", "muddy texture", "poor clarity",
            "smooth texture", "clean appearance", "interpolation", "high-level smoothing",
            "water-color", "cloud-like", "soft detail", "hybrid sharpness", "differential fail",
            "softer than text"
        ];
        
        const avatarBlurLine = findAdmission(["FAIL_SHARP_AVATAR", ...blurKeywords]);
        const mediaBlurLine = findAdmission(["FAIL_SHARP_MEDIA", ...blurKeywords]);
        
        const mentionsAvatarSharpness = (
            analysisMessage.includes("FAIL_SHARP_AVATAR") ||
            analysisMessage.includes("CRITICAL_AVATAR_FAILURE") ||
            avatarBlurLine
        ) && !analysisMessage.includes("PASS_FORCE_SHARP");

        const mentionsMediaSharpness = (
            analysisMessage.includes("FAIL_SHARP_MEDIA") ||
            mediaBlurLine
        ) && !analysisMessage.includes("PASS_FORCE_SHARP");

        // ── CONTENT & CONTAINMENT ──
        const contentLine = findAdmission(["FAIL_CONTENT_TRUNCATED", "FAIL_CONTENT_JSON_LEAK"]);
        const containmentLine = findAdmission(["FAIL_CONTAINMENT_COLLISION", "FAIL_ELEMENT_OVERLAP", "collision", "blocking icon", "overlap"]);

        const mentionsContentIssue = (
            analysisMessage.includes("FAIL_CONTENT_TRUNCATED") ||
            analysisMessage.includes("FAIL_CONTENT_JSON_LEAK") ||
            contentLine
        ) && !analysisMessage.includes("PASS_FORCE_CONTENT");

        const mentionsContainmentIssue = (
            analysisMessage.includes("FAIL_CONTAINMENT_COLLISION") ||
            analysisMessage.includes("FAIL_ELEMENT_OVERLAP") ||
            containmentLine
        );

        // ── DATE: Strict tokens only ──
        const dateLine = findAdmission(["FAIL_DATE_FORMAT", "FAIL_DATE_RULE14"]);
        const mentionsDateIssue = (
            analysisMessage.includes("FAIL_DATE_FORMAT") ||
            analysisMessage.includes("FAIL_DATE_RULE14") ||
            dateLine
        );

        const dateProof = extractProof(dateLine);

        // ── ICON: anchor strings + findAdmission fallback ──
        const iconLine = findAdmission(["icon violation", "erroneous visibility", "visible despite config", "logo-fail"]);
        const mentionsIconIssue = (
            analysisMessage.includes("ICON VIOLATION") ||
            analysisMessage.includes("VISIBLE DESPITE CONFIG") ||
            iconLine
        );

        const iconProof = extractProof(iconLine);

        // ── Apply AUTO-FAIL overrides where reasoning contradicts JSON PASS ──
        if (mentionsLayoutIssue || mentionsAvatarSharpness || mentionsMediaSharpness || mentionsContentIssue || mentionsDateIssue || mentionsBlockageIssue || mentionsContainmentIssue) {
            (aiData.aesthetic_results || []).forEach(res => {
                const cat = res.category.toUpperCase();
                
                if (res.status === "PASS") {
                    if (mentionsBlockageIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Blockage: ${toFriendlyError(layoutLine, "Partially cut or obscured widget detected.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("LAYOUT") && mentionsLayoutIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Layout: ${toFriendlyError(layoutLine, "Clipped edges or layout integrity failure.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("AVATAR") && mentionsAvatarSharpness) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Avatar Quality: ${toFriendlyError(avatarBlurLine, "Blur or interpolation detected in avatars.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("MEDIA") && mentionsMediaSharpness) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Media Quality: ${toFriendlyError(mediaBlurLine, "Blur or interpolation detected in logos/images.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("CONTAINMENT") && mentionsContainmentIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Containment: ${toFriendlyError(containmentLine, "Element overlap or collision detected.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("CONTENT") && mentionsContentIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Content: ${toFriendlyError(contentLine, "Truncation or JSON leak detected.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("SPACING") && mentionsLayoutIssue) {
                         res.status = "FAIL";
                         res.issue = `[Auto-Fail] Spacing: ${toFriendlyError(layoutLine, "Layout spacing imbalance detected.")}`;
                         res.severity = "CRITICAL";
                    } else if ((cat.includes("TEXT") || cat.includes("CONTENT")) && mentionsDateIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Date Format: ${toFriendlyError(dateLine, "Rule 14 violation.")}`;
                        res.severity = "CRITICAL";
                    } else if (cat.includes("ICON") && mentionsIconIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Icon Visibility: ${iconLine || "Social icon visible despite being OFF in config."}`;
                        res.severity = "CRITICAL";
                    }
                }
            });
        }

        // 1. CLEANUP FIRST: Strip any leaking placeholders from the raw AI response
        const cleaningRegex = /XXXX|YYYY|REAL_ID_HERE|REAL_PLATFORM_HERE|ID:\s*N\/A|Platform:\s*N\/A|ID:\s*\[Data Not Linked\]/gi;
        const aiResultsArray = aiData.feature_results || [];
        const rawFeeds = config?.widget_data?.feeds_data || config?.feeds_data || config?.data?.feeds_data || [];
        aiResultsArray.forEach(f => {
            if (f.remarks) f.remarks = f.remarks.replace(cleaningRegex, "[Data Not Linked]");
            if (f.issue) f.issue = f.issue.replace(cleaningRegex, "[Data Not Linked]");
        });
        
        // --- GLOBAL CLEANUP & FINAL INJECTION: Strip ANY leaking placeholders from analysis_message ---
        if (aiData.analysis_message) {
            // Cleanup first
            aiData.analysis_message = aiData.analysis_message.replace(cleaningRegex, "[Data Not Linked]");
            
            // Try to inject the first ID if still present (for pre-analysis logs)
            if (aiData.analysis_message.includes("[Data Not Linked]") && rawFeeds.length > 0) {
                const firstId = rawFeeds[0].id || "";
                aiData.analysis_message = aiData.analysis_message.replace(/\[Data Not Linked\]/g, firstId.toString());
            }
        }

        // 2. DEFCON-1 OVERRIDE: Data-Aware Injection
        aiResultsArray.forEach(f => {
            const trait = (f.feature || "").toLowerCase();
            const isRatingOrIcon = trait.includes("rating") || trait.includes("icon") || trait.includes("platform") || trait.includes("date");
            
            // Perform injection for ALL relevant features, regardless of PASS/FAIL status
            if (isRatingOrIcon) {
                // Determine if this is a "Missing" issue vs a "Visible" issue
                const aiIssue = (f.issue || "").toLowerCase() + (f.remarks || "").toLowerCase();
                const isAbsentIssue = aiIssue.includes("absent") || aiIssue.includes("missing") || aiIssue.includes("not present") || aiIssue.includes("skeleton") || aiIssue.includes("not found");

                // If it was a FAIL, we ONLY flip it to PASS if confirmed missing in data
                // If it's a FAIL because it's VISIBLE but shouldn't be, we keep the FAIL!
                if (f.status === "FAIL" && isAbsentIssue) {
                    // This will be flipped inside the matchingFeed check below if hasNullData is true
                }

                // Map to the correct feed
                // Regex improved to capture full names with spaces inside [Card: ...]
                const cardIdentifier = (f.issue + (f.remarks || "")).match(/Card:\s*([^\]]+)/i)?.[1]?.trim() || "AN";
                
                let matchingFeed = rawFeeds.find(feed => {
                    const name = (feed.app_user_name || feed.user_name || feed.name || "").toString().toLowerCase();
                    const searchId = feed.id?.toString();
                    const lowerIden = cardIdentifier.toLowerCase();
                    
                    return name.includes(lowerIden) || 
                           lowerIden.includes(name) || 
                           searchId === lowerIden || 
                           lowerIden === "an";
                });
                
                // Fallback: If only one card exists, use the first feed
                if (!matchingFeed && rawFeeds.length === 1) matchingFeed = rawFeeds[0];

                if (matchingFeed) {
                    const isRatingTrait = trait.includes("rating");
                    const isIconTrait = trait.includes("icon") || trait.includes("platform");
                    const isDateTrait = trait.includes("date");
                    
                    let hasNullData = false;
                    
                    if (isRatingTrait) {
                        hasNullData = matchingFeed.rating === null || 
                                     matchingFeed.rating === 0 || 
                                     matchingFeed.rating === "0";
                    } else if (isIconTrait) {
                        // FORCE DEFAULT: If show_platform_icon is missing from config, we assume it's OFF ('0')
                        const showIconConfig = config?.widget_customization?.show_platform_icon ?? "0";
                        const slug = matchingFeed.social_platform?.slug || "";
                        const feedType = matchingFeed.feed_type || "";
                        const isManualReview = slug.includes("manual");
                        const isVideoFeed = feedType === "video_feed";
                        
                        hasNullData = (showIconConfig === "0") || 
                                     isManualReview || 
                                     isVideoFeed || 
                                     (!matchingFeed.social_platform && !matchingFeed.review_url);
                    } else if (isDateTrait) {
                        hasNullData = !matchingFeed.review_at;
                    }

                    const realId = matchingFeed.id || "[Unknown ID]";
                    const realPlatform = matchingFeed.social_platform?.name || matchingFeed.feed_type || "[Unknown Platform]";
                    const proofString = `(Proof: SECTION 0 - ID:${realId}, Platform:${realPlatform})`;

                    // --- VIOLATION OVERRULE (THE SUPREME LOCK) ---
                    // If UI is Visible but Config is Absent, this is a product bug. 
                    // We FORCE status to FAIL and override any AI "Data-Driven Pass" logic.
                    const isVisibleInUI = f.ui_status === "Visible" || f.ui_status === "Visible (Detected)" || f.ui_status?.includes("Visible");
                    const isAbsentInConfig = f.config_status === "Absent" || f.config_status?.includes("Absent");

                    if (isVisibleInUI && isAbsentInConfig) {
                        console.log(`[AIEngine] 🚨 VISIBILITY VIOLATION FORCE-FAIL: ${trait} is Visible vs Config Absent.`);
                        f.status = "FAIL";
                        f.issue = `VIOLATION: ${trait} is VISIBLE in the UI review cards, but the widget configuration is set to ABSENT. This is a product regression. ${proofString}`;
                    } else if (hasNullData) {
                        // Regular auto-heal for items that are absent as intended
                        if (f.status === "FAIL" && !isAbsentIssue) {
                            console.log(`[AIEngine] 🛡️ Visibility Violation Detected for ${trait}. Preserving FAIL status.`);
                            f.issue = `Icon VIOLATION: Platform icon is visible in UI despite configuration being OFF. ${proofString}`;
                        } else {
                            f.status = "PASS";
                            if (f.issue && !f.issue.includes("SKELETON_PASS_FORCE")) {
                                f.issue = "No visual defects detected (Data-Driven Pass)";
                            }
                        }
                    } else {
                        // Data says there IS a rating, so we respect the AI's FAIL
                        console.log(`[AIEngine] DEFCON-1: Respecting FAIL for ${f.feature} (Data has non-null value)`);
                    }
                }
            }
        });

        // 3. Recalculate overall status
        const hasFeatureFailures = (aiData.feature_results || []).some(f => f.status === "FAIL");
        const hasAestheticFailures = (aiData.aesthetic_results || []).some(a => a.status === "FAIL");

        aiData.overall_status = (hasFeatureFailures || hasAestheticFailures) ? "FAIL" : "PASS";

        return aiData;
    }

    getMockResult(widgetType) {
        return {
            mock: true,
            overall_status: "FAIL",
            message: "Mock Mode: AI Validation Results (Simulated)",
            feature_results: [
                { feature: "Left & Right Buttons", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Slider Indicators", ui_status: "Absent", config_status: "Visible", scenario: "UI hidden but config says visible", status: "FAIL" },
                { feature: "Show Review Date", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Show Review Ratings", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Read More", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Show Social Platform Icon", ui_status: "Absent", config_status: "Visible", scenario: "UI hidden but config says visible", status: "FAIL" },
                { feature: "Inline CTA", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Feedspace Branding", ui_status: "Absent", config_status: "Visible", scenario: "Branding hidden visually", status: "PASS" },
                { feature: "Review Card Border & Shadow", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Left & Right Shift Buttons", ui_status: "Absent", config_status: "Absent", scenario: "✅ Normal", status: "PASS" },
                { feature: "Show Cross Bar", ui_status: "Absent", config_status: "Absent", scenario: "✅ Normal", status: "PASS" },
                { feature: "Displays Gray mode", ui_status: "Absent", config_status: "Absent", scenario: "✅ Normal", status: "PASS" }
            ]
        };
    }
}

module.exports = AIEngine;