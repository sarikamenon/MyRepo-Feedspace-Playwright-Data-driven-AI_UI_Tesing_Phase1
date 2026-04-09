class FloatingToastHelper {
    /**
     * Helper to find an element even if it's inside a Shadow DOM.
     * @param {import('playwright').Page} page 
     * @param {string} selector 
     * @returns {Promise<import('playwright').ElementHandle | null>}
     */
    static async findDeep(page, selector) {
        return await page.evaluateHandle((sel) => {
            function find(s) {
                const el = document.querySelector(s);
                if (el) return el;
                const all = document.querySelectorAll('*');
                for (const n of all) {
                    if (n.shadowRoot) {
                        const res = n.shadowRoot.querySelector(s);
                        if (res) return res;
                    }
                }
                return null;
            }
            return find(sel);
        }, selector).then(h => h.asElement());
    }

    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[FloatingToastHelper] Starting hardened unique multi-card validation loop...');
        const screenshotBuffers = [];
        const capturedSignatures = new Set();
        const maxUniqueCaptures = 6;

        const previewSelectors = [
            '.fe-floating-preview', '.fe-toast-card', '.fe-floating-toast', '[class*="floating-toast"]',
            '[class*="toast-preview"]', '.feedspace-toast', '.feedspace-card', '.fe-chat-bubble',
            '.fe-bubble-launcher', '[class*="chat-box"]'
        ];
        const expandedSelectors = [
            '.fe-review-box', '.fe-modal-content', '[class*="review-box"]', '.feedspace-expanded-review'
        ];
        const closeBtnSelectors = [
            '.fe-review-box-close-icon', '[class*="close-icon"]', '.fe-modal-close', 'button'
        ];

        try {
            // Initial settle for entrance animations
            await page.waitForTimeout(3000);
            let consecutiveDuplicates = 0;

            for (let i = 0; i < 20 && screenshotBuffers.length < (maxUniqueCaptures * 2); i++) {
                // 🧹 HARD RESET: Clear any stale popups from previous iterations
                await page.evaluate(() => {
                    function hideAll(node) {
                        if (!node) return;
                        node.querySelectorAll('.fe-review-box, [class*="review-box"], [class*="expanded"]').forEach(p => {
                            p.style.setProperty('display', 'none', 'important');
                            p.style.setProperty('visibility', 'hidden', 'important');
                            p.style.setProperty('opacity', '0', 'important');
                        });
                        Array.from(node.children || []).forEach(c => {
                            hideAll(c);
                            if (c.shadowRoot) hideAll(c.shadowRoot);
                        });
                    }
                    hideAll(document);
                }).catch(() => { });
                await page.mouse.click(20, 20); // Bounce off any existing focus
                await page.waitForTimeout(500);

                // 1️⃣ Find preview card (Scoped -> Global -> Shadow-DOM Deep)
                let previewCard = widgetLocator.locator(previewSelectors.join(', ')).filter({ visible: true }).first();
                if (!(await previewCard.isVisible())) {
                    previewCard = page.locator(previewSelectors.join(', ')).filter({ visible: true }).first();
                }

                // Shadow-DOM Fallback
                if (!(await previewCard.isVisible())) {
                    const shadowEl = await this.findDeep(page, previewSelectors.join(', '));
                    if (shadowEl) previewCard = shadowEl;
                }

                if (!(await previewCard.isVisible())) {
                    console.log('[FloatingToastHelper] No preview card visible. Waiting for cycle...');
                    await page.waitForTimeout(1500);
                    continue;
                }

                // 🆔 Surgical Identity Tracking (Name + Alpha-Numeric Body)
                const reviewerName = await previewCard.locator('.fe-reviewer-name, .fe-name, b, strong, [class*="name"]').first().innerText().catch(() => "");
                const fullText = await previewCard.innerText().catch(() => "");

                // Nuclear Scrub: Strip relative times (e.g. "2 hours ago"), non-alpha noise, and whitespace
                const scrub = (str) => str.replace(/\b\d+\s+(year|month|day|hour|min|sec)s?\s+ago\b/ig, '')
                    .replace(/[^a-zA-Z0-9]/g, '')
                    .toLowerCase()
                    .substring(0, 150);

                const signature = scrub(reviewerName + fullText);

                if (!signature || signature.length < 5) {
                    await page.waitForTimeout(1000);
                    continue;
                }

                if (capturedSignatures.has(signature)) {
                    consecutiveDuplicates++;
                    console.log(`[FloatingToastHelper] Duplicate signature detected for "${reviewerName || 'Unknown'}". Attempt ${consecutiveDuplicates}/4.`);

                    if (consecutiveDuplicates >= 4) {
                        console.log('[FloatingToastHelper] Cycle complete (Stagnation Guard triggered). Ending validation.');
                        break;
                    }

                    await page.waitForTimeout(3000); // Wait for the widget to slide out
                    continue;
                }

                // Reset counter on success
                consecutiveDuplicates = 0;
                console.log(`[FloatingToastHelper] 🎯 Captured unique card: "${reviewerName || signature.substring(0, 20)}..."`);
                capturedSignatures.add(signature);

                // 📸 Capture Preview (Focused Crop)
                try {
                    const pBox = await previewCard.boundingBox();
                    if (pBox) {
                        const vSize = page.viewportSize();
                        const padding = 60; // Generous context
                        const clipX = Math.max(0, pBox.x - padding);
                        const clipY = Math.max(0, pBox.y - padding);
                        screenshotBuffers.push(await page.screenshot({
                            clip: {
                                x: clipX,
                                y: clipY,
                                width: Math.min(pBox.width + (padding * 2), vSize.width - clipX),
                                height: Math.min(pBox.height + (padding * 2), vSize.height - clipY)
                            },
                            animations: 'disabled'
                        }));
                    }
                } catch (e) { }

                // 👆 Expand (Hover + Click)
                await previewCard.hover({ force: true }).catch(() => { });
                const box = await previewCard.boundingBox();
                if (box) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => previewCard.click({ force: true }));
                } else {
                    await previewCard.click({ force: true }).catch(() => { });
                }

                // 🕵️ Wait for Modal (Shadow-DOM Aware)
                await page.waitForTimeout(1500);
                let expandedBox = page.locator(expandedSelectors.join(', ')).filter({ visible: true }).first();

                if (!(await expandedBox.isVisible())) {
                    const shadowMod = await this.findDeep(page, expandedSelectors.join(', '));
                    if (shadowMod) expandedBox = shadowMod;
                }

                if (await expandedBox.isVisible()) {
                    // 🛡️ Geometric Probe (Truth Injection)
                    const truncationCheck = await page.evaluate((selList) => {
                        function findDeep(s) {
                            const el = document.querySelector(s);
                            if (el) return el;
                            const all = document.querySelectorAll('*');
                            for (const n of all) {
                                if (n.shadowRoot) {
                                    const res = n.shadowRoot.querySelector(s);
                                    if (res) return res;
                                }
                            }
                            return null;
                        }
                        const popup = findDeep(selList.join(', '));
                        if (popup) {
                            const rect = popup.getBoundingClientRect();
                            const distToBottom = window.innerHeight - rect.bottom;
                            // Only report truncation if the card physically overflows the viewport bottom
                            return { distToBottom, isTruncated: rect.bottom > window.innerHeight };
                        }
                        return { isTruncated: false };
                    }, expandedSelectors);

                    if (truncationCheck.isTruncated) {
                        const msg = `TRUTH DATA: Floating Toast popup for "${signature.substring(0, 20)}..." is truncated (Flat Wall at bottom).`;
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(msg);
                    }

                    // 📸 Precision Composite Capture (Hardened Viewport Clipping)
                    const compositeRect = await page.evaluate(() => {
                        let minX = 10000, minY = 10000, maxX = 0, maxY = 0;
                        let found = false;

                        function scan(node) {
                            if (!node) return;
                            const s = window.getComputedStyle(node);
                            if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.1) {
                                const r = node.getBoundingClientRect();
                                if (r.width > 5 && r.height > 5) {
                                    minX = Math.min(minX, r.left);
                                    minY = Math.min(minY, r.top);
                                    maxX = Math.max(maxX, r.right);
                                    maxY = Math.max(maxY, r.bottom);
                                    found = true;
                                }
                            }
                            Array.from(node.children || []).forEach(c => scan(c));
                            if (node.shadowRoot) Array.from(node.shadowRoot.children || []).forEach(c => scan(c));
                        }

                        // Start scan from document body to find all detached/shadow elements
                        scan(document.body);

                        return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
                    }).catch(() => null);

                    if (compositeRect) {
                        const vSize = page.viewportSize();
                        const padding = 100;
                        const clip = {
                            x: Math.max(0, Math.floor(compositeRect.x - padding)),
                            y: Math.max(0, Math.floor(compositeRect.y - padding)),
                            width: Math.min(Math.ceil(compositeRect.width + (padding * 2)), vSize.width),
                            height: Math.min(Math.ceil(compositeRect.height + (padding * 2)), vSize.height)
                        };

                        screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }).catch(() => null));
                    } else {
                        // Fallback: Viewport capture if bounding box fails
                        screenshotBuffers.push(await page.screenshot({ animations: 'disabled' }).catch(() => null));
                    }

                    // ❌ Close (Smarter Click-Outside)
                    let closed = false;
                    const closeBtn = page.locator(closeBtnSelectors.join(', ')).filter({ visible: true }).first();

                    if (await closeBtn.isVisible()) {
                        await closeBtn.click({ force: true }).catch(() => { });
                        closed = true;
                    }

                    if (!closed) {
                        // Click "Away" logic: Calculate a point guaranteed to be outside the compositeRect
                        const vSize = page.viewportSize();
                        let clickX = 20;
                        let clickY = 20;

                        if (compositeRect) {
                            // If popup is on the left, click the far right. If on right, click left.
                            if (compositeRect.x < (vSize.width / 2)) {
                                clickX = vSize.width - 50;
                            } else {
                                clickX = 50;
                            }
                        }

                        console.log(`[FloatingToastHelper] Clicking outside at (${clickX}, ${clickY}) to close...`);
                        await page.mouse.click(clickX, clickY);
                    }

                    await page.waitForTimeout(2000);
                }

                if (screenshotBuffers.length >= (maxUniqueCaptures * 2)) break;
            }

        } catch (error) {
            console.error(`[FloatingToastHelper] Loop Critical Error: ${error.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = FloatingToastHelper;
