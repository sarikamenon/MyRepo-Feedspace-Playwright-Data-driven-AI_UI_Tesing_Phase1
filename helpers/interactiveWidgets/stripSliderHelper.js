class StripSliderHelper {
    /**
     * Interact with Strip Slider (Marquee Stripe) widgets.
     * Clicks review cards to open popups and captures high-res screenshots.
     */
    static async interact(context, widgetLocator, captureCallback) {
        console.log('[StripSliderHelper] Starting interactive stripe/marquee validation...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        let styleHandle = null;

        try {
            // 0. MOTION FREEZE: Inject CSS to pause all animations and transitions
            // Apply to the specific context (which could be an iframe)
            console.log('[StripSliderHelper] Freezing motion in interaction context...');
            styleHandle = await context.addStyleTag({
                content: `
                    *, *::before, *::after {
                        animation-play-state: paused !important;
                        transition: none !important;
                        -webkit-transition: none !important;
                    }
                `
            }).catch(e => {
                console.warn(`[StripSliderHelper] Failed to inject motion freeze: ${e.message}`);
                return null;
            });

            // 1. Initial focused widget screenshot (Avoid fullPage: true for marquee)
            console.log('[StripSliderHelper] Capturing focused widget screenshot...');
            const widgetShot = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
            if (widgetShot) screenshots.push(widgetShot);

            // 2. Detect Unique Cards
            const cardSelectors = [
                '.feedspace-marquee-box',
                '.feedspace-element-feed-box',
                '.review-card',
                'div[data-feed-id]',
                'div[data-review-id]',
                '[data-testid="review-card"]'
            ];

            const cardLocator = context.locator(cardSelectors.join(', ')).filter({ visible: true });
            const allCards = await cardLocator.all();
            console.log(`[StripSliderHelper] Identified ${allCards.length} visible elements matching card selectors.`);

            let targetsToClick = [];
            const seenIds = new Set();
            const MAX_CAPTURES = 6;
            const TARGET_POOL_SIZE = 10;

            for (const card of allCards) {
                if (targetsToClick.length >= TARGET_POOL_SIZE) break;

                const feedId = await card.getAttribute('data-feed-id').catch(() => null);
                const reviewId = await card.getAttribute('data-review-id').catch(() => null);
                const interactionId = await card.getAttribute('data-fs-interaction-id').catch(() => null);
                const uniqueId = feedId || reviewId || interactionId;

                if (uniqueId) {
                    if (!seenIds.has(uniqueId)) {
                        seenIds.add(uniqueId);
                        targetsToClick.push(card);
                    }
                }
            }

            // Fallback for anonymous cards
            if (targetsToClick.length < TARGET_POOL_SIZE && allCards.length > 0) {
                for (let i = 0; i < allCards.length; i++) {
                    if (targetsToClick.length >= TARGET_POOL_SIZE) break;
                    if (!targetsToClick.includes(allCards[i])) {
                        targetsToClick.push(allCards[i]);
                    }
                }
            }

            let successfulCaptures = 0;

            for (const target of targetsToClick) {
                if (successfulCaptures >= MAX_CAPTURES) break;
                if (page.isClosed()) break;

                try {
                    console.log(`[StripSliderHelper] Processing candidate ${successfulCaptures + 1}...`);

                    // A. Focused Card Snapshot (Ensures AI sees CTA/Date/ReadMore on the card itself)
                    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                    const cardShot = await target.screenshot({ animations: 'disabled' }).catch(() => null);
                    if (cardShot) {
                        screenshots.push(cardShot);
                    }

                    // B. Interaction to open popup
                    await target.hover({ force: true }).catch(() => { });
                    await target.click({ force: true, timeout: 3000 }).catch(() => { });
                    await target.dispatchEvent('click').catch(() => { });
                    await context.waitForTimeout(1000).catch(() => { });

                    const popupSelectors = [
                        '.fe-review-box',
                        '.fe-review-box-inner',
                        '.feedspace-review-box-main',
                        '.feedspace-review-box',
                        '[class*="review-box"]'
                    ];
                    const popup = context.locator(popupSelectors.join(', ')).filter({ visible: true }).first();

                    const isVisible = await popup.isVisible().catch(() => false);
                    if (isVisible) {
                        console.log(`[StripSliderHelper] Capture ${successfulCaptures + 1} Popup SUCCESS.`);

                        // ENSURE FULL VISIBILITY: Scroll the popup itself into the center of the viewport
                        await popup.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                        await context.waitForTimeout(500);

                        // Capture the full viewport while the popup is open
                        // This provides the "In-Context" view requested by the user.
                        const buf = await page.screenshot({
                            fullPage: false,
                            animations: 'disabled'
                        }).catch(() => null);

                        if (buf) {
                            screenshots.push(buf);
                            successfulCaptures++;
                        }

                        // D. Close popup
                        const closeBtnSelectors = '.fe-review-box-close-icon, .feedspace-review-box-close-icon, .close-icon, .close-btn, button:has-text("X")';
                        let closeBtn = context.locator(closeBtnSelectors).filter({ visible: true }).first();
                        const isCloseVisible = await closeBtn.isVisible().catch(() => false);
                        if (isCloseVisible) {
                            await closeBtn.click().catch(() => { });
                        } else {
                            // Fallback: Click top-left of viewport to close modal
                            await page.mouse.click(10, 10).catch(() => { });
                        }
                        await context.waitForTimeout(500).catch(() => { });
                    }
                } catch (err) {
                    console.warn(`[StripSliderHelper] Interaction failed: ${err.message}`);
                }
            }

            // 3. BRANDING CAPTURE: Explicitly capture the Feedspace branding if present
            console.log('[StripSliderHelper] Attempting to capture branding footer...');
            const brandingSelectors = [
                '.feedspace-branding-footer-link',
                '.feedspace-branding',
                '[class*="branding-footer"]',
                'a:has-text("Feedspace")'
            ];
            const branding = context.locator(brandingSelectors.join(', ')).filter({ visible: true }).first();
            if (await branding.isVisible().catch(() => false)) {
                const brandingShot = await branding.screenshot({ animations: 'disabled' }).catch(() => null);
                if (brandingShot) {
                    console.log('[StripSliderHelper] Branding captured successfully.');
                    screenshots.push(brandingShot);
                }
            } else {
                console.log('[StripSliderHelper] Branding not found or invisible.');
            }

        } catch (error) {
            console.warn(`[StripSliderHelper] Interaction Error: ${error.message}`);
        } finally {
            // Restore motion if style handle exists
            if (styleHandle && !page.isClosed()) {
                await styleHandle.evaluate(el => el.remove()).catch(() => { });
            }
        }

        return screenshots;
    }
}

module.exports = StripSliderHelper;