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
                // User provided specific paths (most accurate right now)
                '.feedspace-marquee-box',
                '.feedspace-element-feed-box',
                'div[data-feed-id]',
                'div[data-review-id]',
                '.feedspace-marquee-box-inner',
                '.feedspace-review-bio-img',
                '.feedspace-marquee-left',
                '[data-testid="review-card"]'
            ];

            // 0. Initial full-page capture after identifying widget
            console.log('[StripSliderHelper] Capturing initial full-page screenshot...');
            const page = context.page ? context.page() : context;
            const initialFullPageBuffer = await page.screenshot({ fullPage: true }).catch(() => null);
            if (initialFullPageBuffer) screenshots.push(initialFullPageBuffer);

            // 1. Detect Unique Cards
            const cardLocator = context.locator(cardSelectors.join(', ')).filter({ visible: true });
            const allCards = await cardLocator.all();
            console.log(`[StripSliderHelper] Identified ${allCards.length} visible elements matching card selectors.`);

            let targetsToClick = [];
            const seenIds = new Set();

            for (const card of allCards) {
                if (targetsToClick.length >= 3) break;

                // Try to get a unique identifier to avoid clones/duplicates
                const feedId = await card.getAttribute('data-feed-id').catch(() => null);
                const reviewId = await card.getAttribute('data-review-id').catch(() => null);
                const uniqueId = feedId || reviewId;

                if (uniqueId) {
                    if (!seenIds.has(uniqueId)) {
                        seenIds.add(uniqueId);
                        targetsToClick.push(card);
                    }
                } else {
                    // Fallback: if no ID, just pick it if we have space, but prefer those with IDs first
                    // We'll do a second pass if we don't find 3 with IDs
                }
            }

            // Fallback: If we didn't find 3 unique IDs, just pick distinct indices with spacing
            if (targetsToClick.length < 3 && allCards.length > targetsToClick.length) {
                for (let i = 0; i < allCards.length; i += Math.max(1, Math.floor(allCards.length / 4))) {
                    if (targetsToClick.length >= 3) break;
                    if (!targetsToClick.includes(allCards[i])) {
                        targetsToClick.push(allCards[i]);
                    }
                }
            }

            console.log(`[StripSliderHelper] Selected ${targetsToClick.length} distinct cards for interaction.`);

            for (const target of targetsToClick) {
                try {
                    console.log(`[StripSliderHelper] Attempting aggressive interaction...`);

                    // Hover first to stabilize (stop marquee)
                    await target.hover({ force: true }).catch(() => { });
                    await context.waitForTimeout(1000); // 1s pause

                    // Click with force AND dispatchEvent
                    console.log(`[StripSliderHelper] Clicking card ${target}...`);
                    await target.click({ force: true, timeout: 5000 }).catch(() => { });
                    await target.dispatchEvent('click').catch(() => { });

                    // WAIT 2 SECONDS as per user request
                    console.log('[StripSliderHelper] Waiting 2s for popup to stabilize...');
                    await context.waitForTimeout(2000);

                    // Detect popup
                    const popupSelectors = ['.fe-review-box', '.fe-review-box-inner', '[class*="review-box"]', '[class*="popup"]'];
                    let popup = context.locator(popupSelectors.join(', ')).filter({ visible: true }).first();

                    if (!(await popup.isVisible())) {
                        const page = context.page ? context.page() : context;
                        popup = page.locator(popupSelectors.join(', ')).filter({ visible: true }).first();
                    }

                    if (await popup.isVisible()) {
                        console.log('[StripSliderHelper] Popup visible. Capturing viewport screenshot...');
                        // Use the page-level screenshot to capture the popup in its full context/viewport
                        const page = context.page ? context.page() : context;
                        const buf = await page.screenshot({ animations: 'disabled' }).catch(() => null);
                        if (buf) screenshots.push(buf);

                        // CLOSE the popup explicitly
                        console.log('[StripSliderHelper] Closing popup...');
                        const closeBtnSelectors = '.fe-review-box-close-icon, .feedspace-review-box-close-icon, [class*="close-icon"], [class*="close-btn"], button:has-text("X")';
                        let closeBtn = context.locator(closeBtnSelectors).filter({ visible: true }).first();

                        if (!(await closeBtn.isVisible())) {
                            const page = context.page ? context.page() : context;
                            closeBtn = page.locator(closeBtnSelectors).filter({ visible: true }).first();
                        }

                        if (await closeBtn.isVisible()) {
                            await closeBtn.click();
                        } else {
                            // Click outside (top-left of page)
                            const page = context.page ? context.page() : context;
                            await page.mouse.click(10, 10);
                        }

                        // WAIT 1 SECOND before next interaction
                        console.log('[StripSliderHelper] Waiting 1s before next review...');
                        await context.waitForTimeout(1000);
                    } else {
                        console.log('[StripSliderHelper] No popup appeared for this card.');
                    }
                } catch (err) {
                    console.warn(`[StripSliderHelper] Failed to interact with a card: ${err.message}`);
                }
            }

        } catch (error) {
            console.warn(`[StripSliderHelper] Interaction Error: ${error.message}`);
        }

        return screenshots;
    }
}

module.exports = StripSliderHelper;
