class CrossSliderHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[CrossSliderHelper] Starting interaction for cross slider...');

        const screenshotBuffers = [];

        // 1. Initial entire page capture/widget capture
        try {
            console.log('[CrossSliderHelper] Waiting for reviews and widget content...');
            await widgetLocator.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
            await page.waitForTimeout(2000);

            const contentSelector = '.feedspace-embed-card, .feedspace-review-card, .cross-slider-card, .fe-card, [class*="card"]';
            
            try {
                await widgetLocator.locator(contentSelector).first().waitFor({
                    state: 'visible',
                    timeout: 10000
                });
                console.log('[CrossSliderHelper] Cross slider content detected.');
            } catch (e) {
                console.warn('[CrossSliderHelper] Content detection timed out or not found. Proceeding with best-effort capture.');
            }

            await page.waitForTimeout(3000);

            // Capture the default view
            console.log('[CrossSliderHelper] Capturing default cross slider view...');
            const defaultShot = await widgetLocator.screenshot({ animations: 'disabled' }).catch(() => null);
            if (defaultShot) {
                screenshotBuffers.push(defaultShot);
            }
        } catch (e) {
            console.warn(`[CrossSliderHelper] Default view capture failed: ${e.message}`);
        }

        // 2. Interact with individual slider reviews to expand the popup
        // 2. Interact with individual slider reviews to expand the popup
        try {
            // Tag root
            const discoveryTempId = 'fs_root_' + Math.random().toString(36).substr(2, 9);
            await widgetLocator.evaluate((el, id) => el.setAttribute('data-fs-discovery-root', id), discoveryTempId);
            
            const cardSelectors = [
                '.feedspace-embed-card', 
                '.feedspace-review-card', 
                '.cross-slider-card', 
                '.fe-card', 
                '.horizontal-slider-card',
                '[class*="card"]'
            ];

            const cards = await page.evaluate(async ({ tempId, selectors }) => {
                const root = document.querySelector(`[data-fs-discovery-root="${tempId}"]`) || 
                             Array.from(document.querySelectorAll('*'))
                                  .find(n => n.shadowRoot && n.shadowRoot.querySelector(`[data-fs-discovery-root="${tempId}"]`))
                                  ?.shadowRoot.querySelector(`[data-fs-discovery-root="${tempId}"]`);
                
                if (!root) return [];

                const results = [];
                const visited = new Set();

                const findInRoot = (node) => {
                    if (!node) return;
                    
                    selectors.forEach(s => {
                        try {
                            const matches = node.querySelectorAll(s);
                            matches.forEach(m => {
                                if (!visited.has(m)) {
                                    visited.add(m);
                                    const box = m.getBoundingClientRect();
                                    if (box.width > 0 && box.height > 0) {
                                        let id = m.getAttribute('data-fs-temp-id');
                                        if (!id) {
                                            id = 'fs_card_' + Math.random().toString(36).substr(2, 9);
                                            m.setAttribute('data-fs-temp-id', id);
                                        }
                                        results.push({ id });
                                    }
                                }
                            });
                        } catch(e){}
                    });

                    Array.from(node.children || []).forEach(child => {
                        findInRoot(child);
                        if (child.shadowRoot) findInRoot(child.shadowRoot);
                    });
                };

                findInRoot(root);
                if (root.shadowRoot) findInRoot(root.shadowRoot);

                return results;
            }, { tempId: discoveryTempId, selectors: cardSelectors });

            const interactCount = Math.min(cards.length, 3); // check up to 3 cards
            console.log(`[CrossSliderHelper] Found ${cards.length} cards in Shadow DOM, interacting with ${interactCount}...`);

            for (let i = 0; i < interactCount; i++) {
                const target = cards[i];
                console.log(`[CrossSliderHelper] Clicking card ${i + 1}/${interactCount} (Target ID: ${target.id})...`);
                
                const selector = `[data-fs-temp-id="${target.id}"]`;

                await page.evaluate((sel) => {
                    const el = document.querySelector(sel) || 
                               Array.from(document.querySelectorAll('*'))
                                    .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                    ?.shadowRoot.querySelector(sel);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // AGGRESSIVE TEXT CLICK: Priority for text elements to trigger popup
                        const textEl = el.querySelector('.feedspace-review-text, .fe-text, [class*="text"], [class*="content"], p, span');
                        if (textEl) {
                            textEl.click();
                        } else {
                            el.click();
                        }
                    }
                }, selector);

                await page.waitForTimeout(3000); // wait for modal to expand

                console.log(`[CrossSliderHelper] Capturing expanded view for card ${i + 1}...`);
                const expandedShot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
                if (expandedShot) {
                    screenshotBuffers.push(expandedShot);
                }

                // Close popup by clicking away from the center
                await page.mouse.click(10, 10);
                await page.waitForTimeout(1000);
            }
        } catch (err) {
            console.warn(`[CrossSliderHelper] Interaction mapping failed: ${err.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = CrossSliderHelper;
