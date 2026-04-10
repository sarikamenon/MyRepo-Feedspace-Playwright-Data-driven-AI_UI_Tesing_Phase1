const PromptBuilder = require('../helpers/promptBuilder');

const configVisible = {
    hideBranding: 0,
    features: ["Feedspace Branding"],
};

const promptVisible = PromptBuilder.build('CAROUSEL_SLIDER', configVisible, ["Feedspace Branding"]);
console.log("--- HIDE_BRANDING: 0 START ---");
console.log(promptVisible.split('\n').find(l => l.includes('Feedspace Branding')));
console.log("--- HIDE_BRANDING: 0 END ---");

const configAbsent = {
    hideBranding: 1,
    features: ["Feedspace Branding"],
};

const promptAbsent = PromptBuilder.build('CAROUSEL_SLIDER', configAbsent, ["Feedspace Branding"]);
console.log("\n--- HIDE_BRANDING: 1 START ---");
console.log(promptAbsent.split('\n').find(l => l.includes('Feedspace Branding')));
console.log("--- HIDE_BRANDING: 1 END ---");
