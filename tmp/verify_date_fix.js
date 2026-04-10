const PromptBuilder = require('../helpers/promptBuilder');

const configNoDates = {
    allow_to_display_feed_date: 1,
    features: ["Show Review Date"],
    feeds_data: [
        { id: 1, reviewer_name: "Test User", feed_date: null }
    ]
};

const promptNoDates = PromptBuilder.build('CAROUSEL_SLIDER', configNoDates, ["Show Review Date"]);
console.log("--- PROMPT NO DATES START ---");
console.log(promptNoDates.split('\n').find(l => l.includes('Show Review Date')));
console.log("--- PROMPT NO DATES END ---");

const configWithDates = {
    allow_to_display_feed_date: 1,
    features: ["Show Review Date"],
    feeds_data: [
        { id: 1, reviewer_name: "Test User", feed_date: "Jan 01, 2024" }
    ]
};

const promptWithDates = PromptBuilder.build('CAROUSEL_SLIDER', configWithDates, ["Show Review Date"]);
console.log("\n--- PROMPT WITH DATES START ---");
console.log(promptWithDates.split('\n').find(l => l.includes('Show Review Date')));
console.log("--- PROMPT WITH DATES END ---");
