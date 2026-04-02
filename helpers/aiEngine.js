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
                const prompt = PromptBuilder.build(widgetType, config, staticFeatures, buffers.length > 1, geometricWarnings);

                const imageParts = buffers.map(buffer => ({
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: "image/png",
                    },
                }));

                console.log(`[AIEngine] Sending screenshot to Gemini for ${widgetType} validation (Attempt ${attempts})...`);
                const result = await this.model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                text = response.text();

                // Robust JSON Extraction: Find the outermost { ... } block
                // This handles conversational preamble like "Okay, here is the JSON..." 
                const extractJson = (str) => {
                    const firstBrace = str.indexOf('{');
                    const lastBrace = str.lastIndexOf('}');
                    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
                    return str.substring(firstBrace, lastBrace + 1);
                };

                const cleanText = extractJson(text);
                if (!cleanText) {
                    throw new Error(`AI response did not contain a valid JSON block. Raw text: "${text.substring(0, 100)}..."`);
                }

                let aiResults;
                try {
                    aiResults = JSON.parse(cleanText);
                } catch (e) {
                    // Fallback: If outer block is invalid (prose in middle?), try to find markdown block
                    const mdMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
                    if (mdMatch) {
                        aiResults = JSON.parse(mdMatch[1]);
                    } else {
                        throw new Error(`Failed to parse extracted JSON: ${e.message}. Raw: "${cleanText.substring(0, 100)}..."`);
                    }
                }

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
                    // Strict term match or specific gray/grey synonym match
                    return normSF === normAI || 
                           (normSF.includes('gray') && normAI.includes('gray') && 
                            (normAI.length - normSF.length < 10)); // Heuristic to allow "Displays Gray Mode" vs "Gray Mode"
                });
            });
        }

        // 2. Recalculate overall status based on filtered failures
        const hasFailures = aiData.feature_results.some(f => f.status === "FAIL");
        aiData.overall_status = hasFailures ? "FAIL" : "PASS";

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
                { feature: "Review Card Border & Shadow", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" }
            ]
        };
    }
}

module.exports = AIEngine;
