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

    console.log('\nBranding a widget renders only in its modal (Review Badge, Cross Slider):');
    {
        const BRANDING_ABSENT = 'DOM_TRUTH_BRANDING_ABSENT: Feedspace branding is absent from the DOM.';
        const badgeConfig = { widget_customization: {}, widget_data: { feeds: [{ id: 1 }], badge_sources: [{ id: 1 }] } };
        const brandingVerdict = async (type, ui_status, status) => {
            const answer = modelAnswer('Reviewed every screenshot.', ['Feedspace Branding']);
            Object.assign(answer.feature_results[0], { ui_status, status });
            return feature(await engine.processResults(answer, badgeConfig, type, ['Feedspace Branding'], [BRANDING_ABSENT]), 'Feedspace Branding');
        };

        const modalOnly = await brandingVerdict('REVIEW_BADGE', 'Absent', 'NOT_APPLICABLE');
        check(
            'a resting-surface sniff cannot fail branding that only the modal renders',
            Boolean(modalOnly) && modalOnly.status === 'NOT_APPLICABLE',
            modalOnly ? `status=${modalOnly.status}, issue=${modalOnly.issue}` : 'feature missing from results'
        );

        const crossSlider = await brandingVerdict('CROSS_SLIDER', 'Absent', 'NOT_APPLICABLE');
        check(
            'nor branding the Cross Slider renders only under its popup card',
            Boolean(crossSlider) && crossSlider.status === 'NOT_APPLICABLE',
            crossSlider ? `status=${crossSlider.status}, issue=${crossSlider.issue}` : 'feature missing from results'
        );

        const onSurface = await brandingVerdict('CAROUSEL_SLIDER', 'Absent', 'PASS');
        check(
            'the same sniff still fails branding a widget renders on its surface',
            Boolean(onSurface) && onSurface.status === 'FAIL',
            onSurface ? `status=${onSurface.status}` : 'feature missing from results'
        );
    }

    console.log('\nDOM rescues only clear what the DOM actually proves:');
    {
        const STARS_ABSENT = 'DOM_TRUTH: Review Ratings (Stars) are NOT present inside the widget review cards. Ignore any stars visible on the background page outside the widget.';
        const STARS_PRESENT = 'DOM_TRUTH_RATINGS_PRESENT: Review Ratings (Stars) ARE present on the review cards.';
        const ICONS_PRESENT = "DOM_TRUTH_ICONS_PRESENT: Social Platform Icons ARE present on the review cards (e.g., next to name or in corner). You MUST report them as 'Visible'.";
        const rescued = async (name, warnings, { config_status = 'Visible', ui_status = 'Absent', type = 'CAROUSEL_SLIDER' } = {}) => {
            const answer = modelAnswer('Reviewed every screenshot.', [name]);
            Object.assign(answer.feature_results[0], { config_status, ui_status, status: 'FAIL' });
            const res = feature(await engine.processResults(answer, populatedConfig(), type, [name], warnings), name);
            return res ? res.status : 'missing';
        };

        const absent = await rescued('Show Review Ratings', [STARS_ABSENT]);
        check('a "stars are NOT present" fact never clears a missing-stars FAIL', absent === 'FAIL', `status=${absent}`);

        const present = await rescued('Show Review Ratings', [STARS_PRESENT]);
        check('stars found in the DOM clear a "configured visible, reported absent" FAIL', present === 'PASS', `status=${present}`);

        const hidden = await rescued('Show Review Ratings', [STARS_PRESENT], { config_status: 'Absent', ui_status: 'Visible' });
        check('stars in the DOM never clear a "configured hidden but shown" FAIL', hidden === 'FAIL', `status=${hidden}`);

        const icons = await rescued('Show Social Platform Icon', [ICONS_PRESENT]);
        check('icons found in the DOM clear a "configured visible, reported absent" FAIL', icons === 'PASS', `status=${icons}`);

        const panelIcons = await rescued('Show Social Platform Icon', [ICONS_PRESENT], { type: 'FLOATING_BADGE' });
        check('a resting-surface icon never clears a popover-only icon FAIL', panelIcons === 'FAIL', `status=${panelIcons}`);
    }

    console.log('\nThe branding override says what the DOM check found:');
    {
        const brandingIssue = async warning => {
            const answer = modelAnswer('Reviewed every screenshot.', ['Feedspace Branding']);
            Object.assign(answer.feature_results[0], { ui_status: 'Absent', status: 'PASS' });
            const res = feature(await engine.processResults(answer, populatedConfig(), 'CAROUSEL_SLIDER', ['Feedspace Branding'], [warning]), 'Feedspace Branding');
            return res ? `${res.status}: ${res.issue}` : 'missing';
        };
        const notFound = await brandingIssue('DOM_TRUTH_BRANDING_ABSENT: Feedspace branding is absent from the DOM.');
        check('branding the DOM check never found is not reported as clipped', notFound.startsWith('FAIL') && !/clipped/i.test(notFound), notFound);
        const clipped = await brandingIssue('DOM_TRUTH_BRANDING_ABSENT: Feedspace branding is present in the DOM but visually clipped/truncated by the parent webpage layout constraints.');
        check('branding found clipped is still reported as clipped', clipped.startsWith('FAIL') && /clipped/i.test(clipped), clipped);
    }

    console.log('\nSharpness overrides fire only on softness (real-Gemini run 11-09-2026):');
    {
        const sliced = await judge('In part2.png [Card: Ann Lee] the review text is sliced at the bottom edge of the panel.');
        check('a sliced-text line does not fail Avatars as blur', category(sliced, 'D').status === 'PASS', describe(sliced, 'D'));
        check('nor Media', category(sliced, 'E').status === 'PASS', describe(sliced, 'E'));
        check('it is reported as a cited layout finding instead', category(sliced, 'A').status === 'FAIL', describe(sliced, 'A'));

        const blunt = await judge('In part2.png [Card: Ann Lee] the review text at the bottom edge: sliced-fail.');
        check('a "sliced-fail" verdict word does not fail Avatars as blur either', category(blunt, 'D').status === 'PASS', describe(blunt, 'D'));

        const pixelated = await judge('In part1.png [Card: Ann Lee] the avatar is pixelated.');
        check('a cited softness finding still fails Avatars', category(pixelated, 'D').status === 'FAIL', describe(pixelated, 'D'));
    }

    console.log('\nA sharpness finding counts for the subject it names (S-5, real-Gemini run 11-09-2026):');
    {
        const both = (res) => `${describe(res, 'D')}; ${describe(res, 'E')}`;

        const avatarOnly = await judge('In part2.png [Card: Ann Lee] the avatar is pixelated.');
        check('an avatar-only softness line fails Avatars', category(avatarOnly, 'D').status === 'FAIL', describe(avatarOnly, 'D'));
        check('but not Media', category(avatarOnly, 'E').status === 'PASS', describe(avatarOnly, 'E'));

        const logoOnly = await judge('In part3.png [Card: Ann Lee] the company logo is pixelated.');
        check('a logo-only softness line fails Media', category(logoOnly, 'E').status === 'FAIL', describe(logoOnly, 'E'));
        check('but not Avatars', category(logoOnly, 'D').status === 'PASS', describe(logoOnly, 'D'));

        const unnamed = await judge('In part2.png [Card: Ann Lee] the image is pixelated.');
        check('a line naming neither still fails both, as before', category(unnamed, 'D').status === 'FAIL' && category(unnamed, 'E').status === 'FAIL', both(unnamed));

        const againstText = await judge('* [Card: Ann Lee] | TextEdge: 1px | AvatarDetail: ~3px | Delta: ~2px | Texture: Blurry/Soft | Verdict: FAIL. The avatar image is soft and lacks detail, showing noticeable blurring when compared to the sharp text.');
        check('softness measured only against the text is not a finding', category(againstText, 'D').status === 'PASS' && category(againstText, 'E').status === 'PASS', both(againstText));

        const artifact = await judge('In part2.png [Card: Ann Lee] the avatar is pixelated, with macro-blocking, unlike the vector text.');
        check('a real artifact still counts when the text is mentioned too', category(artifact, 'D').status === 'FAIL', describe(artifact, 'D'));
    }

    console.log('\nScreenshots that were never sent are not evidence (real-Gemini run 11-09-2026, Avatar Group):');
    {
        const SENT = 14;
        const failing = (letter, issue) => {
            const answer = modelAnswer('', ['Show Review Ratings']);
            Object.assign(category(answer, letter), { status: 'FAIL', issue, severity: 'CRITICAL' });
            return answer;
        };
        const run = (answer, count) => engine.processResults(answer, populatedConfig(), 'CAROUSEL_SLIDER', ['Show Review Ratings'], [], count);

        const unsent = await run(failing('C', '[Card: Jose Rojas Camareno (part17)] Review text in screenshot ends with "a great", indicating truncation.'), SENT);
        check('a finding citing only part17 of 14 sent is cleared', category(unsent, 'C').status === 'PASS', describe(unsent, 'C'));

        const mixed = await run(failing('C', '[Card: Ann Lee (part5)] Review text ends in an ellipsis. [Card: Jose Rojas Camareno (part17)] Review text ends with "a great".'), SENT);
        check('one that also cites a screenshot that was sent stands', category(mixed, 'C').status === 'FAIL', describe(mixed, 'C'));

        const uncounted = await run(failing('C', '[Card: Jose Rojas Camareno (part17)] Review text ends with "a great".'));
        check('with no screenshot count nothing is cleared', category(uncounted, 'C').status === 'FAIL', describe(uncounted, 'C'));

        const unsentLine = await run(modelAnswer('In part20.png [Card: Ann Lee] the review text is sliced at the bottom edge.', ['Show Review Ratings']), SENT);
        check('a reasoning line citing only an unsent screenshot locks nothing', category(unsentLine, 'A').status === 'PASS', describe(unsentLine, 'A'));

        const sentLine = await run(modelAnswer('In part3.png [Card: Ann Lee] the review text is sliced at the bottom edge.', ['Show Review Ratings']), SENT);
        check('the same line citing a sent screenshot still does', category(sentLine, 'A').status === 'FAIL', describe(sentLine, 'A'));
    }

    console.log('\nMissing social icons the data check passed do not fail a category (real-Gemini run 11-09-2026):');
    {
        const MANUAL = {
            id: 304441, app_user_name: 'Ayush', rating: 5, comment: 'A rising star.', feed_type: 'social_feed',
            review_url: null, social_platform: { name: 'Manual Text Review', slug: 'manual_text_review' }
        };
        const config = { widget_customization: {}, widget_data: { feeds_data: [MANUAL] } };
        const withPopupFinding = (issue) => {
            const answer = modelAnswer('', ['Show Social Platform Icon']);
            Object.assign(answer.feature_results[0], { ui_status: 'Absent', status: 'FAIL', issue: '[Card: Ayush] Social platform icons are absent in the popup.' });
            Object.assign(category(answer, 'G'), { status: 'FAIL', issue, severity: 'HIGH' });
            return engine.processResults(answer, config, 'AVATAR_GROUP', ['Show Social Platform Icon'], [], 14);
        };

        const iconsOnly = await withPopupFinding('Social platform icons are not visible in popups, which is an expected element according to configuration, making the popup visually incomplete.');
        const icon = feature(iconsOnly, 'Show Social Platform Icon');
        check('the feature passes on the data: a manual review carries no icon', Boolean(icon) && icon.status === 'PASS', JSON.stringify(icon));
        check('so a Popups finding about only those icons is cleared', category(iconsOnly, 'G').status === 'PASS', describe(iconsOnly, 'G'));

        const more = await withPopupFinding('The popup bottom border is flat against the viewport. Social platform icons are not visible in popups.');
        check('a finding that also names another defect stands', category(more, 'G').status === 'FAIL', describe(more, 'G'));

        const embed = modelAnswer('', ['Show Social Platform Icon']);
        Object.assign(embed.feature_results[0], { ui_status: 'Absent', config_status: 'Absent' });
        Object.assign(category(embed, 'E'), { status: 'FAIL', issue: 'The embedded social media video is cropped at the bottom of the card.', severity: 'HIGH' });
        const embedRes = await engine.processResults(embed, config, 'AVATAR_GROUP', ['Show Social Platform Icon'], [], 14);
        check('a finding that says "social" but names no icon stands', category(embedRes, 'E').status === 'FAIL', describe(embedRes, 'E'));
    }

    console.log('\nA popup icon the helper measured outranks "absent" (real-Gemini run 11-09-2026, Avatar Group):');
    {
        const AvatarGroupHelper = require('../helpers/interactiveWidgets/avatarGroupHelper');
        const logo = 'https://static.feedspace.io/uploads/x-logo.jpg';
        const AYUSH = {
            id: 304441, app_user_name: 'Ayush', rating: 5, comment: 'A rising star.', feed_type: 'social_feed',
            review_url: 'https://x.com/ayushtweetshere/status/1966154733187682609', review_website_logo: logo,
            social_platform: { name: 'Manual Text Review', slug: 'manual_text_review', icon_full_url: logo }
        };
        const config = { widget_customization: {}, widget_data: { feeds_data: [AYUSH] } };
        const judgeIcon = (warnings, popupIssue) => {
            const answer = modelAnswer('', ['Show Social Platform Icon']);
            Object.assign(answer.feature_results[0], {
                ui_status: 'Absent', status: 'FAIL',
                issue: "[Card: Ayush, ID:304441] Social platform icon is absent from the popup despite being configured as 'Visible' and the review being from X.com."
            });
            Object.assign(category(answer, 'G'), { status: 'FAIL', issue: popupIssue, severity: 'HIGH' });
            return engine.processResults(answer, config, 'AVATAR_GROUP', ['Show Social Platform Icon'], warnings, 13);
        };
        const fact = AvatarGroupHelper._popupIconsFact(['Ayush'], ['Candida Bradley']);
        const icon = res => feature(res, 'Show Social Platform Icon');

        const unmeasured = await judgeIcon([], 'Social platform icons are not visible in popups.');
        check('without a measurement the reported absence stands: the data gives Ayush a logo', icon(unmeasured).status === 'FAIL', JSON.stringify(icon(unmeasured)));

        const measured = await judgeIcon([fact], 'Social platform icons are not visible in popups.');
        check('with the popup measured showing the icon, the feature passes', icon(measured).status === 'PASS', JSON.stringify(icon(measured)));
        check('and a Popups finding that only claims the icons are absent is cleared', category(measured, 'G').status === 'PASS', describe(measured, 'G'));

        const overlap = await judgeIcon([fact], 'The social platform icon overlaps the reviewer name.');
        check('a finding about how a present icon looks still stands', category(overlap, 'G').status === 'FAIL', describe(overlap, 'G'));
    }

    console.log('\nRead More in Avatar Group popups that show their whole text (real-Gemini run 11-09-2026):');
    {
        const AvatarGroupHelper = require('../helpers/interactiveWidgets/avatarGroupHelper');
        const answer = modelAnswer('', ['Read More']);
        Object.assign(answer.feature_results[0], {
            ui_status: 'Absent', status: 'FAIL',
            issue: '[Card: Ayush (part5)] The review text ends with an ellipsis indicating truncation, but no Read more link is present.'
        });
        const res = await engine.processResults(answer, populatedConfig(), 'AVATAR_GROUP', ['Read More'], [AvatarGroupHelper._readMoreFact(6)], 14);
        const readMore = feature(res, 'Read More');
        check("the helper's fact passes Read More", Boolean(readMore) && readMore.status === 'PASS', JSON.stringify(readMore));
    }

    console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
    process.exit(results.failed > 0 ? 1 : 0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
