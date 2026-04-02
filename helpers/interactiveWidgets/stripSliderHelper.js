class StripSliderHelper {
    /**
     * Interact with Strip Slider (Marquee Stripe) widgets.
     * Clicks review cards to open popups and captures high-res screenshots.
     */
    static async interact(context, widgetLocator, captureCallback) {
        console.log('[StripSliderHelper] Starting interactive stripe/marquee validation...');
        const screenshots = [];

        try {
            // Locate all clickable review cards or their sub-elements that trigger popups
            const cardSelectors = [
                '.feedspace-marquee-box',
                '.feedspace-element-feed-box',
                'div[data-feed-id]',
                'div[data-review-id]',
                '[data-testid="review-card"]'
            ];

            // 0. Initial full-page capture after identifying widget
            console.log('[StripSliderHelper] Capturing initial full-page screenshot...');
            const page = context.page ? context.page() : context;
            const initialFullPageBuffer = await page.screenshot({ fullPage: true }).catch(() => null);
            if (initialFullPageBuffer) screenshots.push(initialFullPageBuffer);

            // 0.1 Focused screenshot of the widget itself (highly recommended for visual validation)
            console.log('[StripSliderHelper] Capturing focused widget screenshot...');
            const widgetShot = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
            if (widgetShot) screenshots.push(widgetShot);

            // 1. Detect Unique Cards
            const cardLocator = context.locator(cardSelectors.join(', ')).filter({ visible: true });
            const allCards = await cardLocator.all();
            console.log(`[StripSliderHelper] Identified ${allCards.length} visible elements matching card selectors.`);

            let targetsToClick = [];
            const seenIds = new Set();
            const MAX_CAPTURES = 6; 
            const TARGET_POOL_SIZE = 12; // Over-index to ensure we get 6 successful captures

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

            // Fallback: If pool is still small
            if (targetsToClick.length < TARGET_POOL_SIZE && allCards.length > 0) {
                for (let i = 0; i < allCards.length; i++) {
                    if (targetsToClick.length >= TARGET_POOL_SIZE) break;
                    if (!targetsToClick.includes(allCards[i])) {
                        targetsToClick.push(allCards[i]);
                    }
                }
            }

            console.log(`[StripSliderHelper] Target pool created with ${targetsToClick.length} candidates. Aiming for 6 successful captures.`);

            let successfulCaptures = 0;

            for (const target of targetsToClick) {
                if (successfulCaptures >= MAX_CAPTURES) break;
                if (page.isClosed()) {
                    console.log('[StripSliderHelper] Page closed. Terminating interaction loop.');
                    break;
                }

                try {
                    console.log(`[StripSliderHelper] Attempting interaction with candidate ${successfulCaptures + 1}...`);

                    // Ensure target is somewhat in view and stabilized
                    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
                    if (page.isClosed()) break;
                    await target.hover({ force: true }).catch(() => { });
                    await context.waitForTimeout(1000).catch(() => {}); 

                    // Duo-Trigger Click
                    if (page.isClosed()) break;
                    await target.click({ force: true, timeout: 5000 }).catch(() => { });
                    await target.dispatchEvent('click').catch(() => { });

                    if (page.isClosed()) break;
                    await context.waitForTimeout(1000).catch(() => {});

                    // Detect popup
                    const popupSelectors = ['.fe-review-box', '.fe-review-box-inner', '.feedspace-review-box-main', '[class*="review-box"]', '[class*="popup"]'];
                    let popup = context.locator(popupSelectors.join(', ')).filter({ visible: true }).first();

                    if (!(await popup.isVisible().catch(() => false))) {
                        popup = page.locator(popupSelectors.join(', ')).filter({ visible: true }).first();
                    }

                    const isVisible = await popup.isVisible().catch(() => false);
                    const popupBox = isVisible ? await popup.boundingBox().catch(() => null) : null;

                    if (isVisible && popupBox && popupBox.width > 50) {
                        console.log(`[StripSliderHelper] Capture ${successfulCaptures + 1} SUCCESS. Saving screenshot...`);
                        const buf = await page.screenshot({ animations: 'disabled' }).catch(() => null);
                        if (buf) {
                            screenshots.push(buf);
                            successfulCaptures++;
                        }

                        // Reset: Close popup
                        if (page.isClosed()) break;
                        console.log('[StripSliderHelper] Closing popup for next interaction...');
                        const closeBtnSelectors = '.fe-review-box-close-icon, .feedspace-review-box-close-icon, [class*="close-icon"], [class*="close-btn"], button:has-text("X")';
                        let closeBtn = context.locator(closeBtnSelectors).filter({ visible: true }).first();
                        if (await closeBtn.isVisible().catch(() => false)) {
                            await closeBtn.click().catch(() => {});
                        } else {
                            await page.mouse.click(10, 10).catch(() => {});
                        }
                        await context.waitForTimeout(500).catch(() => {});
                    } else {
                        console.log('[StripSliderHelper] Candidate did not produce a valid popup.');
                    }
                } catch (err) {
                    console.warn(`[StripSliderHelper] Candidate interaction failed: ${err.message}`);
                }
            }

        } catch (error) {
            console.warn(`[StripSliderHelper] Interaction Error: ${error.message}`);
        }

        return screenshots;
    }
}

module.exports = StripSliderHelper;
