const PromptBuilder = require('../helpers/promptBuilder');

const config = {
    widget_customization: {
        allow_to_remove_branding: "0" // Branding should be Visible
    },
    features: ["Feedspace Branding"]
};

const prompt = PromptBuilder.build('CAROUSEL_SLIDER', config, ["Feedspace Branding"]);
console.log("--- PROMPT START ---");
console.log(prompt);
console.log("--- PROMPT END ---");

const configHidden = {
    widget_customization: {
        allow_to_remove_branding: "1" // Branding should be Absent
    },
    features: ["Feedspace Branding"]
};

const promptHidden = PromptBuilder.build('CAROUSEL_SLIDER', configHidden, ["Feedspace Branding"]);
console.log("\n--- HIDDEN PROMPT START ---");
console.log(promptHidden);
console.log("--- HIDDEN PROMPT END ---");
