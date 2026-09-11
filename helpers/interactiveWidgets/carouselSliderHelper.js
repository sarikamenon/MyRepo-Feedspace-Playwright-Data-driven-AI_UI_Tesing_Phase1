const MotionFreeze = require('../motionFreeze');

class CarouselSliderHelper {
    /**
     * Freeze the auto-advance, let the track settle onto a whole slide, capture,
     * then release so autoplay can move on before the next capture. Without this
     * the carousel is photographed mid-transit and the partially visible slide is
     * reported as a clipped card.
     */
    static async _captureStable(context, page, label, capture) {
        // Wait BEFORE freezing: a transition in flight has to finish on its own, because
        // pausing mid-transit preserves the partial offset rather than settling the track
        // onto a slide boundary. Freezing after the wait is what makes the frame stable.
        await page.waitForTimeout(400);
        const frozen = await MotionFreeze.apply(context, `CarouselSliderHelper:${label}`);
        const shot = await capture().catch(() => null);
        await MotionFreeze.release(frozen, `CarouselSliderHelper:${label}`);
        return shot;
    }
    /**
     * Interact with Carousel Slider widgets.
     * Navigates the slider and captures screenshots.
     */
    static async interact(interactionContext, widgetLocator) {
        console.log('[CarouselSliderHelper] Starting interactive carousel validation...');
        const screenshots = [];

        try {
            const page = interactionContext.page ? interactionContext.page() : (interactionContext.goto ? interactionContext : null);
            if (!page) {
                console.error('[CarouselSliderHelper] Could not derive page from context.');
                return screenshots;
            }

            // 1. Initial capture
            console.log('[CarouselSliderHelper] Waiting for reviews and widget content...');

            // Force scroll and wait for layout
            await widgetLocator.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => { });
            await page.waitForTimeout(2000);

            // Explicitly wait for ACTUAL review content elements to be visible
            // This ensures we aren't just seeing the "Loading reviews..." placeholder
            const contentSelector = '.feedspace-embed-card, .feedspace-review-card, .swiper-slide:not([class*="loading"]), .slick-slide:not([class*="loading"])';

            try {
                // Wait for the first review card to appear and be visible
                await interactionContext.locator(contentSelector).first().waitFor({
                    state: 'visible',
                    timeout: 20000
                });
                console.log('[CarouselSliderHelper] Review content detected.');
            } catch (e) {
                console.warn('[CarouselSliderHelper] Content detection timed out. Checking for presence...');
                // Fallback to presence if visibility is tricky
                await interactionContext.locator(contentSelector).first().waitFor({
                    state: 'attached',
                    timeout: 5000
                }).catch(() => console.warn('[CarouselSliderHelper] Still no content. Proceeding with best-effort capture.'));
            }

            // Extra wait for layout and reviews to settle
            console.log('[CarouselSliderHelper] Waiting 5s for initial stabilization and expansion...');
            await this._tryExpandReadMore(widgetLocator);
            await page.waitForTimeout(5000);

            // 1. First Screenshot: Entire Page
            console.log('[CarouselSliderHelper] Capture 1/3: Entire Page');
            const fullPageShot = await this._captureStable(interactionContext, page, 'full-page', () =>
                page.screenshot({ fullPage: true, animations: 'disabled' })
            );
            if (fullPageShot) screenshots.push(fullPageShot);

            await page.waitForTimeout(3000); // 3s gap

            // 2. Second Screenshot: Focused on Widget (Generous 100px Context)
            console.log('[CarouselSliderHelper] Capture 2/3: Focused on Widget (100px Context)');
            const box = await widgetLocator.boundingBox().catch(() => null);
            if (box) {
                const vSize = page.viewportSize();
                const padding = 100;
                const clipX = Math.max(0, box.x - padding);
                const clipY = Math.max(0, box.y - padding);
                const focusShot1 = await this._captureStable(interactionContext, page, 'focus-1', () =>
                    page.screenshot({
                        clip: {
                            x: clipX,
                            y: clipY,
                            width: Math.min(box.width + (padding * 2), vSize.width - clipX),
                            height: Math.min(box.height + (padding * 2), vSize.height - clipY)
                        },
                        animations: 'disabled'
                    })
                );
                if (focusShot1) screenshots.push(focusShot1);
            }

            await page.waitForTimeout(3000); // 3s gap

            // 3. Third Screenshot: Focused on Widget (Generous 100px Context)
            console.log('[CarouselSliderHelper] Capture 3/3: Focused on Widget (100px Context)');
            const box2 = await widgetLocator.boundingBox().catch(() => null);
            if (box2) {
                const vSize = page.viewportSize();
                const padding = 100;
                const clipX = Math.max(0, box2.x - padding);
                const clipY = Math.max(0, box2.y - padding);
                const focusShot2 = await this._captureStable(interactionContext, page, 'focus-2', () =>
                    page.screenshot({
                        clip: {
                            x: clipX,
                            y: clipY,
                            width: Math.min(box2.width + (padding * 2), vSize.width - clipX),
                            height: Math.min(box2.height + (padding * 2), vSize.height - clipY)
                        },
                        animations: 'disabled'
                    })
                );
                if (focusShot2) screenshots.push(focusShot2);
            }

            // 🛡️ UNIVERSAL EDGE SENTINEL Logic: Check all visible cards for clipping.
            // Horizontal overflow is NOT checked: a carousel is designed to show partially
            // visible slides at the left and right edges, so flagging them reports the
            // widget's intended behaviour as a layout failure. Only vertical clipping,
            // which a carousel never does on purpose, is a defect.
            const cardSelector = '.feedspace-embed-card, .feedspace-review-card, .swiper-slide-active, .slick-active';
            const vSize = page.viewportSize();

            // Measure against a settled track, never mid-transit.
            await page.waitForTimeout(400);
            const sentinelFreeze = await MotionFreeze.apply(interactionContext, 'CarouselSliderHelper:sentinel');

            let clips = [];
            try {
                // page.evaluate takes ONE argument. Passing three threw "Too many arguments" on
                // every run, so this sentinel never measured anything before now.
                clips = await page.evaluate(({ sel, vh }) => {
                    const results = [];
                    document.querySelectorAll(sel).forEach((el, idx) => {
                        const r = el.getBoundingClientRect();
                        if (r.width > 10 && r.height > 10) {
                            if (r.bottom > vh + 5) results.push(`FAIL_BOTTOM_EDGE_CLIPPED (Card ${idx + 1})`);
                            if (r.top < -5) results.push(`FAIL_TOP_EDGE_CLIPPED (Card ${idx + 1})`);
                        }
                    });
                    return results;
                }, { sel: cardSelector, vh: vSize.height });
            } finally {
                // Always release: a throw here used to leave the whole page frozen.
                await MotionFreeze.release(sentinelFreeze, 'CarouselSliderHelper:sentinel');
            }

            if (clips && clips.length > 0) {
                clips.forEach(msg => {
                    console.log(`[SYSTEM ALERT] TRUTH DATA: FAIL_LAYOUT_CLIPPED detected in carousel. Issue: ${msg}`);
                    if (interactionContext.geometricWarnings) interactionContext.geometricWarnings.push(msg);
                });
            }

            console.log(`[CarouselSliderHelper] Interaction complete. ${screenshots.length} screenshots captured.`);

        } catch (error) {
            console.warn(`[CarouselSliderHelper] Interaction Warning: ${error.message}`);
        }

        return screenshots;
    }

    /**
     * Attempts to find and click "Read More" buttons to expand truncated reviews.
     */
    static async _tryExpandReadMore(container) {
        try {
            const readMore = container.locator('button, a, span', { hasText: /Read More/i }).filter({ visible: true });
            const count = await readMore.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                console.log(`[CarouselSliderHelper] Expanding Read More #${i + 1}`);
                await readMore.nth(i).click({ force: true, timeout: 2000 }).catch(() => { });
                await new Promise(r => setTimeout(r, 300)); // Animation buffer
            }
        } catch (e) {
            // Non-critical failure
        }
    }
}

module.exports = CarouselSliderHelper;
