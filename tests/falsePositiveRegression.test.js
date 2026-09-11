/**
 * False-positive regression corpus.
 *
 * Every case is taken from a real false FAIL: a [Widget FAIL] card that reached Done on
 * the Feedspace.io board and was triaged by a human as "the widget is fine, the checker
 * is wrong", or a verdict from a real-Gemini sample run that was checked the same way.
 * Each asserts that the framework no longer manufactures that failure.
 *
 * Run: node tests/falsePositiveRegression.test.js
 *
 * Cases are pure and offline: they exercise the prompt builder and the reasoning
 * scanner directly, with no browser and no Gemini call.
 */

const fs = require('fs');
const path = require('path');
const PromptBuilder = require('../helpers/promptBuilder');

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

function featuresFor(configFile) {
    const p = path.join(process.cwd(), 'Configs', `${configFile}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf8')).features;
}

function buildPrompt(widgetType, configFile, customization, feeds) {
    const config = {
        widget_customization: customization || {},
        feeds_data: feeds || [{ id: 1, app_user_name: 'Test User', rating: 5, comment: 'Great' }]
    };
    return PromptBuilder.build(widgetType, config, featuresFor(configFile), true, []);
}

// Imported, never re-declared: a hand-copied list would let the suite stay green
// while the production rule regresses, which is exactly what this corpus exists to stop.
const { hasClearingVerdict, hasCitation } = require('../helpers/reasoningVerdict');

/** The line the model actually produced, as recorded on each card. */
function reasoningVerdict(line) {
    return hasClearingVerdict(line) ? 'CLEARED' : 'ADMISSION';
}

console.log('\nFalse-positive regression corpus\n');

// ── Card 10166965764: strip slider does not show the date on animated cards ──
console.log('Card 10166965764 - MARQUEE_STRIPE, "Show Review Date: UI Absent, Config Visible":');
{
    const prompt = buildPrompt('MARQUEE_STRIPE', 'stripSliderFeature', { allow_to_display_feed_date: true });
    const line = prompt.split('\n').find(l => l.startsWith('- **Show Review Date**')) || '';
    check(
        'Show Review Date is marked popover-only for the strip slider',
        line.includes('POPOVER-ONLY'),
        `line was: ${line}`
    );
    check(
        'the model is told to report NOT_APPLICABLE rather than FAIL without a popover shot',
        line.includes('NOT_APPLICABLE'),
        `line was: ${line}`
    );
}

// ── Card 10260035764: company logo slider shows none of these on the strip ──
console.log('\nCard 10260035764 - COMPANY_LOGO_SLIDER, date/ratings/icons "absent":');
{
    const prompt = buildPrompt('COMPANY_LOGO_SLIDER', 'companyLogoSliderFeature', {
        allow_to_display_feed_date: true, is_show_ratings: true, show_platform_icon: true
    });
    for (const feature of ['Show Review Date', 'Show Review Ratings', 'Show Social Platform Icon']) {
        const line = prompt.split('\n').find(l => l.startsWith(`- **${feature}**`)) || '';
        check(`${feature} is popover-only for the logo strip`, line.includes('POPOVER-ONLY'), `line was: ${line}`);
    }
}

// ── Card 10253013311: show_platform_icon absent, product default is true ──
console.log('\nCard 10253013311 - MARQUEE_LEFTRIGHT, icon visible but "config absent":');
{
    const prompt = buildPrompt('MARQUEE_LEFTRIGHT', 'horizontalScrollFeature', {});
    const line = prompt.split('\n').find(l => l.startsWith('- **Show Social Platform Icon**')) || '';
    check(
        'a missing show_platform_icon resolves to Visible, not Absent',
        line.includes('Config Status: Visible'),
        `line was: ${line}. Absent here reports the widget's correct behaviour as a regression.`
    );
}

