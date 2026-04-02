class CompanyLogoSliderHelper {
    static async interact(page, widgetLocator, captureCallback) {
        console.log('[CompanyLogoSliderHelper] Starting interactions...');

        const screenshotBuffers = [];

        // 1. Initial entire page capture/widget capture -> to check Gray Mode in scrolling state
        try {
            console.log('[CompanyLogoSliderHelper] Waiting for reviews and widget content...');
            await widgetLocator.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
            await page.waitForTimeout(2000);

            const contentSelector = '.feedspace-embed-card, .feedspace-review-card, .fe-card, [class*="card"], .company-logo-card, img';
            
            try {
                await widgetLocator.locator(contentSelector).first().waitFor({
                    state: 'visible',
                    timeout: 10000
                });
                console.log('[CompanyLogoSliderHelper] Logo slider content detected.');
            } catch (e) {
                console.warn('[CompanyLogoSliderHelper] Content detection timed out or not found.');
            }

            await page.waitForTimeout(3000);

            // Capture the default view with padding context
            console.log('[CompanyLogoSliderHelper] Capturing default logo slider view with context padding...');
            const box = await widgetLocator.boundingBox();
            if (box) {
                const clip = {
                    x: Math.max(0, box.x - 100),
                    y: Math.max(0, box.y - 100),
                    width: box.width + 200,
                    height: box.height + 200
                };
                const defaultShot = await page.screenshot({ clip, animations: 'disabled' }).catch(() => null);
                if (defaultShot) {
                    screenshotBuffers.push(defaultShot);
                }
            }
        } catch (e) {
            console.warn(`[CompanyLogoSliderHelper] Default view capture failed: ${e.message}`);
        }

        // 2. Interact with individual slider reviews to expand the popup using robust Shadow DFS
        try {
            const discoveryTempId = 'fs_root_' + Math.random().toString(36).substr(2, 9);
            await widgetLocator.evaluate((el, id) => el.setAttribute('data-fs-discovery-root', id), discoveryTempId);
            
            const cardSelectors = [
                '.feedspace-company-logo',
                '.feedspace-logo',
                '.fe-logo',
                '.company-logo-card', 
                '.feedspace-embed-card', 
                '.feedspace-review-card', 
                '.fe-card', 
                '[class*="card"]',
                'img'
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
                                            id = 'fs_logo_' + Math.random().toString(36).substr(2, 9);
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
            console.log(`[CompanyLogoSliderHelper] Found ${cards.length} valid logo targets in Shadow DOM, interacting with ${interactCount}...`);

            for (let i = 0; i < interactCount; i++) {
                const target = cards[i];
                console.log(`[CompanyLogoSliderHelper] Clicking logo/card ${i + 1}/${interactCount}...`);
                
                const selector = `[data-fs-temp-id="${target.id}"]`;

                await page.evaluate((sel) => {
                    const el = document.querySelector(sel) || 
                               Array.from(document.querySelectorAll('*'))
                                    .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                    ?.shadowRoot.querySelector(sel);
                    if (el) {
                        el.scrollIntoView({ block: 'center' });
                        
                        // Strategy 1: Click the element itself
                        el.click();
                        
                        // Strategy 2: If the element is a wrapper, click the inner image or link
                        const innerTarget = el.querySelector('img, a, button, [class*="logo"]');
                        if (innerTarget) {
                            innerTarget.click();
                        }
                    }
                }, selector);

                await page.waitForTimeout(3000); // wait for modal to expand

                console.log(`[CompanyLogoSliderHelper] Capturing expanded view for logo card ${i + 1}...`);
                const expandedShot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
                if (expandedShot) {
                    screenshotBuffers.push(expandedShot);
                }

                // Close popup by clicking away from the center
                await page.mouse.click(10, 10);
                await page.waitForTimeout(1000);
            }
        } catch (err) {
            console.warn(`[CompanyLogoSliderHelper] Interaction mapping failed: ${err.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = CompanyLogoSliderHelper;
