class FloatingToastHelper {
    static async interact(interactionContext, widgetLocator) {
        console.log('[FloatingToastHelper] Starting interactive floating toast validation...');
        const screenshotBuffers = [];

        // Derive page/frame from the interactionContext (which might be an iframe or page)
        const page = interactionContext.page ? interactionContext.page() : (interactionContext.goto ? interactionContext : interactionContext);

        const previewSelectors = [
            '.fe-floating-preview',
            '.fe-toast-card',
            '.fe-floating-toast',
            '[class*="floating-toast"]',
            '[class*="toast-preview"]',
            '.feedspace-toast',
            '.feedspace-card',
            '.fe-chat-bubble',
            '.fe-bubble-launcher',
            '[class*="chat-box"]'
        ];

        const expandedSelectors = [
            '.fe-review-box',
            '.fe-review-box-inner',
            '.fe-modal-content',
            '[class*="review-box"]',
            '.feedspace-expanded-review'
        ];

        const closeBtnSelectors = [
            '.fe-review-box-close-icon',
            '[class*="close-icon"]',
            '[class*="close-btn"]',
            'button:has-text("X")',
            '.fe-modal-close'
        ];

        try {
            // Revert to single interaction
            console.log('[FloatingToastHelper] Searching for preview card...');

            // 1️⃣ Find first visible preview card
            let previewCard = widgetLocator.locator(previewSelectors.join(', ')).filter({ visible: true }).first();

            // Wait briefly for toast to appear
            if (!(await previewCard.isVisible())) {
                console.log('[FloatingToastHelper] Waiting for visible preview card (5s)...');
                await previewCard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            }

            // Fallback to global search if widget scope fails
            if (!(await previewCard.isVisible())) {
                previewCard = page.locator(previewSelectors.join(', ')).filter({ visible: true }).first();
                await previewCard.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
            }

            if (!(await previewCard.isVisible())) {
                console.warn('[FloatingToastHelper] No visible preview card found. Taking default screenshot.');
                screenshotBuffers.push(await page.screenshot({ fullPage: true }));
                return screenshotBuffers;
            }

            // 2️⃣ Capture Preview
            console.log('[FloatingToastHelper] Capturing preview screenshot...');
            screenshotBuffers.push(await page.screenshot({ fullPage: true, animations: 'disabled' }));

            // 3️⃣ Click to expand
            console.log('[FloatingToastHelper] Clicking preview to expand...');
            await previewCard.hover({ force: true }).catch(() => { });
            await previewCard.click({ force: true, timeout: 5000 }).catch(() => { });
            await previewCard.dispatchEvent('click').catch(() => { });

            // Wait for expanded box
            console.log('[FloatingToastHelper] Waiting for expansion popup...');
            let expandedBox = page.locator(expandedSelectors.join(', ')).filter({ visible: true }).first();
            await expandedBox.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });

            await page.waitForTimeout(2000); // Allow settle

            // 4️⃣ Capture expanded box
            if (await expandedBox.isVisible()) {
                console.log('[FloatingToastHelper] Expansion visible! Capturing high-res screenshot...');
                screenshotBuffers.push(await expandedBox.screenshot({ animations: 'disabled' }));

                // 5️⃣ Close the expansion
                console.log('[FloatingToastHelper] Closing expansion popup...');
                let closeBtn = page.locator(closeBtnSelectors.join(', ')).filter({ visible: true }).first();
                if (await closeBtn.isVisible()) {
                    await closeBtn.click({ force: true }).catch(() => { });
                } else {
                    console.log('[FloatingToastHelper] Close button not found, clicking outside...');
                    await page.mouse.click(20, 20);
                }
                await page.waitForTimeout(2000);
            } else {
                console.warn('[FloatingToastHelper] Expansion popup did not appear.');
            }

        } catch (error) {
            console.error(`[FloatingToastHelper] Error: ${error.message}`);
            if (screenshotBuffers.length === 0) {
                try { screenshotBuffers.push(await page.screenshot({ fullPage: true })); } catch (e) { }
            }
        }

        return screenshotBuffers;
    }
}

module.exports = FloatingToastHelper;
