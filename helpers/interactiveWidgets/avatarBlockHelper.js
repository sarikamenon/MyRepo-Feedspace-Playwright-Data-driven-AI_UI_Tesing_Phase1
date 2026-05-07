class AvatarBlockHelper {
    /**
     * Interact with Avatar Block widgets.
     * Clicks avatar cards to open popups and captures high-res screenshots.
     */
    static async interact(context, widgetLocator, geometricWarnings) {
        console.log('[AvatarBlockHelper] Starting interactive avatar block validation...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        let styleHandle = null;

        try {
            // 0. MOTION FREEZE: Inject CSS to pause all animations and transitions
            console.log('[AvatarBlockHelper] Freezing motion in interaction context...');
            styleHandle = await context.addStyleTag({
                content: `
                    *, *::before, *::after {
                        animation-play-state: paused !important;
                        transition: none !important;
                        -webkit-transition: none !important;
                    }
                `
            }).catch(e => {
                console.warn(`[AvatarBlockHelper] Failed to inject motion freeze: ${e.message}`);
                return null;
            });

            // 1. Initial focused widget screenshot
            console.log('[AvatarBlockHelper] Capturing focused widget screenshot...');
            const widgetShot = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
            if (widgetShot) screenshots.push(widgetShot);

            // 2. Detect Unique Avatars
            // User indicated: feedspace-embed-main, feedspace-avatar-blocks-widget relative
            const cardSelectors = [
                '.feedspace-avatar-blocks-widget .feedspace-avatar-group-item',
                '.feedspace-avatar-blocks-widget [class*="avatar"]',
                '.feedspace-avatar-block',
                '.fe-avatar-block',
                '.review-card',
                'div[data-feed-id]',
                'div[data-review-id]'
            ];

            const cardLocator = context.locator(cardSelectors.join(', ')).filter({ visible: true });
            const allCards = await cardLocator.all();
            console.log(`[AvatarBlockHelper] Identified ${allCards.length} visible elements matching avatar block selectors.`);

            let targetsToClick = [];
            const seenIds = new Set();
            const MAX_CAPTURES = 10; // Increased to 10 for more thorough scanning as requested.
            const TARGET_POOL_SIZE = 15;

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

            for (let i = 0; i < targetsToClick.length; i++) {
                const target = targetsToClick[i];
                if (successfulCaptures >= MAX_CAPTURES) break;
                if (page.isClosed()) break;

                try {
                    console.log(`[AvatarBlockHelper] Processing candidate ${successfulCaptures + 1}...`);

                    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });

                    // Hover to trigger fade-in effect if 'Hover Fadeout Effect' is enabled
                    await target.hover({ force: true }).catch(() => { });
                    await context.waitForTimeout(500).catch(() => { }); // Wait for hover transition

                    // Use evaluate to bypass intersection/marquee issues for off-screen sliding avatars
                    await target.evaluate(node => node.click()).catch(async () => {
                        await target.click({ force: true, timeout: 3000 }).catch(() => { });
                    });
                    await context.waitForTimeout(1500).catch(() => { });

                    const popupSelectors = [
                        '.fe-review-box',
                        '.fe-review-box-inner',
                        '.feedspace-review-box-main',
                        '.feedspace-review-box',
                        '[class*="review-box"]',
                        '.fe-modal-content'
                    ];
                    const popup = context.locator(popupSelectors.join(', ')).filter({ visible: true }).first();

                    const isVisible = await popup.isVisible().catch(() => false);
                    if (isVisible) {
                        console.log(`[AvatarBlockHelper] Capture ${successfulCaptures + 1} Popup SUCCESS.`);

                        // Note: The 'Read More' expanding logic has been removed. 
                        // The widget now automatically opens the popup in an expanded state. 
                        // Clicking the button would collapse the text and truncate the review.
                        // ENSURE FULL VISIBILITY: Scroll the popup itself into the center of the viewport
                        await popup.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                        await context.waitForTimeout(1000); // Allow media to play slightly

                        // DOM TRUTH Check: Audio/Video
                        const hasMedia = await popup.evaluate(el => {
                            const vids = el.querySelectorAll('video');
                            const auds = el.querySelectorAll('audio');
                            return (vids.length > 0 || auds.length > 0);
                        }).catch(() => false);

                        if (hasMedia) {
                            console.log(`[AvatarBlockHelper] Media (Audio/Video) detected playing in popup.`);
                            if (geometricWarnings) geometricWarnings.push(`TRUTH DATA: Audio/Video player is open and rendering in popup ${successfulCaptures + 1}.`);
                        }

                        // Capture the popup + viewport context
                        const buf = await page.screenshot({
                            fullPage: false,
                            animations: 'disabled'
                        }).catch(() => null);

                        if (buf) {
                            screenshots.push(buf);
                            successfulCaptures++;
                        }

                        // Close popup to prepare for the next avatar
                        const closeBtnSelectors = '.fe-review-box-close-icon, .feedspace-review-box-close-icon, .close-icon, .close-btn, button:has-text("X")';
                        let closeBtn = context.locator(closeBtnSelectors).filter({ visible: true }).first();
                        const isCloseVisible = await closeBtn.isVisible().catch(() => false);
                        if (isCloseVisible) {
                            await closeBtn.click({ force: true }).catch(() => { });
                        } else {
                            // Fallback: Press Escape and click top-left of viewport
                            await page.keyboard.press('Escape').catch(() => { });
                            await page.mouse.click(10, 10).catch(() => { });
                        }
                        await context.waitForTimeout(1000).catch(() => { });
                    }
                } catch (err) {
                    console.warn(`[AvatarBlockHelper] Interaction failed: ${err.message}`);
                }
            }

            // Removed separate branding capture because it is already visible in the main screenshot,
            // and sending a small branding-only screenshot causes the AI to fail other rules (e.g. missing date).

        } catch (error) {
            console.warn(`[AvatarBlockHelper] Interaction Error: ${error.message}`);
        } finally {
            // Restore motion if style handle exists
            if (styleHandle && !page.isClosed()) {
                await styleHandle.evaluate(el => el.remove()).catch(() => { });
            }
        }

        return screenshots;
    }
}

module.exports = AvatarBlockHelper;