// ── Card 10211057218: carousel edge slide, model itself said PASS ──
console.log('\nCard 10211057218 - CAROUSEL_SLIDER, partially visible edge card:');
{
    const line = 'In part1.png there are four full cards visible and a partially visible card to the far right. '
        + 'The nature of a carousel slider means that cards at the edges are often partially visible/cut off. '
        + 'This is a PASS for carousel sliders if the main content area is clear.';
    check(
        "the model's own PASS verdict clears the defect keywords in the same line",
        reasoningVerdict(line) === 'CLEARED',
        'the override would flip this PASS to a CRITICAL layout failure'
    );

    const helper = fs.readFileSync(path.join(process.cwd(), 'helpers/interactiveWidgets/carouselSliderHelper.js'), 'utf8');
    check(
        'the carousel sentinel no longer flags horizontal overflow',
        !helper.includes('FAIL_RIGHT_EDGE_CLIPPED') && !helper.includes('FAIL_LEFT_EDGE_CLIPPED'),
        'partially visible edge slides are a carousel design property, not a defect'
    );
    check(
        'the carousel freezes motion before measuring and capturing',
        helper.includes('MotionFreeze'),
        'unfrozen captures land mid-transit, which is what this card recorded'
    );
    check(
        'the freeze waits for the transition to finish BEFORE pausing',
        /waitForTimeout\(400\);\s*\n\s*const frozen = await MotionFreeze\.apply/.test(helper),
        'pausing first then waiting is dead time: a track paused mid-transit stays mid-transit'
    );

    const freeze = fs.readFileSync(path.join(process.cwd(), 'helpers/motionFreeze.js'), 'utf8');
    check(
        'the freeze is injected into shadow roots, not only the document',
        freeze.includes('ShadowRoot') && freeze.includes('_injectIntoShadowRoots'),
        'widgets render in an open shadow root and animation-play-state is not inherited, so a page-level style never reaches the marquee track'
    );
}

// ── Cards 10206673133 and 10207208742: sharpness false positives ──
console.log('\nCards 10206673133 / 10207208742 - avatar and video thumbnail "blur":');
{
    const promptSrc = fs.readFileSync(path.join(process.cwd(), 'helpers/promptBuilder.js'), 'utf8');
    check(
        'the rule making any photo softer than vector text a defect is gone',
        !promptSrc.includes('Any image softer than the vector text is a defect'),
        'a rasterised photo can never match vector text, so this rule always failed'
    );
    check(
        'the razor-sharp-grain rule is gone',
        !promptSrc.includes("razor-sharp grain matching the 'l' in the name"),
        'this made a FAIL unavoidable for every JPEG avatar'
    );
    check(
        'intentional fades and gradient masks are excluded from the sharpness audit',
        promptSrc.includes('INTENTIONAL EFFECT'),
        'the customer fade on crashup.graphy.com was read as blur'
    );
    check(
        'video poster frames are excluded from softness failures',
        promptSrc.includes('VIDEO THUMBNAIL'),
        'poster frames are compressed stills and are expected to be softer'
    );
    // Real-Gemini run 11-09-2026 (S-5): three more copies of the same rule were still live.
    for (const [rule, text] of [
        ["the avatar audit's RAZOR COMPARISON", 'benchmark the avatar pixels against the razor-sharp vector text'],
        ['its edge-width FAIL trigger', 'Avatar Edge Width > Text Edge Width'],
        ['the central-review ZERO TOLERANCE rule', 'Benchmark the image texture against the text']
    ]) {
        check(`${rule} is gone`, !promptSrc.includes(text), 'a photo always has wider edges than 1px vector text, so this failed sharp avatars');
    }
}

// ── Cards 10224702609 and 10246278068: popover clipped at the capture boundary ──
console.log('\nCards 10224702609 / 10246278068 - avatar group popover "sliced":');
{
    const helper = fs.readFileSync(path.join(process.cwd(), 'helpers/interactiveWidgets/avatarGroupHelper.js'), 'utf8');
    check(
        'proximity to the viewport edge no longer produces a hard failure',
        !helper.includes('if (distToBottom < 20)'),
        'the popover is viewport-anchored by design and legitimately rests near the edge'
    );
    check(
        'the popover position is settled before it is measured',
        helper.includes('_settlePopupBox'),
        'measuring immediately after the click catches the popover mid-flip'
    );
    check(
        'boundary findings are advisory rather than forced failures',
        helper.includes('ADVISORY:'),
        'a forced FAIL cannot be overruled by the model looking at the screenshot'
    );

    const engine = fs.readFileSync(path.join(process.cwd(), 'helpers/aiEngine.js'), 'utf8');
    check(
        'advisory measurements are excluded from the forced-FAIL filter',
        engine.includes("!msg.startsWith('ADVISORY:')"),
        'otherwise every advisory still becomes a CRITICAL card'
    );
}

