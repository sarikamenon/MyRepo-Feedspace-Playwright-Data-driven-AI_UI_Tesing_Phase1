class AvatarSliderHelper {
    /**
     * Interact with Avatar Slider widgets by clicking avatars.
     * Capture **at least 3 popup screenshots** for reliable validation.
     *
     * @param {import('playwright').Page} context - Playwright page or frame object
     * @returns {Promise<Buffer[]>} - Array of screenshot buffers
     */
    static async interact(context) {
        console.log('[AvatarSliderHelper] Starting interactive avatar slider validation...');
        const screenshotBuffers = [];

        // Determine the actual page object for full-page screenshots
        const page = context.page ? context.page() : context;

        try {
            // 1️⃣ Locate all avatar buttons (resilient selector)
            // Exclude 'read-more' buttons which are inside the review cards
            let avatarControls = context.locator([
                'div:has([data-index]) button:not(.feedspace-read-more-btn):not(.read-more)',
                '.feedspace-avatar-button',
                '.slider-dot',
                '.feedspace-avatar-item',
                '.avatar-item',
                '.avatar-wrapper',
                'div[class*="avatar-item"]:not([class*="read-more"])',
                '.swiper-slide',
                '.owl-item'
            ].join(', ')).filter({ visible: true });

            let totalControls = await avatarControls.count();
            console.log(`[AvatarSliderHelper] Found ${totalControls} visible avatar/slide controls.`);

            // Fallback to arrows if no discrete avatar buttons found
            let usingArrows = false;
            if (totalControls === 0) {
                console.log('[AvatarSliderHelper] No avatar buttons found. Attempting to find navigation arrows...');
                avatarControls = context.locator([
                    '.next-btn',
                    '.swiper-button-next',
                    '.carousel-control-next',
                    'button:has-text(">")',
                    'span:has-text(">")',
                    '[class*="next"]',
                    '[class*="right"]',
                    'svg[class*="next"]',
                    'svg[class*="right"]'
                ].join(', ')).filter({ visible: true });
                totalControls = await avatarControls.count();
                if (totalControls > 0) {
                    console.log(`[AvatarSliderHelper] Found ${totalControls} navigation arrows. Using arrows for interaction.`);
                    usingArrows = true;
                }
            }

            if (totalControls === 0) {
                console.warn('[AvatarSliderHelper] No interactive controls found.');
                return screenshotBuffers;
            }

            // 2️⃣ Interaction Loop
            const maxScreenshots = 3;
            const maxAttempts = 10; // Try more avatars to find a long review with Read More
            let hasCapturedReadMore = false;

            for (let i = 0; i < totalControls && screenshotBuffers.length < maxScreenshots && i < maxAttempts; i++) {
                const control = usingArrows ? avatarControls.first() : avatarControls.nth(i);

                try {
                    // Click to reveal/scroll content
                    await control.click({ force: true, timeout: 5000 });
                    console.log(`[AvatarSliderHelper] Interaction #${i + 1} (${usingArrows ? 'Arrow' : 'Avatar'})`);

                    // Wait for the UI to update and content to stabilize
                    // CI/Headless might be slower, so we poll for text change

                    // Locate the review content area
                    const reviewBox = context.locator('.feedspace-single-review-widget, .feedspace-elements-wrapper').filter({ visible: true }).first();
                    const reviewText = context.locator('.feedspace-element-review-contain-box, .feedspace-review-content').filter({ visible: true }).first();

                    if (await reviewBox.isVisible()) {
                        await reviewBox.scrollIntoViewIfNeeded();
                    }

                    let text = '';
                    const startTime = Date.now();
                    while (Date.now() - startTime < 8000) {
                        text = await reviewText.innerText().catch(() => '');
                        if (text && text.trim().length >= 5) break;
                        await context.waitForTimeout(500);
                    }

                    if (!text || text.trim().length < 5) {
                        console.log(`[AvatarSliderHelper] Review content appears empty/loading after timeout. Skipping screenshot for index ${i}.`);
                        continue;
                    }

                    // Check if 'Read More' is present
                    const readMoreBtn = context.locator('.feedspace-read-more-btn, button:has-text("Read More"), .read-more').filter({ visible: true }).first();
                    const isReadMoreVisible = await readMoreBtn.isVisible();

                    if (isReadMoreVisible) {
                        const box = await readMoreBtn.boundingBox();
                        if (box && box.width > 0 && box.height > 0) {
                            console.log(`[AvatarSliderHelper] Found physical Read More button: ${Math.round(box.width)}x${Math.round(box.height)}`);
                            hasCapturedReadMore = true;
                        }
                    }

                    // High-Resolution Focus: Capture the review box area specifically
                    const buffer = await (await reviewBox.isVisible() ? reviewBox : page).screenshot({
                        animations: 'disabled'
                    }).catch(() => null);

                    if (buffer) {
                        screenshotBuffers.push(buffer);
                        console.log(`[AvatarSliderHelper] Captured high-res state #${screenshotBuffers.length} ${isReadMoreVisible ? '(Confirmed Read More)' : '(Short Review)'}`);
                    }
                } catch (e) {
                    console.warn(`[AvatarSliderHelper] Interaction failed: ${e.message}`);
                }

                // Finish if we have 3 shots and at least one has a Read More (if we've searched enough)
                if (screenshotBuffers.length >= maxScreenshots && (hasCapturedReadMore || i >= maxAttempts - 1)) break;
            }

            console.log(`[AvatarSliderHelper] Avatar slider interaction complete. Captured ${screenshotBuffers.length} total states.`);
        } catch (error) {
            console.warn(`[AvatarSliderHelper] Error during interaction: ${error.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarSliderHelper;
