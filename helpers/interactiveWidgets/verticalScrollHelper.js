/**
 * VerticalScrollHelper.js
 * Programmatically verifies vertical scroll movement and column directions.
 */
const MotionFreeze = require('../motionFreeze');

// Astro renders each column as .feedspace-vertical-scroll-column and animates the column
// element itself. The remaining names are the legacy embed's.
const COLUMN_SELECTORS = [
    '.feedspace-vertical-scroll-column',
    '.feedspace-elements-wrapper',
    '.marquee-column',
    '[class*="vertical_scroll"]',
    '[class*="elements-wrapper"]'
];
const MOVEMENT_SAMPLES = 4;
const SAMPLE_INTERVAL_MS = 600;

class VerticalScrollHelper {
    /**
     * Capture a still frame of a marquee that must keep moving.
     *
     * This widget forces `animation-play-state: running` so column movement can be
     * measured, which means an unguarded screenshot lands mid-transit and the AI
     * audits a half-scrolled card. Positions are sampled before this runs, so the
     * freeze does not affect the movement verification.
     */
    static async _captureStill(page, widgetLocator, label) {
        await page.waitForTimeout(250);
        const frozen = await MotionFreeze.apply(page, `VerticalScrollHelper:${label}`);
        const shot = await widgetLocator.screenshot({ animations: 'disabled' }).catch(() => null);
        await MotionFreeze.release(frozen, `VerticalScrollHelper:${label}`);
        return shot;
    }

