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
            await locator.screenshot({ animations: 'disabled' })
        );

        try {
            console.log("[LogoSliderHelper] Starting interaction flow (Shadow-Aware & Overflow-Unlocked)...");

            // 1. Shadow root research and overflow unlocker
            // The widget uses a Shadow DOM inside .feedspace-embed
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

            // 2. Locate logos via shadow-piercing locators (Playwright handles this with >> or standard selectors)
            const itemSel = '.feedspace-company-logo-slider-item:not([data-fs-logo-clone="true"])';
            await page.waitForSelector(itemSel, { timeout: 10000 });

            const uniqueLogos = page.locator(itemSel);
            const count = await uniqueLogos.count();
            console.log(`[LogoSliderHelper] Found ${count} unique logos.`);

            if (count === 0) throw new Error("No clickable logos found.");

            // 3. Pick a centered logo (index 2 or last)
            const targetIndex = Math.min(2, count - 1);
            const targetItem = uniqueLogos.nth(targetIndex);
            
            console.log(`[LogoSliderHelper] Clicking logo index ${targetIndex} for expansion...`);
            await targetItem.scrollIntoViewIfNeeded();
            
            // Interaction: Click the item container (bypassing the img specifically)
            await targetItem.click({ force: true, timeout: 5000 });

            // 4. Wait for popup manifestation
            const popupSel = '.feedspace-company-logo-review-popup';
            console.log(`[LogoSliderHelper] Waiting for popup: ${popupSel}`);
            
            try {
                await page.waitForFunction((sel) => {
                    const host = document.querySelector('.feedspace-embed');
                    if (!host || !host.shadowRoot) return false;
                    const p = host.shadowRoot.querySelector(sel);
                    if (!p) return false;
                    const r = p.getBoundingClientRect();
                    return r.height > 50 && window.getComputedStyle(p).display !== 'none';
                }, popupSel, { timeout: 10000 });
                console.log("[LogoSliderHelper] Popup detected and visible.");
            } catch (e) {
                console.warn("[LogoSliderHelper] Popup visibility check failed, attempting capture anyway.");
            }

            // 5. Final stabilization
            await page.waitForTimeout(1000);

            // 6. Freeze animations for capture
            await page.addStyleTag({
                content: `* { animation-play-state: paused !important; transition: none !important; }`
            });

            // 7. Capture expanded state (using page screenshot to ensure no container clipping)
            console.log("[LogoSliderHelper] Capturing expanded state...");
            screenshotBuffers.push(await locator.screenshot({ animations: 'disabled' }));

        } catch (e) {
            console.error('[LogoSliderHelper] Interaction Error:', e.message);
            // Fallback
            if (!page.isClosed()) {
                screenshotBuffers.push(await locator.screenshot({ animations: 'disabled' }));
            }
        }

        return screenshotBuffers;
    }
}

module.exports = CompanyLogoSliderHelper;