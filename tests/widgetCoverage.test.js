/**
 * Guard test: every widget type the product ships must be either supported or
 * deliberately exempt. This exists because types 22, 23 and 24 shipped while the
 * framework still knew only 12 types, and an unrecognised type was audited with a
 * generic review-card feature set instead of being skipped.
 *
 * Run: node tests/widgetCoverage.test.js
 *
 * EMBED_CONSTANTS_PATH may point at feedspace-embed-astro to check against the live
 * source of truth. Without it the pinned table below is used, which must be updated
 * whenever src/embed/constants.ts gains a type.
 *
 * BACKEND_WIDGET_MODEL_PATH may likewise point at Feedspace-Backend-3.0
 * app/Models/Widget/Widget.php. The runners receive the backend's type name, not its ID.
 */

const fs = require('fs');
const path = require('path');
const { WidgetDetector, WidgetTypeConstants } = require('../helpers/widgetDetector');
const WidgetConfigLoader = require('../helpers/widgetConfigLoader');

// Mirror of WIDGET_TYPE in feedspace-embed-astro src/embed/constants.ts
const PRODUCT_WIDGET_TYPES = {
    1: 'WOL',
    4: 'CAROUSEL',
    5: 'MASONRY',
    6: 'MARQUEE_STRIPE',
    7: 'AVATAR_GROUP',
    8: 'AVATAR_SLIDER',
    9: 'MARQUEE_UPDOWN',
    10: 'MARQUEE_LEFTRIGHT',
    11: 'FLOATING_CARDS',
    12: 'FORM_NATIVE_NORMAL',
    13: 'FORM_NATIVE_MODAL',
    15: 'SEO_RICH_SNIPPET',
    16: 'AVATAR_CARD_CAROUSEL',
    17: 'CROSS_SLIDER',
    18: 'COMPANY_LOGO_SLIDER',
    19: 'AVATAR_BLOCKS',
    20: 'AI_NATIVE_FORM',
    21: 'AI_NATIVE_FORM_MODAL',
    22: 'FLOATING_BADGE',
    23: 'REVIEW_BADGE',
    24: 'REVIEW_AND_RATINGS'
};

/**
 * Types this framework deliberately does not validate, with the reason.
 * Anything here must be skipped by the runners' coverage-gap guard, not failed.
 */
const EXEMPT = {
    1: 'WOL is a legacy wall-of-love page, not an embeddable review widget',
    12: 'Native form: collects reviews, renders none',
    13: 'Native form (modal): collects reviews, renders none',
    15: 'SEO Rich Snippet is headless and has no visual output to audit',
    20: 'AI Native Form: collects reviews, renders none',
    21: 'AI Native Form (modal): collects reviews, renders none'
};

const results = { passed: 0, failed: 0 };

