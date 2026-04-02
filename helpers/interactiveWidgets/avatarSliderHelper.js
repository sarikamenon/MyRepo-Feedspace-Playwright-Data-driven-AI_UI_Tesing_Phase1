class AvatarSliderHelper {
    /**
     * Interact with Avatar Slider widgets (Single Slider) by clicking arrows or avatars.
     * Captures high-res screenshots of the content area as it updates.
     *
     * @param {import('playwright').Page|import('playwright').Frame} context - Playwright context
     * @param {import('playwright').Locator} widgetLocator - The parent widget container
     * @param {string[]} geometricWarnings - Array to collect truth-data warnings
     * @returns {Promise<Buffer[]>} - Array of screenshot buffers
     */
    static async interact(context, widgetLocator, geometricWarnings = []) {
        console.log('[AvatarSliderHelper] Starting interactive avatar slider validation...');
        const screenshotBuffers = [];

        // Determine the actual page object for screenshots if needed
        const page = context.page ? context.page() : context;

        try {
            // 1️⃣ Determine the interaction targets (Arrows preferred, then Avatars)
            const root = widgetLocator || context;

            const arrowSelectors = [
                '.feedspace-avatar-slider-next',
                '.feedspace-items-slider-next',
                '.next-btn',
                '.swiper-button-next',
                '.carousel-control-next',
                'button:has-text(">")',
                '[class*="next"]',
                '[class*="right"]',
                'svg[class*="next"]'
            ];

            const avatarSelectors = [
                '.feedspace-avatar-dot',
                '.feedspace-avatar-button',
                '.slider-dot',
                '.feedspace-avatar-item',
                '.avatar-item',
                '.avatar-wrapper',
                'div[class*="avatar-item"]:not([class*="read-more"])',
                '.swiper-slide'
            ];

            let nextArrow = root.locator(arrowSelectors.join(', ')).filter({ visible: true }).first();
            let avatarControls = root.locator(avatarSelectors.join(', ')).filter({ visible: true });

            const hasArrows = await nextArrow.isVisible().catch(() => false);
            const avatarCount = await avatarControls.count().catch(() => 0);

            console.log(`[AvatarSliderHelper] Found: Arrows=${hasArrows}, Avatars=${avatarCount}`);

            // 2️⃣ Interaction Loop
            const maxScreenshots = 4; // Capture initial + 3 interactions
            const maxAttempts = 8;
            
            // Initial screenshot
            const initialShot = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
            if (initialShot) screenshotBuffers.push(initialShot);

            for (let i = 0; i < maxAttempts && screenshotBuffers.length < maxScreenshots; i++) {
                try {
                    let target = null;
                    if (hasArrows) {
                        target = nextArrow;
                        console.log(`[AvatarSliderHelper] Clicking Right Arrow (Interaction #${screenshotBuffers.length})`);
                    } else if (avatarCount > 0) {
                        target = avatarControls.nth(i % avatarCount);
                        console.log(`[AvatarSliderHelper] Clicking Avatar #${i % avatarCount + 1} (Interaction #${screenshotBuffers.length})`);
                    }

                    if (!target) break;

                    await target.scrollIntoViewIfNeeded().catch(() => { });
                    await target.click({ force: true, timeout: 5000 }).catch(() => { });
                    
                    // Wait for content stabilization
                    await context.waitForTimeout(2000);

                    // Locate content area for high-res focus
                    const contentArea = root.locator('.feedspace-items-slider, .feedspace-single-review-widget, .feedspace-elements-wrapper').filter({ visible: true }).first();
                    
                    if (await contentArea.isVisible()) {
                        await contentArea.scrollIntoViewIfNeeded().catch(() => { });
                    }

                    // Use the widgetLocator if available to capture the full context (arrows, avatars, text)
                    const shotTarget = widgetLocator || (await contentArea.isVisible() ? contentArea : page);
                    const buffer = await shotTarget.screenshot({
                        animations: 'disabled'
                    }).catch(() => null);

                    if (buffer) {
                        // Check for duplicate screenshots (if content didn't actually change)
                        const lastBuffer = screenshotBuffers[screenshotBuffers.length - 1];
                        if (lastBuffer && buffer.equals(lastBuffer)) {
                            console.log('[AvatarSliderHelper] Content unchanged, skipping duplicate screenshot.');
                        } else {
                            screenshotBuffers.push(buffer);
                        }
                    }
                } catch (e) {
                    console.warn(`[AvatarSliderHelper] Interaction step failed: ${e.message}`);
                }
            }

            console.log(`[AvatarSliderHelper] Interaction complete. Captured ${screenshotBuffers.length} states.`);
        } catch (error) {
            console.warn(`[AvatarSliderHelper] Error: ${error.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarSliderHelper;
