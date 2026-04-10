const PromptBuilder = require('../helpers/promptBuilder');

const configAllManual = {
    show_platform_icon: 1,
    features: ["Show Social Platform Icon"],
    feeds_data: [
        { id: 1, social_platform: "manual_video_review" },
        { id: 2, social_platform: { slug: "text_feed" } }
    ]
};

const promptAllManual = PromptBuilder.build('CAROUSEL_SLIDER', configAllManual, ["Show Social Platform Icon"]);
console.log("--- ALL MANUAL START ---");
console.log(promptAllManual.split('\n').find(l => l.includes('Show Social Platform Icon')));
console.log("--- ALL MANUAL END ---");

const configMixedYoutube = {
    show_platform_icon: 1,
    features: ["Show Social Platform Icon"],
    feeds_data: [
        { id: 1, social_platform: "manual_video_review" },
        { id: 2, social_platform: "youtube.com" }
    ]
};

const promptMixedYoutube = PromptBuilder.build('CAROUSEL_SLIDER', configMixedYoutube, ["Show Social Platform Icon"]);
console.log("\n--- MIXED YOUTUBE START ---");
console.log(promptMixedYoutube.split('\n').find(l => l.includes('Show Social Platform Icon')));
console.log("--- MIXED YOUTUBE END ---");

const configMixedBooking = {
    show_platform_icon: 1,
    features: ["Show Social Platform Icon"],
    feeds_data: [
        { id: 1, social_platform: { slug: "booking.com", name: "Booking" } }
    ]
};

const promptMixedBooking = PromptBuilder.build('CAROUSEL_SLIDER', configMixedBooking, ["Show Social Platform Icon"]);
console.log("\n--- MIXED BOOKING START ---");
console.log(promptMixedBooking.split('\n').find(l => l.includes('Show Social Platform Icon')));
console.log("--- MIXED BOOKING END ---");