// ── Card 10246278068: findings absent from the screenshots ──
console.log('\nCard 10246278068 - "none of it is present in the screenshots":');
{
    const uncited = 'The popup appears squeezed and the layout looks cramped.';
    const cited = 'In part4.png the popup [Card: Anna] is sliced at the bottom edge.';
    check('an uncited defect claim cannot flip a PASS', !hasCitation(uncited));
    check('a claim naming a screenshot and card still can', hasCitation(cited));

    // The clearing guard must not swallow genuine findings that sit beside a design note
    // or describe a different element. Each of these was a real over-suppression.
    const mustNotClear = [
        'The card bottom is FAIL_LAYOUT_CLIPPED and this looks unintentional.',
        'The avatar is blurry; the text rendering is fine.',
        'No issue with the branding, however the popup is sliced at the bottom.',
        'The rows are surfaceless by design, but in part2.png the text is FAIL_CONTENT_TRUNCATED.'
    ];
    for (const line of mustNotClear) {
        check(
            `a real finding survives the clearing guard: "${line.slice(0, 52)}..."`,
            reasoningVerdict(line) === 'ADMISSION',
            'a vague phrase or a longer word ("unintentional" contains "intentional") suppressed a genuine defect'
        );
    }
    check(
        "the model's own explicit PASS verdict still clears",
        reasoningVerdict('cards at the edges are cut off. This is a PASS for carousel sliders.') === 'CLEARED'
    );
}

// ── Card 10214516244: two reviews by the same reviewer ──
console.log('\nCard 10214516244 - MARQUEE_UPDOWN, "ratings visible despite rating of 0":');
{
    const prompt = buildPrompt('MARQUEE_UPDOWN', 'verticalScrollFeature', {}, [
        { id: 11, app_user_name: 'Omri Ben-Shoham', rating: 5, comment: 'first' },
        { id: 12, app_user_name: 'Omri Ben-Shoham', rating: 0, comment: 'second' },
        { id: 13, app_user_name: 'Someone Else', rating: 4, comment: 'third' }
    ]);
    check(
        'duplicate reviewer names are called out explicitly',
        prompt.includes('DUPLICATE REVIEWER NAMES'),
        'without this the model binds a rendered card to the wrong feed record'
    );
    check(
        'the ambiguous reviewer is directed to bind by tracking id',
        prompt.includes('AMBIGUOUS') && prompt.includes('Tracking ID'),
        'name and initials cannot identify a reviewer with two reviews'
    );
    check(
        'the unambiguous reviewer keeps the plain mapping hint',
        prompt.includes("name 'Someone Else'"),
        'only colliding names should be downgraded'
    );
}

// ── Card 10180368782: expected type came from bad data ──
console.log('\nCard 10180368782 - expected FLOATING_TOAST, page embeds SINGLE_SLIDER:');
{
    const pw = fs.readFileSync(path.join(process.cwd(), 'helpers/playwrightHelper.js'), 'utf8');
    check(
        'a wrong expected type is reported as a test data mismatch',
        pw.includes('Test Data Mismatch'),
        'reporting it as a configuration mismatch routes a data bug to the embed team'
    );

    const BasecampCardHelper = require('../helpers/basecampCardHelper');
    const classify = Object.create(BasecampCardHelper.prototype);
    check(
        'it classifies separately from configuration mismatch',
        classify.classify({ status: 'FAIL', error: 'Test Data Mismatch: Expected widget type FLOATING_TOAST, but the page embeds SINGLE_SLIDER.' }) === 'test data mismatch'
    );
    check(
        'an unsupported widget type files no card at all',
        classify.classify({ status: 'SKIPPED', error: 'Coverage Gap: widget type ID 20 has no detector entry or capability config. Not validated.' }) === null,
        'a coverage gap is not a product defect'
    );
}

