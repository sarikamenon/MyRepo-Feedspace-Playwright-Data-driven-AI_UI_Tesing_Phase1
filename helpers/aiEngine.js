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

    async analyzeScreenshot(imageBuffers, config, widgetType, staticFeatures) {
        if (!this.apiKey) {
            return this.getMockResult(widgetType);
        }

        const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
        let attempts = 0;

        while (attempts <= this.maxRetries) {
            try {
                attempts++;
                const prompt = PromptBuilder.build(widgetType, config, staticFeatures, buffers.length > 1);

                const imageParts = buffers.map(buffer => ({
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: "image/png",
                    },
                }));

                console.log(`[AIEngine] Sending ${buffers.length} screenshot(s) to Gemini for ${widgetType} validation (Attempt ${attempts})...`);
                const result = await this.model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                const text = response.text();

                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const aiResults = JSON.parse(cleanText);

                // Post-process: Calculate status in JS for stability
                return this.processResults(aiResults, config, widgetType, staticFeatures);

            } catch (error) {
                const isRateLimit = error.message.includes('429') || error.status === 429;

                if (isRateLimit && attempts <= this.maxRetries) {
                    const delay = this.initialDelay * Math.pow(2, attempts - 1);
                    console.warn(`[AIEngine] Rate limit reached (429). Retrying in ${delay}ms... (Attempt ${attempts}/${this.maxRetries})`);
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
        // Emergency Revert: Allow AI to handle status for demo
        if (!aiData || !aiData.feature_results) return aiData;

        // Recalculate overall status based on AI's PASS/FAIL
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
                { feature: "Shorten Long Reviews / Read More", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Show Social Platform Icon", ui_status: "Absent", config_status: "Visible", scenario: "UI hidden but config says visible", status: "FAIL" },
                { feature: "Inline CTA", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" },
                { feature: "Feedspace Branding", ui_status: "Absent", config_status: "Visible", scenario: "Branding hidden visually", status: "PASS" },
                { feature: "Review Card Border & Shadow", ui_status: "Visible", config_status: "Visible", scenario: "✅ Normal", status: "PASS" }
            ]
        };
    }
}

module.exports = AIEngine;
