/**
 * Engine-level regression for AIEngine.processResults.
 *
 * The false-positive corpus proves the prompt says the right things. This proves the
 * post-processor does the right things with a model's answer: synthetic model output goes
 * in, the real processResults runs, and the verdict is asserted. No source greps.
 *
 * Offline: the engine is constructed without GEMINI_API_KEY, so no request is ever made.
 * Run: node tests/aiEngineProcessResults.test.js
 */

delete process.env.GEMINI_API_KEY;

const AIEngine = require('../helpers/aiEngine');
const { isEmptyWidgetData } = require('../helpers/widgetData');

const results = { passed: 0, failed: 0 };

function check(name, condition, detail) {
    if (condition) {
        results.passed++;
        console.log(`  PASS  ${name}`);
    } else {
        results.failed++;
        console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
    }
}

const CATEGORIES = [
    'A. LAYOUT & SPACING',
    'B. ELEMENT CONTAINMENT',
    'C. CONTENT & TEXT RENDERING',
    'D. AVATAR RENDERING',
    'E. MEDIA & IMAGES',
    'F. THEME & COLOR VISIBILITY',
    'G. POPUPS & MODALS'
];

function modelAnswer(reasoning, features) {
    return {
        overall_status: 'PASS',
        analysis_message: reasoning,
        feature_results: features.map(feature => ({
            feature, ui_status: 'Visible', config_status: 'Visible', status: 'PASS', issue: '', remarks: ''
        })),
        aesthetic_results: CATEGORIES.map(category => ({ category, status: 'PASS', issue: '', severity: 'NONE' }))
    };
}

const FEED = {
    id: 101, app_user_name: 'Ann Lee', rating: 5, comment: 'Great service',
    social_platform: { name: 'Google', slug: 'google' }
};

const populatedConfig = () => ({ widget_customization: { is_show_ratings: 1 }, widget_data: { feeds_data: [FEED] } });

const engine = new AIEngine();

async function judge(reasoning, { config = populatedConfig(), warnings = [], type = 'CAROUSEL_SLIDER', features = ['Show Review Ratings'] } = {}) {
    const answer = modelAnswer(reasoning, features);
    return engine.processResults(answer, config, type, features, warnings);
}

const category = (res, letter) => (res.aesthetic_results || []).find(r => r.category.startsWith(`${letter}.`));
const feature = (res, name) => (res.feature_results || []).find(f => f.feature === name);
const describe = (res, letter) => {
    const c = category(res, letter);
    return `overall=${res.overall_status}, ${letter}=${c ? c.status : 'missing'}${c && c.issue ? ` (${c.issue.slice(0, 90)})` : ''}`;
};

(async () => {
    console.log('\nAIEngine.processResults regression\n');

    console.log('Baseline:');
    {
        const r = await judge('Reviewed every screenshot; everything renders as configured.');
        check('a clean answer stays PASS', r.overall_status === 'PASS', describe(r, 'A'));
    }

    console.log('\nGeometric warnings (cards 10224702609, 10246278068):');
    {
        const r = await judge('Reviewed every screenshot.', {
            warnings: ['TRUTH DATA: FAIL_CONTAINER_CLIPPED detected. Popup 1 is sliced by parent container (wrap). The text is being cut off vertically.']
        });
        check('an authoritative DOM fact still forces FAIL', r.overall_status === 'FAIL', describe(r, 'A'));
    }
    {
        const r = await judge('Reviewed every screenshot.', {
            warnings: ['ADVISORY: Only 60% of popup 1 intersects the capture viewport. PARTIAL overlap; this measures the CAPTURE, not the widget.']
        });
        check('an ADVISORY measurement does not force FAIL', r.overall_status === 'PASS', describe(r, 'G'));
    }

    console.log('\nReasoning overrides (cards 10206673133, 10207208742, 10211057218):');
    {
        const card5 = 'In part1.png there are four full cards visible and a partially visible card to the far right. '
            + 'The nature of a carousel slider means that cards at the edges are often partially visible/cut off. '
            + 'This is a PASS for carousel sliders if the main content area is clear.';
        const r = await judge(card5);
        check("the model's own PASS verdict is not flipped to FAIL", category(r, 'A').status === 'PASS' && r.overall_status === 'PASS', describe(r, 'A'));
    }
    {
        const r = await judge('The cards look like they are bleeding at the edges.');
        check('an uncited defect claim cannot flip a PASS', category(r, 'A').status === 'PASS', describe(r, 'A'));
    }
    {
        const r = await judge('In part2.png [Card: Ann Lee] the card is bleeding off the bottom edge.');
        check('a cited defect claim still flips layout to FAIL', category(r, 'A').status === 'FAIL', describe(r, 'A'));
    }
    {
        const r = await judge('In part2.png [Card: Ann Lee] the card bottom is FAIL_LAYOUT_CLIPPED and this looks unintentional.');
        check('"unintentional" does not clear a hard FAIL token', category(r, 'A').status === 'FAIL', describe(r, 'A'));
    }

    console.log('\nEmpty-widget rule (Review Badge payload shape):');
    {
        const badgeData = {
            feeds: Array.from({ length: 11 }, (_, i) => ({ id: i + 1 })),
            feeds_data: [],
            badge_sources: [{ id: 1 }, { id: 2 }]
        };
        check('a Review Badge payload is not empty', !isEmptyWidgetData(badgeData));

        const r = await judge('Reviewed every screenshot.', {
            config: { widget_customization: {}, widget_data: badgeData },
            type: 'REVIEW_BADGE'
        });
        const ratings = feature(r, 'Show Review Ratings');
        check(
            'processResults does not force an Empty State onto the Review Badge',
            Boolean(ratings) && ratings.status === 'PASS' && !/Empty State/i.test(ratings.issue || ''),
            ratings ? `status=${ratings.status}, issue=${ratings.issue}` : 'feature missing from results'
        );
    }
    {
        const emptyData = { feeds: [], feeds_data: [] };
        check('a payload whose every list is empty is empty', isEmptyWidgetData(emptyData));

        const r = await judge('Reviewed every screenshot.', { config: { widget_customization: {}, widget_data: emptyData } });
        const ratings = feature(r, 'Show Review Ratings');
        check(
            'a genuinely empty widget is still an Empty State',
            Boolean(ratings) && ratings.status === 'FAIL' && /Empty State/i.test(ratings.issue || ''),
            ratings ? `status=${ratings.status}, issue=${ratings.issue}` : 'feature missing from results'
        );
    }
    check('missing widget_data is empty', isEmptyWidgetData(undefined));
    check('a payload with no review lists at all is not assumed empty', !isEmptyWidgetData({ layout: 'grid' }));

    console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
    process.exit(results.failed > 0 ? 1 : 0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
