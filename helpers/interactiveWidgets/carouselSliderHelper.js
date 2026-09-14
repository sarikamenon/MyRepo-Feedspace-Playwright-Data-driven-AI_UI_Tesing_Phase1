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
    static async interact(interactionContext, widgetLocator, geometricWarnings = []) {
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
            // which a carousel never does on purpose, is a defect. It is measured against the
            // card's nearest overflow-hidden ancestor, never the browser viewport: a card below
            // the fold is a capture artifact, not a widget defect.
            const cardSelector = '.feedspace-carousel-card, .feedspace-embed-card, .feedspace-review-card, .swiper-slide-active, .slick-active';

            // Measure against a settled track, never mid-transit.
            await page.waitForTimeout(400);
            const sentinelFreeze = await MotionFreeze.apply(interactionContext, 'CarouselSliderHelper:sentinel');

            let clips = [];
            try {
                // A locator pierces the widget's shadow root; document.querySelectorAll does not,
                // and the old selectors predate Astro's .feedspace-carousel-card. Between them
                // this sentinel never found a card.
                clips = await widgetLocator.locator(cardSelector).evaluateAll(cards => {
                    const parentOf = node => node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
                    const hides = overflow => overflow === 'hidden' || overflow === 'clip';
                    const name = el => el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map(c => `.${c}`).join('');
                    const found = [];
                    // Astro nests .feedspace-review-card inside .feedspace-carousel-card and both match,
                    // so measure each card once, by its outermost match.
                    const outermost = cards.filter(card => !cards.some(other => other !== card && other.contains(card)));
                    outermost.forEach((card, idx) => {
                        const r = card.getBoundingClientRect();
                        if (r.width <= 10 || r.height <= 10) return;
                        // A slide moved out of the track is hidden on purpose: skip any card that half-leaves
                        // one of its horizontally clipping ancestors, not just the nearest one.
                        let yClip = null;
                        let offTrack = false;
                        for (let a = parentOf(card); a && a !== document.documentElement && !offTrack; a = parentOf(a)) {
                            const style = getComputedStyle(a);
                            if (hides(style.overflowX)) {
                                const x = a.getBoundingClientRect();
                                offTrack = Math.min(r.right, x.right) - Math.max(r.left, x.left) < r.width / 2;
                            }
                            if (!yClip && hides(style.overflowY)) yClip = a;
                        }
                        if (offTrack || !yClip) return;
                        const box = yClip.getBoundingClientRect();
                        const bottom = Math.round(r.bottom - box.bottom);
                        const top = Math.round(box.top - r.top);
                        if (bottom > 2) found.push({ card: idx + 1, edge: 'bottom', px: bottom, by: name(yClip) });
                        if (top > 2) found.push({ card: idx + 1, edge: 'top', px: top, by: name(yClip) });
                    });
                    return found;
                }).catch(() => []);
            } finally {
                // Always release: a throw here used to leave the whole page frozen.
                await MotionFreeze.release(sentinelFreeze, 'CarouselSliderHelper:sentinel');
            }

            clips.forEach(c => {
                const msg = `ADVISORY: Carousel card ${c.card} is cut ${c.px}px at the ${c.edge} by its clipping container ${c.by}. Check the screenshots before reporting it.`;
                console.log(`[CarouselSliderHelper] ${msg}`);
                geometricWarnings.push(msg);
            });
            console.log(`[CarouselSliderHelper] Clipping sentinel found ${clips.length} vertically clipped card(s).`);

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