    /**
     * Verifies vertical scroll movement and column directions.
     * 
     * @param {import('playwright').Page|import('playwright').Frame} context - Playwright context
     * @param {import('playwright').Locator} widgetLocator - Locator for the marquee widget
     * @param {Object} config - Widget configuration (includes marquee_direction)
     * @returns {Promise<Object>} - Verification results
     */
    static async interact(context, widgetLocator, config = {}, geometricWarnings = []) {
        console.log('[VerticalScrollHelper] Starting vertical movement verification & capture...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        try {
            // 🛡️ Prevent "Freezing": Move mouse to safe corner and force animations
            await page.mouse.move(0, 0);
            await page.addStyleTag({
                content: `
                    * { 
                        animation-play-state: running !important; 
                        transition-property: none !important;
                    }
                    *:hover { 
                        animation-play-state: running !important; 
                    }
                `
            }).catch(() => null);

            // Warmup: Scroll slightly to wake up rendering pipeline in headless
            await page.evaluate(() => window.scrollBy(0, 1));
            await page.waitForTimeout(100);
            await page.evaluate(() => window.scrollBy(0, -1));

            // 1️⃣ Identify Columns. The first selector that matches wins, so Astro's own column
            // class is never mixed with a legacy catch-all.
            let columns = null;
            let columnCount = 0;
            for (const selector of COLUMN_SELECTORS) {
                const candidate = widgetLocator.locator(selector).filter({ visible: true });
                const count = await candidate.count().catch(() => 0);
                if (count > 0) {
                    columns = candidate;
                    columnCount = count;
                    break;
                }
            }

            if (columnCount === 0) {
                console.log('[VerticalScrollHelper] Primary column selectors failed. Searching for containers with >3 children...');
                // 🛡️ REWRITE: High-Speed Safe-Depth Search
                // 1. Look for known high-confidence containers
                // 2. Fallback to shallow children search (prevents infinite DOM-walking)
                const containerSelectors = [
                    '.feedspace-shadow-container',
                    '.feedspace-embed-main',
                    '.feedspace-elements-wrapper',
                    '.feedspace-vertical-scroll-row',
                    '> div',
                    '> section',
                    '> ul',
                    '> * > div'
                ];

                // `has` is evaluated relative to each candidate, so the inner locator must not
                // start from the widget: `widgetLocator.locator('> *')` never matched anything.
                const hasChild = context.locator(':scope > *');
                let potentialCols = widgetLocator.locator(containerSelectors.join(', ')).filter({ has: hasChild });
                let pcCount = await potentialCols.count().catch(() => 0);

                // 🛡️ TIER 3 FALLBACK: Guarded Deep Scan (Infinite Loop Search)
                // If Tier 1 & 2 fail, search deeper but limit to 100 candidates 
                // to prevent 10-minute hangs on complex pages.
                if (pcCount === 0) {
                    console.log('[VerticalScrollHelper] Tier 1 & 2 failed. Triggering Guarded Deep Scan (Limit 100)...');
                    potentialCols = widgetLocator.locator('div, section, ul').filter({ has: hasChild });
                    pcCount = Math.min(await potentialCols.count().catch(() => 0), 100);
                }
                for (let i = 0; i < pcCount; i++) {
                    const childCount = await potentialCols.nth(i).locator(':scope > *').count().catch(() => 0);
                    if (childCount >= 1) {
                        columns = potentialCols.nth(i);
                        columnCount = 1;
                        console.log(`[VerticalScrollHelper] Fallback: Identified a column with ${childCount} items.`);
                        break;
                    }
                }
            }

            // 2️⃣ Movement, sampled BEFORE any capture (see _verifyMovement).
            const movement = columnCount > 0
                ? await this._verifyMovement(page, columns, config)
                : { status: 'SKIPPED', message: 'No columns identified for movement tracking.' };
            console.log(`[VerticalScrollHelper] Tracking ${columnCount} column(s). Movement: ${movement.status}. ${movement.message}`);

            // 3️⃣ Capture Sequence (3 shots with 2s delay)
            console.log('[VerticalScrollHelper] Proceeding with 3 capture phases...');
            const buf1 = await this._captureStill(page, widgetLocator, 'phase-1');
            if (buf1) screenshots.push(buf1);

            await page.waitForTimeout(2000);
            const buf2 = await this._captureStill(page, widgetLocator, 'phase-2');
            if (buf2) screenshots.push(buf2);

            await page.waitForTimeout(2000);
            const buf3 = await this._captureStill(page, widgetLocator, 'phase-3');
            if (buf3) screenshots.push(buf3);

            // 4️⃣ Review popup. Astro opens the review modal from Read More or from the card
            // itself, so fall back to a review card when every review is short enough to need no Read More.
            // Never a CTA card: it shares the card class, and Astro ignores clicks on it.
            console.log('[VerticalScrollHelper] Scanning for "Read More" button to trigger popup...');
            const readMoreSelectors = ['.feedspace-read-more-btn', '.fe-read-more', '.feedspace-read-more', 'a:has-text("Read more")', 'span:has-text("Read more")'];
            let trigger = widgetLocator.locator(readMoreSelectors.join(', ')).filter({ visible: true }).first();
            if (!(await trigger.isVisible().catch(() => false))) {
                trigger = widgetLocator.locator('.feedspace-vertical-scroll-card:not(.feedspace-vertical-scroll-cta-card)').filter({ visible: true }).first();
            }

            if (await trigger.isVisible().catch(() => false)) {
                console.log('[VerticalScrollHelper] Popup trigger found. Clicking...');
                // The column is moving, so a Playwright click waits forever for the element to
                // hold still. A DOM click reaches the same delegated handler.
                await trigger.evaluate(el => el.click()).catch(err => console.warn(`[VerticalScrollHelper] Click failed: ${err.message}`));

                // Wait for popup to manifest
                await page.waitForTimeout(1500);
                const popup = await this._findPopup(context);

                if (popup) {
                    console.log('[VerticalScrollHelper] Popup detected. Capturing it...');
                    const popupShot = await popup.screenshot({ animations: 'disabled' }).catch(() => null);
                    if (popupShot) screenshots.push(popupShot);

                    // Add a system warning to the AI about the open popup
                    geometricWarnings.push("POPUP_DETECTED: A review popup is OPEN in the last screenshot. Audit Rule 7 and Rule 14 inside this popup.");

                    // An open modal also stops the marquee (fe-stop-animation) for every later step.
                    const close = context.locator('.fs-modal-close, .fe-review-box-close-icon, .feedspace-review-box-close-icon').filter({ visible: true }).first();
                    if (await close.isVisible().catch(() => false)) await close.click({ force: true }).catch(() => { });
                    else await page.keyboard.press('Escape').catch(() => { });
                    await page.waitForTimeout(600);
                    console.log(`[VerticalScrollHelper] Popup ${(await this._findPopup(context)) ? 'is still OPEN' : 'closed'} after capture.`);
                }
            }

            return { result: movement, screenshots };

        } catch (e) {
            console.warn(`[VerticalScrollHelper] ERROR: ${e.message}`);
            return { result: { status: 'ERROR', message: e.message }, screenshots };
        }
    }

    /**
     * The first visible review popup, checked one selector at a time: a comma list resolves
     * in DOM order, and the old `[class*="review-box"]` catch-all matched Astro's own cards
     * (`feedspace-review-box-height`), which sit before the modal and faked a popup.
     */
    static async _findPopup(context) {
        for (const selector of ['.fs-modal-inner', '.fe-review-box', '.fe-review-box-inner', '.feedspace-avatar-tooltip']) {
            const popup = context.locator(selector).filter({ visible: true }).first();
            if (await popup.isVisible().catch(() => false)) return popup;
        }
        return null;
    }

