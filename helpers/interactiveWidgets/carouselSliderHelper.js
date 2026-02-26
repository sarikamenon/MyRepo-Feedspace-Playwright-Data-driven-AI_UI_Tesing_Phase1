class CarouselSliderHelper {
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
            console.log('[CarouselSliderHelper] Waiting 5s for initial stabilization...');
            await page.waitForTimeout(5000);

            // 1. First Screenshot: Entire Page
            console.log('[CarouselSliderHelper] Capture 1/3: Entire Page');
            const fullPageShot = await page.screenshot({
                fullPage: true,
                animations: 'disabled'
            }).catch(() => null);
            if (fullPageShot) screenshots.push(fullPageShot);

            await page.waitForTimeout(3000); // 3s gap

            // 2. Second Screenshot: Focused on Widget
            console.log('[CarouselSliderHelper] Capture 2/3: Focused on Widget');
            const focusShot1 = await widgetLocator.screenshot({
                animations: 'disabled',
                scale: 'css'
            }).catch(() => null);
            if (focusShot1) screenshots.push(focusShot1);

            await page.waitForTimeout(3000); // 3s gap

            // 3. Third Screenshot: Focused on Widget
            console.log('[CarouselSliderHelper] Capture 3/3: Focused on Widget');
            const focusShot2 = await widgetLocator.screenshot({
                animations: 'disabled',
                scale: 'css'
            }).catch(() => null);
            if (focusShot2) screenshots.push(focusShot2);

            console.log(`[CarouselSliderHelper] Interaction complete. ${screenshots.length} screenshots captured.`);

        } catch (error) {
            console.warn(`[CarouselSliderHelper] Interaction Warning: ${error.message}`);
        }

        return screenshots;
    }
}

module.exports = CarouselSliderHelper;
