/**
 * Static invariants over helper source.
 *
 * Page.evaluate and Frame.evaluate accept ONE argument after the function. Passing more
 * throws "Too many arguments" at runtime, and every call site found so far sat behind a
 * .catch that hid the failure: the carousel edge sentinel never ran, and the floating
 * toast never closed its modal. Locator.evaluate is exempt because it passes the element
 * first, so `(el, arg) =>` is correct there.
 *
 * Run: node tests/staticInvariants.test.js
 */

const fs = require('fs');
const path = require('path');

const HELPERS = path.join(__dirname, '..', 'helpers');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

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
            violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${line}  ${m[1]}.evaluate((${params}) => ...)`);
        }
    }
}

console.log('\nStatic invariants\n');
console.log(`Scanned ${scanned} page/frame evaluate call(s).`);

if (violations.length === 0) {
    console.log('  PASS  every page/frame evaluate callback takes at most one parameter');
    console.log('\n1 passed, 0 failed\n');
    process.exit(0);
}

console.error('  FAIL  page/frame evaluate callbacks taking more than one parameter:');
for (const v of violations) console.error(`        ${v}`);
console.error('        Wrap the values in one object: evaluate(({ a, b }) => ..., { a, b })');
console.log('\n0 passed, 1 failed\n');
process.exit(1);
