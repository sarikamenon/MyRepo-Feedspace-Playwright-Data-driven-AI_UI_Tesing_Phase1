/**
 * How many screenshots one Gemini request carries. The engine trims to this to avoid 400 errors
 * (request size or image count), and a helper that captures many shots stops at it, so every
 * DOM fact it emits is about a screenshot the model actually receives.
 */
module.exports = { MAX_IMAGES: 14 };