function check(name, condition, detail) {
    if (condition) {
        results.passed++;
        console.log(`  PASS  ${name}`);
    } else {
        results.failed++;
        console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

function loadProductTypes() {
    const override = process.env.EMBED_CONSTANTS_PATH;
    if (!override) return PRODUCT_WIDGET_TYPES;

    const file = path.resolve(override);
    if (!fs.existsSync(file)) {
        console.warn(`  WARN  EMBED_CONSTANTS_PATH does not exist: ${file}. Using the pinned table.`);
        return PRODUCT_WIDGET_TYPES;
    }

    const src = fs.readFileSync(file, 'utf8');

    // Bound the scan to the WIDGET_TYPE object literal. Reading to end-of-file would
    // ingest any later `identifier: <number>` pair as a phantom widget type.
    const start = src.indexOf('WIDGET_TYPE');
    const open = src.indexOf('{', start);
    const close = src.indexOf('}', open);
    if (start === -1 || open === -1 || close === -1) {
        console.warn('  WARN  Could not locate the WIDGET_TYPE object literal. Using the pinned table.');
        return PRODUCT_WIDGET_TYPES;
    }
    const body = src.slice(open, close);

    // The trailing comma is optional: the LAST entry of the object is usually the newest
    // type, which is precisely the one this guard exists to catch.
    const live = {};
    for (const m of body.matchAll(/(\w+)\s*:\s*(\d+)\s*(?=,|\s*$|\s*\n\s*})/gm)) live[Number(m[2])] = m[1];

    if (Object.keys(live).length === 0) {
        console.warn('  WARN  Parsed no types from the live constants. Using the pinned table.');
        return PRODUCT_WIDGET_TYPES;
    }
    return live;
}

// Mirror of Widget::TYPE in Feedspace-Backend-3.0 app/Models/Widget/Widget.php. The
// on-demand dispatch and the embed-widget-urls API both send this NAME lowercased, never
// the numeric ID, so a type can pass the numeric check and still be skipped in prod.
const BACKEND_WIDGET_TYPE_NAMES = {
    1: 'WALL_OF_LOVE',
    2: 'FEED_FORM_NORMAL',
    3: 'FEED_FORM_MODAL',
    4: 'CAROUSEL_SLIDER',
    5: 'MASONRY',
    6: 'MARQUEE_STRIPE',
    7: 'AVATAR_GROUP',
    8: 'SINGLE_SLIDER',
    9: 'MARQUEE_UPDOWN',
    10: 'MARQUEE_LEFTRIGHT',
    11: 'FLOATING_TOAST',
    12: 'FEED_FORM_NATIVE_NORMAL',
    13: 'FEED_FORM_NATIVE_MODAL',
    15: 'SEO_RICH_SNIPPET',
    16: 'AVATAR_CAROUSEL_SLIDER',
    17: 'CROSS_SLIDER',
    18: 'COMPANY_LOGO_SLIDER',
    19: 'AVATAR_BLOCKS',
    20: 'AI_NATIVE_FORM_NORMAL',
    21: 'AI_NATIVE_FORM_MODAL',
    22: 'FLOATING_BADGE',
    23: 'REVIEW_BADGE',
    24: 'REVIEW_AND_RATINGS'
};

function loadBackendTypeNames() {
    const override = process.env.BACKEND_WIDGET_MODEL_PATH;
    if (!override) return BACKEND_WIDGET_TYPE_NAMES;

    const file = path.resolve(override);
    if (!fs.existsSync(file)) {
        console.warn(`  WARN  BACKEND_WIDGET_MODEL_PATH does not exist: ${file}. Using the pinned table.`);
        return BACKEND_WIDGET_TYPE_NAMES;
    }

    const src = fs.readFileSync(file, 'utf8');
    const start = src.search(/const\s+TYPE\s*=\s*\[/);
    const close = start === -1 ? -1 : src.indexOf('];', start);
    if (start === -1 || close === -1) {
        console.warn('  WARN  Could not locate the Widget::TYPE array. Using the pinned table.');
        return BACKEND_WIDGET_TYPE_NAMES;
    }

    const live = {};
    for (const m of src.slice(start, close).matchAll(/'([A-Z0-9_]+)'\s*=>\s*(\d+)/g)) live[Number(m[2])] = m[1];

    if (Object.keys(live).length === 0) {
        console.warn('  WARN  Parsed no types from Widget::TYPE. Using the pinned table.');
        return BACKEND_WIDGET_TYPE_NAMES;
    }
    return live;
}

console.log('\nWidget coverage guard\n');

const productTypes = loadProductTypes();

console.log('Every product widget type is supported or exempt:');
for (const [idStr, productName] of Object.entries(productTypes)) {
    const id = Number(idStr);
    if (EXEMPT[id]) {
        check(`type ${id} (${productName}) exempt: ${EXEMPT[id]}`, true);
        continue;
    }
    const detected = WidgetDetector.identify({ type: id });
    check(
        `type ${id} (${productName}) resolves to a known widget`,
        Boolean(detected) && detected !== 'Unknown',
        `detector returned "${detected}". Add it to widgetDetector.js, or add an EXEMPT entry explaining why it is not validated.`
    );
}

console.log('\nBackend type names resolve like their numeric IDs:');
for (const [idStr, backendName] of Object.entries(loadBackendTypeNames())) {
    const id = Number(idStr);
    const sent = backendName.toLowerCase();
    const byName = WidgetDetector.identify({ type: sent });
    if (WidgetTypeConstants[id]) {
        check(
            `"${sent}" resolves to ${WidgetTypeConstants[id]}`,
            byName === WidgetTypeConstants[id],
            `detector returned "${byName}", so the runners skip this widget as a coverage gap. Add "${sent.replace(/_/g, '')}" to WidgetAliases.`
        );
    } else {
        check(
            `"${sent}" (type ${id}, not validated) resolves to Unknown`,
            byName === 'Unknown',
            `detector returned "${byName}", so an unvalidated widget would be audited as a different type.`
        );
    }
}

console.log('\nEvery supported widget has a capability config:');
for (const [idStr, typeName] of Object.entries(WidgetTypeConstants)) {
    const configPath = WidgetConfigLoader.resolvePath(typeName);
    check(
        `${typeName} (type ${idStr}) has a Configs entry`,
        Boolean(configPath) && fs.existsSync(configPath),
        `expected ${configPath}. Without it staticFeatures is null and the model auto-detects features, which is how false failures start.`
    );
}

console.log('\nCapability configs are internally consistent:');
for (const typeName of Object.values(WidgetTypeConstants)) {
    const config = WidgetConfigLoader.load(typeName);
    if (!config) continue;

    const features = Array.isArray(config.features) ? config.features : [];
    const unsupported = WidgetConfigLoader.unsupportedFeatures(typeName);
    const popoverOnly = WidgetConfigLoader.popoverOnlyFeatures(typeName);

    const contradictory = features.filter(f => unsupported.includes(f));
    check(
        `${typeName}: no feature is both tested and unsupported`,
        contradictory.length === 0,
        `both listed: ${contradictory.join(', ')}`
    );

    const orphaned = popoverOnly.filter(f => !features.includes(f));
    check(
        `${typeName}: every popover-only feature is also in features`,
        orphaned.length === 0,
        `popover-only but never tested: ${orphaned.join(', ')}. It would silently never be checked.`
    );
}

console.log('\nEvery widget with popover-only features dispatches an interaction helper:');
const dispatchSource = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'playwrightHelper.js'), 'utf8');
for (const typeName of new Set(Object.values(WidgetTypeConstants))) {
    const popoverOnly = WidgetConfigLoader.popoverOnlyFeatures(typeName);
    if (popoverOnly.length === 0) continue;
    check(
        `${typeName}: playwrightHelper dispatches a helper to open its popover`,
        dispatchSource.includes(`normalizedType === '${typeName}'`),
        `${popoverOnly.join(', ')} are popover-only, but no helper branch exists for ${typeName}, so they can only ever be NOT_APPLICABLE.`
    );
}

console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
