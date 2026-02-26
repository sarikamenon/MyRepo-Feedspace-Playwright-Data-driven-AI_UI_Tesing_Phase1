const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ No API Key found in .env file.");
        return;
    }

    console.log(`🔑 Using API Key: ${apiKey.substring(0, 5)}...`);

    const genAI = new GoogleGenerativeAI(apiKey);

    const candidates = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-001",
        "gemini-1.5-pro",
        "gemini-pro",
        "models/gemini-1.5-flash"
    ];

    console.log("\n🔍 Testing Model Availability...");

    for (const modelName of candidates) {
        try {
            console.log(`\n➡️  Checking: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello, are you there?");
            const response = await result.response;
            console.log(`✅ SUCCESS! ${modelName} is working.`);
            console.log(`   Response: ${response.text().substring(0, 50)}...`);
            return; // Exit after finding a working model
        } catch (error) {
            console.log(`❌ FAILED: ${modelName}`);
            console.log(`   Error Message: ${error.message}`);
            if (error.status) console.log(`   Status: ${error.status}`);
            if (error.statusText) console.log(`   Status Text: ${error.statusText}`);
        }
    }

    console.log("\n⚠️  All common models failed. Trying to list models via API...");
    // Only works if the SDK supports listModels (newer versions) or we implement it manually if needed.
}

listModels();
