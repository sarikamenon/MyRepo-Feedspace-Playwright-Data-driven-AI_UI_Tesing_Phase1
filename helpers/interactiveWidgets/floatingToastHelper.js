class FloatingToastHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[FloatingToastHelper] Starting interactive floating toast validation (with truth injection)...');
        const screenshotBuffers = [];

        // Use the passed 'page' parameter directly.

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
                console.log('[FloatingToastHelper] Waiting for visible preview card (10s)...');
                await previewCard.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
            }

            // Fallback to global search if widget scope fails
            if (!(await previewCard.isVisible())) {
                previewCard = page.locator(previewSelectors.join(', ')).filter({ visible: true }).first();
                await previewCard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            }

            if (!(await previewCard.isVisible())) {
                console.warn('[FloatingToastHelper] No visible preview card found in widget scope or global scope.');
                
                // 🛡️ EMERGENCY FALLBACK: Scan for *any* element with high Z-index or floating characteristics
                const floatingFallback = page.locator('.fe-floating-preview, .fe-toast-card, [class*="floating-card"]').filter({ visible: true }).first();
                if (await floatingFallback.isVisible()) {
                    console.log('[FloatingToastHelper] Emergency fallback found a floating element.');
                    previewCard = floatingFallback;
                } else {
                    console.warn('[FloatingToastHelper] Final fallback: Taking viewport screenshot of current state.');
                    await page.waitForTimeout(3000); // Wait for potential late builders
                    screenshotBuffers.push(await page.screenshot({ fullPage: false }));
                    return screenshotBuffers;
                }
            }

            // 2️⃣ Capture Previews (Multiple Contexts)
            console.log('[FloatingToastHelper] Capturing multiple perspectives of the preview card...');
            await page.waitForTimeout(2000); // 🛡️ Wait for slide-up entrance animation
            
            // Context 1: Full Page Structure
            screenshotBuffers.push(await page.screenshot({ fullPage: true, animations: 'disabled' }));
            
            // Context 2: Natural Viewport appearance (ensures position:fixed is visible)
            screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));
            
            // Context 3: Highly focused element crop (with 50px safety padding)
            try {
                const box = await previewCard.boundingBox();
                if (box) {
                    const clip = {
                        x: Math.max(0, box.x - 50),
                        y: Math.max(0, box.y - 50),
                        width: box.width + 100,
                        height: box.height + 100
                    };
                    screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }));
                } else {
                    screenshotBuffers.push(await previewCard.screenshot({ animations: 'disabled' }));
                }
            } catch (e) {
                console.warn('[FloatingToastHelper] Could not take localized element screenshot of previewCard.');
            }

            // 3️⃣ Click to expand
            console.log('[FloatingToastHelper] Clicking preview to expand...');
            await previewCard.hover({ force: true }).catch(() => { });
            await page.waitForTimeout(1000); // 🛡️ Delay after hover for stability

            // Try multiple click methods
            try {
                // 🛡️ REWRITE: High-reliability interaction
                const box = await previewCard.boundingBox();
                if (box) {
                    console.log(`[FloatingToastHelper] Found card at [${Math.round(box.x)}, ${Math.round(box.y)}]. Executing pixel-center click.`);
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                } else {
                    await previewCard.click({ force: true, timeout: 5000 });
                }
            } catch (e) {
                console.log('[FloatingToastHelper] Primary click failed, trying dispatchEvent...');
                await previewCard.dispatchEvent('click').catch(() => { });
            }

            // 4️⃣ Capture after click
            console.log('[FloatingToastHelper] Capturing viewport screenshot after click...');
            screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));

            // 🕵️ Wait for any element that looks like a modal/popup box to appear
            const popupDetected = await page.waitForFunction((sel) => {
                const el = document.querySelector(sel) || 
                           Array.from(document.querySelectorAll('*'))
                                .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                ?.shadowRoot.querySelector(sel);
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 50 && rect.height > 50;
            }, '.fe-review-box, .fe-modal-content, [class*="review-box"], [class*="modal-window"]', { timeout: 8000 }).catch(() => false);

            if (!popupDetected) {
                console.warn('[FloatingToastHelper] No expansion popup container detected after click.');
            }

            // Wait for expanded box
            console.log('[FloatingToastHelper] Final settle before capture...');
            await page.waitForTimeout(2000);

            let expandedBox = page.locator(expandedSelectors.join(', ')).filter({ visible: true }).first();
            if (await expandedBox.isVisible()) {
                console.log('[FloatingToastHelper] Expansion visible! Capturing high-res contextual screenshot...');
                
                // 🛡️ Geometric Probe for "Flat Wall" Truncation
                const truncationCheck = await page.evaluate(() => {
                    const popup = document.querySelector('.fe-review-box, .fe-modal-content, [class*="review-box"], [class*="modal-window"]');
                    if (popup) {
                        const rect = popup.getBoundingClientRect();
                        const distToBottom = window.innerHeight - rect.bottom;
                        return { 
                            distToBottom,
                            isTruncated: distToBottom < 5 // Within 5px of bottom is suspicious
                        };
                    }
                    return { isTruncated: false };
                });

                if (truncationCheck.isTruncated) {
                    const msg = `TRUTH DATA: Floating Toast popup is truncated (Flat Wall at bottom). Distance to bottom: ${truncationCheck.distToBottom}px.`;
                    console.log(`[SYSTEM ALERT] ${msg}`);
                    if (geometricWarnings) geometricWarnings.push(msg);
                }

                // 🛡️ Take viewport screenshot (NOT element screenshot) to show truncation against screen bottom
                screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));

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
                try { screenshotBuffers.push(await page.screenshot({ fullPage: false })); } catch (e) { }
            }
        }

        return screenshotBuffers;
    }
}

module.exports = FloatingToastHelper;
