/**
 * Static invariants over helper source.
 *
 * Page.evaluate and Frame.evaluate accept ONE argument after the function. Passing more
 * throws "Too many arguments" at runtime, and every call site found so far sat behind a
 * .catch that hid the failure: the carousel edge sentinel never ran, and the floating
 * toast never closed its modal. Locator.evaluate is exempt because it passes the element
 * first, so `(el, arg) =>` is correct there.
 *
 * Every DOM_TRUTH token the engine keys on must also be emitted somewhere. The social-icon
 * rescue matched "DOM_TRUTH: Platform icons" while the sniff wrote "DOM_TRUTH: Social
 * Platform Icons", so it never fired. Whether a token means what the engine assumes is a
 * behaviour question; tests/aiEngineProcessResults.test.js covers that.
 *
 * Run: node tests/staticInvariants.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELPERS = path.join(ROOT, 'helpers');
const ENGINE = path.join(HELPERS, 'aiEngine.js');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const results = { passed: 0, failed: 0 };

function check(name, problems, hint) {
    if (problems.length === 0) {
        results.passed++;
        console.log(`  PASS  ${name}`);
        return;
    }
    results.failed++;
    console.error(`  FAIL  ${name}:`);
    for (const p of problems) console.error(`        ${p}`);
    if (hint) console.error(`        ${hint}`);
}

console.log('\nStatic invariants\n');

// Receivers that are a Page or Frame in this codebase. Locators are deliberately absent.
const CALL = /\b(page|frame|context|interactionContext|locatorFrame|targetFrame|activeFrame|currentFrame|this\.page)\.evaluate\(\s*(?:async\s*)?\(\s*([^)]*)\)\s*=>/g;

const violations = [];
let scanned = 0;
for (const file of walk(HELPERS)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(CALL)) {
        scanned++;
        const params = m[2].trim();
        if (!params) continue;
        const isDestructured = params.startsWith('{') || params.startsWith('[');
        const count = isDestructured ? 1 : params.split(',').filter(p => p.trim()).length;
        if (count > 1) {
            const line = src.slice(0, m.index).split('\n').length;
            violations.push(`${path.relative(ROOT, file)}:${line}  ${m[1]}.evaluate((${params}) => ...)`);
        }
    }
}
console.log(`Scanned ${scanned} page/frame evaluate call(s).`);
check('every page/frame evaluate callback takes at most one parameter', violations,
    'Wrap the values in one object: evaluate(({ a, b }) => ..., { a, b })');

/** DOM_TRUTH tokens an engine source keys on that no helper or runner emits. */
function unsentTokens(engineSrc) {
    const tokens = [...new Set([...engineSrc.matchAll(/includes\(\s*['"](DOM_TRUTH[^'"]*)['"]\s*\)/g)].map(m => m[1]))];
    const producers = walk(HELPERS).filter(f => f !== ENGINE).concat(walk(path.join(ROOT, 'runners')))
        .map(f => fs.readFileSync(f, 'utf8')).join('\n');
    return { tokens, unsent: tokens.filter(t => !producers.includes(t)) };
}

const { tokens, unsent } = unsentTokens(fs.readFileSync(ENGINE, 'utf8'));
console.log(`Checked ${tokens.length} DOM_TRUTH token(s) the engine keys on.`);
check('every DOM_TRUTH token the engine keys on is emitted by a helper or runner',
    unsent.map(t => `"${t}" is matched in helpers/aiEngine.js but never emitted`),
    'An override keyed on a token nobody sends can never fire.');

console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
