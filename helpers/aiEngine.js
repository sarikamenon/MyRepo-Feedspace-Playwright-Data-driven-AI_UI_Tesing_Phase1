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

                    // Method 2: Fallback to outermost { ... } (if markdown is missing)
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
        const findAdmission = (keys) => {
            const bluntFailures = [
                "blurry-fail", "blurred-fail", "fuzzy-fail", "sharp-fail", "blur-fail", "fail-blur",
                "loss-of-sharpness", "missing-elements", "clipped-fail", "sliced-fail",
                "json-leakage", "raw-code", "json-leak", "blured"
            ];
            const allKeys = [...keys, ...bluntFailures];

            for (const line of reasoningLines) {
                const lowLine = line.toLowerCase().trim();
                if (!lowLine) continue;

                // Split on separator and take only the answer part
                let answerPart = lowLine;
                const separators = ['→', '->', ':'];
                for (const sep of separators) {
                    if (lowLine.includes(sep)) {
                        const parts = lowLine.split(sep);
                        answerPart = parts[parts.length - 1].trim();
                        break;
                    }
                }

                if (allKeys.some(k => answerPart.includes(k.toLowerCase()))) {
                    return line; // Return the full original line for identifier extraction
                }
            }
            return null;
        };

        const extractProof = (line) => {
            if (!line) return "";
            const match = line.match(/\[(Card|Element|Position):?\s*([^\]]+)\]/i);
            return match ? ` on ${match[0]}` : " in widget";
        };

        // ── LAYOUT: anchor strings + findAdmission fallback ──
        const layoutLine = findAdmission(["flat-wall fail", "narrow-clipped", "critical_layout_failure"]);
        const mentionsLayoutIssue = (
            analysisMessage.includes("CRITICAL_LAYOUT_FAILURE") ||
            analysisMessage.includes("FLAT-WALL FAIL") ||
            analysisMessage.includes("NARROW-CLIPPED") ||
            layoutLine
        ) && !analysisMessage.includes("LAYOUT_PASS_FORCE");

        const layoutProof = extractProof(layoutLine);

        // ── SHARPNESS: direct anchor strings take priority over findAdmission ──
        const blurLine = findAdmission([
            "blurry", "blur", "pixelated", "soft", "fuzzy", "loss of detail",
            "low-res", "pixel blocks", "out of focus", "unclear detail",
            "low resolution", "blurry edges", "loss of focus"
        ]);
        const mentionsSharpnessIssue = (
            analysisMessage.includes("CRITICAL_AVATAR_FAILURE") ||
            analysisMessage.includes("BLURRY-FAIL") ||
            analysisMessage.includes("BLURRED-FAIL") ||
            analysisMessage.includes("BLUR-FAIL") ||
            analysisMessage.includes("FUZZY-FAIL") ||
            analysisMessage.includes("SHARP-FAIL") ||
            analysisMessage.includes("LOSS-OF-SHARPNESS") ||
            analysisMessage.includes("Failing - BLURRY") ||
            blurLine
        ) && !analysisMessage.includes("SHARP_PASS_FORCE") && !isImageAbsent;

        const sharpnessProof = extractProof(blurLine);

        // ── CONTENT: anchor strings + findAdmission fallback ──
        const contentLine = findAdmission([
            "json leakage", "raw json", "placeholder token", "unrendered code",
            "structural garbage", "curly brace", "premature truncation", "line-1-fail"
        ]);
        const mentionsContentIssue = (
            analysisMessage.includes("CRITICAL_CONTENT_FAILURE") ||
            analysisMessage.includes("JSON LEAK") ||
            analysisMessage.includes("LINE-1-FAIL") ||
            contentLine
        ) && !analysisMessage.includes("CONTENT_PASS_FORCE");

        const contentProof = extractProof(contentLine);

        // ── Apply AUTO-FAIL overrides where reasoning contradicts JSON PASS ──
        if (mentionsLayoutIssue || mentionsSharpnessIssue || mentionsContentIssue) {
            (aiData.aesthetic_results || []).forEach(res => {
                const cat = res.category.toUpperCase();
                const isLayoutCat = cat.includes("LAYOUT") || cat.includes("POPUP") || cat.includes("SPACING");
                const isSharpnessCat = cat.includes("AVATAR") || cat.includes("MEDIA");
                const isContentCat = cat.includes("CONTENT") || cat.includes("TEXT");

                if (res.status === "PASS") {
                    if (isLayoutCat && mentionsLayoutIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Layout issues (slicing or truncation) detected${layoutProof}. Overriding for safety.`;
                        res.severity = "CRITICAL";
                    } else if (isSharpnessCat && mentionsSharpnessIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Image quality issues (blur or fuzziness) detected${sharpnessProof}. Overriding for safety.`;
                        res.severity = "CRITICAL";
                    } else if (isContentCat && mentionsContentIssue) {
                        res.status = "FAIL";
                        res.issue = `[Auto-Fail] Review text contains unrendered code or technical markers${contentProof}. Overriding for safety.`;
                        res.severity = "CRITICAL";
                    }
                }
            });
        }

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