    /**
     * Samples every column's position MOVEMENT_SAMPLES times, before any screenshot. Astro
     * drives each column with element.animate(), and an animations:'disabled' screenshot
     * cancels and restarts Web Animations, so positions sampled across a capture compare two
     * different runs of the animation and can report the wrong direction.
     */
    static async _verifyMovement(page, columns, config) {
        const samples = [];
        for (let i = 0; i < MOVEMENT_SAMPLES; i++) {
            if (i > 0) await page.waitForTimeout(SAMPLE_INTERVAL_MS);
            samples.push(await columns.evaluateAll(els => els.map(el => {
                const cls = typeof el.className === 'string' ? el.className : '';
                return {
                    top: el.getBoundingClientRect().top,
                    built: cls.includes('vertical-scroll-u2d') ? 'DOWN' : (cls.includes('vertical-scroll-d2u') ? 'UP' : null),
                    stopped: Boolean(el.closest('.fe-stop-animation'))
                };
            })).catch(() => []));
        }
        return this._verdict(samples, this._configuredDirections(config, samples[0].length));
    }

    /**
     * Direction from successive positions. A loop reset inside one interval jumps the track
     * by a whole set height and reverses that step, so the majority of moving steps decides,
     * and a tie goes to the smaller step (the reset is the larger jump).
     */
    static _direction(tops) {
        const steps = [];
        for (let i = 1; i < tops.length; i++) steps.push(tops[i] - tops[i - 1]);
        const moving = steps.filter(d => Math.abs(d) > 1);
        if (moving.length === 0) return 'STATIONARY';
        const up = moving.filter(d => d < 0).length;
        const down = moving.length - up;
        if (up !== down) return up > down ? 'UP' : 'DOWN';
        const smallest = moving.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
        return smallest < 0 ? 'UP' : 'DOWN';
    }

    /**
     * Mirrors Astro's getDirectionClass: 'up' and 'down' apply to every column, 'alter'
     * starts UP and alternates. Returns null when the config does not say, so nothing is
     * compared against a guessed default.
     */
    static _configuredDirections(config, count) {
        const customization = (config && config.widget_customization) || config || {};
        const direction = customization.marquee_direction;
        if (direction !== 'up' && direction !== 'down' && direction !== 'alter') return null;
        return Array.from({ length: count }, (_, i) =>
            direction === 'up' ? 'UP' : direction === 'down' ? 'DOWN' : (i % 2 === 0 ? 'UP' : 'DOWN'));
    }

    static _verdict(samples, configured) {
        const first = samples[0] || [];
        if (first.length === 0) return { status: 'SKIPPED', message: 'Column positions could not be read.' };
        if (first.some(col => col.stopped)) {
            return { status: 'SKIPPED', message: 'The widget has stopped its own animation (fe-stop-animation), so there is no movement to verify.' };
        }

        const details = first.map((col, i) => ({
            column: i + 1,
            built: col.built,
            configured: configured ? configured[i] : null,
            measured: this._direction(samples.map(s => (s[i] ? s[i].top : NaN)).filter(Number.isFinite))
        }));
        details.forEach(d => console.log(`[VerticalScrollHelper] Column ${d.column}: measured ${d.measured}, built ${d.built || 'unknown'}${d.configured ? `, configured ${d.configured}` : ''}`));

        // Only a column whose intended direction is known from its own markup can fail. The
        // legacy embed carries no direction class, so its columns are reported, not judged.
        const problems = [];
        details.forEach(d => {
            if (!d.built) return;
            if (d.configured && d.configured !== d.built) {
                problems.push(`column ${d.column} is built to move ${d.built} but marquee_direction requires ${d.configured}`);
            }
            if (d.measured !== 'STATIONARY' && d.measured !== d.built) {
                problems.push(`column ${d.column} moves ${d.measured} but is built to move ${d.built}`);
            }
        });

        if (problems.length > 0) return { status: 'FAIL', message: `Movement check failed: ${problems.join('; ')}.`, details };
        if (details.every(d => d.measured === 'STATIONARY')) {
            return { status: 'SKIPPED', message: 'No column moved during the sampling window, so direction could not be verified.', details };
        }
        return { status: 'PASS', message: `Columns move as built: ${details.map(d => d.measured).join(', ')}.`, details };
    }
}

module.exports = VerticalScrollHelper;