// ── Real-Gemini sample run, 11-09-2026: false FAILs caught before they reached a card ──
console.log('\nReal-Gemini run 11-09-2026 - FLOATING_BADGE, "the bar overlaps the review panel":');
{
    const prompt = buildPrompt('FLOATING_BADGE', 'floatingBadgeFeature', {});
    check(
        'the prompt says a card cut where the list meets the bar is scrolled, not covered',
        prompt.includes('SCROLL EDGE IS NOT OVERLAP'),
        'both real runs failed up to six categories on the list scroll edge'
    );

    const FloatingBadgeHelper = require('../helpers/interactiveWidgets/floatingBadgeHelper');
    const fact = typeof FloatingBadgeHelper._scrollEdgeFact === 'function'
        ? FloatingBadgeHelper._scrollEdgeFact({ scrollHeight: 1813, clientHeight: 520 }, [
            ['the first open-panel screenshot', ['DIXIT DONDA']],
            ['the scrolled screenshot', ['JOHN CUTLER', 'PARTIAL FAIL_ZONE']]
        ])
        : '';
    check('the helper states the measured scroll edge as a DOM fact', fact.startsWith('DOM_TRUTH_PANEL_SCROLL_EDGE'));
    check(
        'it names the card each screenshot cuts, which the model otherwise called truncated',
        fact.includes('Dixit Donda in the first open-panel screenshot'),
        `fact was: ${fact.slice(0, 160)}`
    );
    check(
        'an all-caps reviewer name cannot trip the forced-FAIL filter',
        !['FAIL_', '_EDGE_CLIPPED', 'PARTIAL', 'CUT'].some(t => fact.includes(t)),
        `fact was: ${fact.slice(0, 160)}`
    );
}

console.log('\nReal-Gemini run 11-09-2026 - CROSS_SLIDER, "Feedspace Branding absent":');
{
    const prompt = buildPrompt('CROSS_SLIDER', 'crossSliderFeature', {});
    const line = prompt.split('\n').find(l => l.startsWith('- **Feedspace Branding**') && l.includes('Config Status')) || '';
    check('branding is popover-only for the cross slider', line.includes('POPOVER-ONLY'), `line was: ${line}`);

    const start = prompt.indexOf('**RULE 16: BRANDING');
    const rule16 = start === -1 ? '' : prompt.slice(start, prompt.indexOf('**RULE 17', start));
    check(
        "RULE 16 recognises the shipped pill's resting text",
        rule16.includes('Want to create your widget?'),
        'the model rejected the real pill because RULE 16 demanded the old wording'
    );

    const promptSrc = fs.readFileSync(path.join(process.cwd(), 'helpers/promptBuilder.js'), 'utf8');
    check(
        'no widget block still describes the branding as only the old lightning-bolt pill',
        !promptSrc.includes("It is a white pill with 'Capture reviews with Feedspace'"),
        'the Avatar Blocks note repeated the old signature'
    );
}

