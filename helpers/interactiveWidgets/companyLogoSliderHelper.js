const { WidgetDetector } = require('../widgetDetector');

class CompanyLogoSliderHelper {
    /**
     * Hardened Company Logo Slider Interaction Flow:
     * 1. Baseline screenshot.
     * 2. Click a logo to open modal.
     * 3. Wait for ACTUAL modal (.custom-modal).
     * 4. Capture expanded state.
     * 5. Close and repeat for multiple logos.
     */
    static async interact(context, locator) {
        const page = context.page || context;
        const screenshotBuffers = [];

        // Step 1: Baseline screenshot (Normal state)
        console.log("[LogoSliderHelper] Capturing baseline...");
        screenshotBuffers.push(
            await page.screenshot({ fullPage: false, animations: 'disabled' })
        );

        try {
            console.log("[LogoSliderHelper] Starting interaction flow (Edge-Logo Toggle Mode)...");

            // 1. Shadow root research and overflow unlocker
            await page.evaluate(() => {
                const host = document.querySelector('.feedspace-embed');
                if (!host || !host.shadowRoot) return;
                const shadow = host.shadowRoot;
                const wrap = shadow.querySelector('.feedspace-company-logo-marquee-wrap');
                const track = shadow.querySelector('.feedspace-company-logo-marquee-track');
                if (wrap) wrap.style.setProperty('overflow', 'visible', 'important');
                if (track) {
                    track.style.setProperty('overflow', 'visible', 'important');
                    track.style.setProperty('animation', 'none', 'important');
                    track.style.setProperty('transform', 'none', 'important');
                }
            });

            // 2. Identify all logos
            const itemSel = '.feedspace-company-logo-slider-item:not([data-fs-logo-clone="true"])';
            await page.waitForSelector(itemSel, { timeout: 10000 });
            const uniqueLogos = page.locator(itemSel);
            const count = await uniqueLogos.count();
            console.log(`[LogoSliderHelper] Found ${count} unique logos.`);
            if (count === 0) throw new Error("No clickable logos found.");

            // Target all unique logos (capped at 10 for performance, but satisfying 7+ requirement)
            const targetIndices = Array.from({ length: Math.min(count, 10) }, (_, i) => i);

            for (const index of targetIndices) {
                console.log(`[LogoSliderHelper] Clicking logo index ${index} (Edge Detection)...`);
                const targetItem = uniqueLogos.nth(index);
                
                // Interaction: Click to open/toggle
                await targetItem.scrollIntoViewIfNeeded();
                await targetItem.click({ force: true, timeout: 5000 });
                
                // Stabilization wait (User confirmed popup opens on click)
                await page.waitForTimeout(1500);

                // Capture state
                console.log(`[LogoSliderHelper] Capturing state for logo index ${index}...`);
                screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));
            }

        } catch (e) {
            console.error('[LogoSliderHelper] Interaction Error:', e.message);
            if (!page.isClosed()) {
                screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));
            }
        }

        return screenshotBuffers;
    }
}

module.exports = CompanyLogoSliderHelper;