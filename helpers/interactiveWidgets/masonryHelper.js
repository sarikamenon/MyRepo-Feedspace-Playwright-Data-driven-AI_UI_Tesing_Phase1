const { WidgetDetector } = require('../widgetDetector');

class MasonryHelper {
    /**
     * Hardened Masonry Interaction Flow (Fix for Restricted Overflow Clipping):
     * 1. Multi-stage expansion ('Load More' recursive loop)
     * 2. Scoped CTA detection (Scoped to widget to avoid navigation noise)
     * 3. Layout "Unlocking": Strips 'overflow', 'max-height', and 'clip' from parents
     *    to ensure a full vertical record of the 2800px+ grid.
     */
    static async interact(context, locator) {
        const { page } = context;
        const screenshotBuffers = [];
        const cardSelector = '.feedspace-review-card';
        const ctaText = 'Ready to get started?'; 
        const ctaButtonText = 'Get Started';
        
        try {
            console.log("[MasonryHelper] Starting 'Overflow Unlock' expansion flow...");

            const getCardCount = async () => {
                const frame = page.frameLocator('iframe[src*="feedspace"]').first();
                const frameExists = await frame.locator('body').count() > 0;
                
                if (frameExists) {
                    return await frame.locator(cardSelector).count();
                }

                return await page.evaluate((selector) => {
                    const findCards = (root) => {
                        let count = root.querySelectorAll(selector).length;
                        const children = Array.from(root.children || []);
                        for (const child of children) {
                            if (child.shadowRoot) count += findCards(child.shadowRoot);
                        }
                        return count;
                    };
                    return findCards(document.body);
                }, cardSelector);
            };

            const isCTAPresent = async () => {
                const frame = page.frameLocator('iframe[src*="feedspace"]').first();
                const frameExists = await frame.locator('body').count() > 0;

                if (frameExists) {
                    const content = await frame.locator('body').textContent();
                    return content.toLowerCase().includes(ctaText.toLowerCase()) || 
                           content.toLowerCase().includes(ctaButtonText.toLowerCase());
                }

                return await page.evaluate(({ text, btnText, widgetSelector }) => {
                    const widget = document.querySelector(widgetSelector) || document.body;
                    const findText = (root) => {
                        const content = root.textContent || "";
                        const hasPromo = content.toLowerCase().includes(text.toLowerCase()) || 
                                       content.toLowerCase().includes(btnText.toLowerCase());
                        if (hasPromo) return true;
                        
                        const children = Array.from(root.children || []);
                        for (const child of children) {
                            if (child.shadowRoot && findText(child.shadowRoot)) return true;
                        }
                        return false;
                    };
                    return findText(widget);
                }, { text: ctaText, btnText: ctaButtonText, widgetSelector: 'feedspace-widget' });
            };

            const unlockLayout = async (enable) => {
                await page.evaluate(({ status, widgetSelector }) => {
                    const widget = document.querySelector(widgetSelector);
                    if (!widget) return;
                    
                    let curr = widget;
                    while (curr && curr !== document.documentElement) {
                        if (status) {
                            curr.dataset.origOverflow = curr.style.overflow;
                            curr.dataset.origHeight = curr.style.height;
                            curr.dataset.origMaxHeight = curr.style.maxHeight;
                            curr.dataset.origClip = curr.style.clip;
                            
                            curr.style.setProperty('overflow', 'visible', 'important');
                            curr.style.setProperty('height', 'auto', 'important');
                            curr.style.setProperty('max-height', 'none', 'important');
                            curr.style.setProperty('clip', 'auto', 'important');
                        } else {
                            if (curr.dataset.origOverflow !== undefined) curr.style.overflow = curr.dataset.origOverflow;
                            if (curr.dataset.origHeight !== undefined) curr.style.height = curr.dataset.origHeight;
                            if (curr.dataset.origMaxHeight !== undefined) curr.style.maxHeight = curr.dataset.origMaxHeight;
                            if (curr.dataset.origClip !== undefined) curr.style.clip = curr.dataset.origClip;
                        }
                        curr = curr.parentElement;
                    }
                    // Special fix for common app wrappers
                    if (status) {
                        document.body.style.setProperty('height', 'auto', 'important');
                        document.body.style.setProperty('overflow', 'visible', 'important');
                    }
                }, { status: enable, widgetSelector: 'feedspace-widget' });
            };

            const captureFullHeight = async (label) => {
                console.log(`[MasonryHelper] Capturing ${label} with unlocked layout...`);
                
                await unlockLayout(true);
                await page.waitForTimeout(2000); // Allow layout shift and image loading

                // Trigger final lazy loads by scrolling
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1500);
                await page.evaluate(() => window.scrollTo(0, 0));
                await page.waitForTimeout(500);

                const buffer = await page.screenshot({ 
                    fullPage: true,
                    animations: 'disabled'
                });
                
                await unlockLayout(false);
                return buffer;
            };

            // ── STEP 1: Baseline ─────────────────────────────────────────────
            screenshotBuffers.push(await captureFullHeight('part1'));

            // ── STEP 3: Deep Expansion ───────────────────────────────────────
            let clickCount = 0;
            const maxClicks = 12;
            let initialCount = await getCardCount();

            while (clickCount < maxClicks) {
                clickCount++;
                console.log(`[MasonryHelper] Click ${clickCount}: Expanding Masonry...`);

                const frame = page.frameLocator('iframe[src*="feedspace"]').first();
                const loadMoreBtn = frame.locator('.feedspace-load-more-btn, button:has-text("Load More")').first();
                
                let clickSuccess = false;
                if (await loadMoreBtn.count() > 0) {
                    console.log("[MasonryHelper] Found Load More in frame.");
                    await loadMoreBtn.click();
                    clickSuccess = true;
                } else {
                    clickSuccess = await page.evaluate((btnText) => {
                        const findBtn = (node) => {
                            const specific = node.querySelector('.feedspace-load-more-btn');
                            if (specific) return specific;
                            const labels = Array.from(node.querySelectorAll('span, button'));
                            const target = labels.find(l => l.textContent && l.textContent.trim().toLowerCase() === btnText.toLowerCase());
                            if (target) return target.closest('button') || target;
                            const children = Array.from(node.children || []);
                            for (const child of children) {
                                if (child.shadowRoot) {
                                    const found = findBtn(child.shadowRoot);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        const btn = findBtn(document.body);
                        if (btn && btn.offsetParent !== null) {
                            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            btn.click();
                            return true;
                        }
                        return false;
                    }, "Load More");
                }

                if (!clickSuccess) break;

                // Wait for cards
                for (let j = 0; j < 10; j++) {
                    await page.waitForTimeout(1000);
                    const currentCount = await getCardCount();
                    if (currentCount > initialCount) {
                        initialCount = currentCount;
                        break;
                    }
                }
                
                if (await isCTAPresent()) {
                    console.log(`[MasonryHelper] Inline CTA found after ${clickCount} clicks!`);
                    await page.waitForTimeout(1500); 
                    break;
                }
            }

            // ── STEP 5: Final Unconstrained Capture ──────────────────────────
            screenshotBuffers.push(await captureFullHeight('part2'));
            console.log('[MasonryHelper] Deep interaction and capture finalized.');

        } catch (e) {
            console.error('[MasonryHelper] Interaction Error:', e.message);
        }

        return screenshotBuffers;
    }
}

module.exports = MasonryHelper;