console.log('\nReal-Gemini run 11-09-2026 - AVATAR_GROUP, authored ellipsis and screenshots never sent:');
{
    const { MAX_IMAGES } = require('../helpers/imageBudget');
    const AvatarGroupHelper = require('../helpers/interactiveWidgets/avatarGroupHelper');
    const config = { widget_customization: {}, feeds_data: [{ id: 1, app_user_name: 'Test User', rating: 5, comment: 'Great' }] };
    const prompt = PromptBuilder.build('AVATAR_GROUP', config, featuresFor('avatarGroupFeature'), true, [], MAX_IMAGES);
    check(
        'the prompt says how many screenshots were sent',
        prompt.includes(`exactly ${MAX_IMAGES} screenshots, part1 to part${MAX_IMAGES}`),
        'the model claimed 42 screenshots when 14 were sent, and cited ones it never received'
    );
    check('and no longer hardcodes a range', !prompt.includes('Part 1 to Part 14'), 'the range must follow the count actually sent');
    check(
        'an ellipsis in text the DOM shows in full is not truncation',
        prompt.includes('**AUTHORED ELLIPSIS**'),
        'a review whose source text ends in "..." failed as truncated and for a missing Read More'
    );

    const fact = AvatarGroupHelper._endTextFact('Ayush', 'at an amazing pace...', true);
    check(
        "the popup fact quotes the review text and calls its ellipsis the review's own",
        fact.includes('"at an amazing pace..."') && fact.includes('part of the review text itself'),
        `fact was: ${fact}`
    );
    const clamped = AvatarGroupHelper._endTextFact('Ayush', 'at an amazing pace...', false);
    check('a clamped popup gets no such note', !clamped.includes('in full') && !clamped.includes('review text itself'), `fact was: ${clamped}`);
    check(
        'the review text selector no longer matches any class containing "text"',
        AvatarGroupHelper.REVIEW_TEXT.includes('.feedspace-review-text') && !AvatarGroupHelper.REVIEW_TEXT.includes('[class*="text"]'),
        'it matched the name element, so every DOM_END_TEXT fact quoted the reviewer name'
    );
    const loud = AvatarGroupHelper._endTextFact('JOHN CUTLER', 'A PARTIAL FAIL_ZONE CUT', true);
    check(
        'quoted names and review words cannot trip the forced-FAIL filter',
        !['FAIL_', '_EDGE_CLIPPED', 'PARTIAL', 'CUT'].some(t => loud.includes(t)),
        `fact was: ${loud}`
    );
    const twoLine = AvatarGroupHelper._endTextFact('Sean Lues\nManaging Director at Journeys Worldwide', 'on board as well.', true);
    check(
        'a name element that also holds the role gives a one-line fact naming only the reviewer',
        !twoLine.includes('\n') && twoLine.includes('for Sean Lues is') && !twoLine.includes('Managing Director'),
        `fact was: ${twoLine}`
    );
    const icons = AvatarGroupHelper._popupIconsFact(['Ayush', 'JOHN CUTLER'], ['Candida Bradley']);
    check(
        'the popup icon fact uses its token, names who shows an icon, and cannot trip the forced-FAIL filter',
        icons.startsWith('DOM_TRUTH_POPUP_ICONS_PRESENT') && icons.includes('for: Ayush') && !['FAIL_', '_EDGE_CLIPPED', 'PARTIAL', 'CUT'].some(t => icons.includes(t)),
        `fact was: ${icons}`
    );
    check(
        'the Read More fact uses the token the engine honours',
        AvatarGroupHelper._readMoreFact(6).startsWith('DOM_TRUTH_READ_MORE_NOT_NEEDED'),
        AvatarGroupHelper._readMoreFact(6)
    );

    const engineSrc = fs.readFileSync(path.join(process.cwd(), 'helpers/aiEngine.js'), 'utf8');
    const helperSrc = fs.readFileSync(path.join(process.cwd(), 'helpers/interactiveWidgets/avatarGroupHelper.js'), 'utf8');
    check(
        'the engine trims to the shared budget, not a literal',
        engineSrc.includes('buffers.slice(0, MAX_IMAGES)') && !engineSrc.includes('slice(0, 14)'),
        'the helper and the engine must agree on how many screenshots reach the model'
    );
    check(
        'the Avatar Group helper stops opening popups when that budget is full',
        helperSrc.includes('screenshotBuffers.length + 2 > maxShots'),
        'popups past the budget were opened and described, but never sent'
    );
    const pwSrc = fs.readFileSync(path.join(process.cwd(), 'helpers/playwrightHelper.js'), 'utf8');
    check(
        'and its budget leaves room for the viewport and branding shots taken after it',
        pwSrc.includes('MAX_IMAGES - screenshotBuffers.length - trailingShots'),
        'the final viewport shot, and the branding shot RULE 16 reads, were trimmed as the 15th image'
    );
    check(
        "the helper waits for a popup's images before capturing it",
        helperSrc.includes("img.addEventListener('load'"),
        'the source icon is a lazy image, and one capture was taken before it loaded'
    );
}

console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
