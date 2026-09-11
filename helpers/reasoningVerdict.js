/**
 * Shared rules for reading the model's free-text reasoning.
 *
 * These live in their own module so the regression corpus can assert against the
 * SAME definitions the engine uses. A test that hand-copies these lists stays green
 * while the production logic regresses, which defeats the point of the corpus.
 *
 * (aiEngine.js pulls in @google/generative-ai at require time, so a test cannot
 * import it directly to reach these.)
 */

/**
 * Verdict forms that CLEAR a defect the model named earlier in the same line.
 *
 * Deliberately narrow. Vague phrases ("is fine", "no issue", "acceptable", bare
 * "intentional") match a DIFFERENT element in the same sentence, or a longer word:
 * "unintentional" contains "intentional", and "the text rendering is fine" would
 * clear a blurry avatar named in the same line. Only explicit verdict forms belong here.
 */
const CLEARING_VERDICTS = [
    'is a pass', '= pass', '→ pass', '-> pass', 'verdict: pass',
    'counts as a pass', 'should be a pass', 'considered a pass',
    'by design', 'as designed', 'is intentional', 'not a defect',
    'not a failure', 'expected behaviour', 'expected behavior',
    'correct behaviour', 'correct behavior', 'pass_force'
];

/** A hard defect token is a real finding and outranks any design note on the same line. */
const HARD_TOKEN = /\b(FAIL_[A-Z_]+|CRITICAL_[A-Z_]+)\b/;

/**
 * Something locatable the reader can check: a named screenshot, card, element or
 * position. An override may only flip a PASS when the reasoning cites one of these,
 * because a bare defect word in prose is an opinion, not a located finding.
 */
const CITATION = /(part\s*\d+\s*\.?\s*png|screenshot\s*\d+|\[(?:Card|Element|Position)\s*:?[^\]]*\]|\bimage\s*\d+\b)/i;

function hasClearingVerdict(text) {
    if (!text) return false;
    if (HARD_TOKEN.test(text)) return false;
    const low = String(text).toLowerCase();
    return CLEARING_VERDICTS.some(v => low.includes(v));
}

function hasCitation(text) {
    return Boolean(text) && CITATION.test(String(text));
}

module.exports = { CLEARING_VERDICTS, HARD_TOKEN, CITATION, hasClearingVerdict, hasCitation };
