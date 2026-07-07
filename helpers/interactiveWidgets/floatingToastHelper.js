class FloatingToastHelper {
    /**
     * Helper to find an element even if it's inside a nested Shadow DOM.
     * @param {import('playwright').Page} page 
     * @param {string} selector 
     * @returns {Promise<import('playwright').ElementHandle | null>}
     */
    static async findDeep(page, selector) {
        return await page.evaluateHandle((sel) => {
            function findRecursively(root, s) {
                const el = root.querySelector(s);
                if (el) return el;
                const children = Array.from(root.querySelectorAll('*'));
                for (const child of children) {
                    if (child.shadowRoot) {
                        const found = findRecursively(child.shadowRoot, s);
                        if (found) return found;
                    }
                }
                return null;
            }
            return findRecursively(document, sel);
        }, selector).then(h => h.asElement());
    }

    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[FloatingToastHelper] Starting hardened unique multi-card validation loop...');
        const screenshotBuffers = [];
        const capturedSignatures = new Set();
        const maxUniqueCaptures = 12;

        const previewSelectors = [
            '.feedspace-toast', '.feedspace-card', '.fe-toast-card', '.fe-floating-preview',
            '.fe-floating-toast', '.fe-shadow-container', '.fe-chat-bubble', '.fe-bubble-launcher'
        ];
        const expandedSelectors = [
            '.fe-review-box', '.fe-modal-content', '[class*="review-box"]', '.feedspace-expanded-review',
            '.fs-modal-overlay', '.fs-modal-inner', '.fs-modal-content', '.feedspace-review-card'
        ];
        const closeBtnSelectors = [
            '.fe-review-box-close-icon', '[class*="close-icon"]', '.fe-modal-close', 'button'
        ];

        try {
            // Initial settle for entrance animations
            await page.waitForTimeout(3000);
            let consecutiveDuplicates = 0;

            for (let i = 0; i < 20 && screenshotBuffers.length < (maxUniqueCaptures * 2); i++) {
                // 🧹 CLEAN RESET: If modal is open, click its close button or click outside cleanly
                await page.evaluate((selList, btnList) => {
                    function findRecursively(root, s) {
                        const el = root.querySelector(s);
                        if (el) return el;
                        const children = Array.from(root.querySelectorAll('*'));
                        for (const child of children) {
                            if (child.shadowRoot) {
                                const found = findRecursively(child.shadowRoot, s);
                                if (found) return found;
                            }
                        }
                        return null;
                    }
                    const modal = findRecursively(document, selList.join(', '));
                    if (modal) {
                        const style = window.getComputedStyle(modal);
                        if (style.display !== 'none' && style.visibility !== 'hidden') {
                            for (const bSel of btnList) {
                                const btn = modal.querySelector(bSel) || findRecursively(modal.shadowRoot || modal, bSel);
                                if (btn) {
                                    btn.click();
                                    return;
                                }
                            }
                            modal.click();
                        }
                    }
                }, expandedSelectors, closeBtnSelectors).catch(() => { });
                await page.waitForTimeout(1000);
                await page.mouse.click(20, 20); // Bounce off any existing focus
                await page.waitForTimeout(500);

                // 1️⃣ Find the active foreground preview card (Sorted by z-index descending)
                let previewCard = await page.evaluateHandle((selList) => {
                    function findElementsRecursively(root, selector, results = []) {
                        const elements = root.querySelectorAll(selector);
                        elements.forEach(el => results.push(el));
                        
                        const children = Array.from(root.querySelectorAll('*'));
                        for (const child of children) {
                            if (child.shadowRoot) {
                                findElementsRecursively(child.shadowRoot, selector, results);
                            }
                        }
                        return results;
                    }
                    
                    const cards = [];
                    for (const sel of selList) {
                        findElementsRecursively(document, sel, cards);
                    }
                    if (cards.length === 0) return null;
                    
                    // Filter by visibility
                    const visibleCards = cards.filter(c => {
                        const style = window.getComputedStyle(c);
                        const rect = c.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1 && rect.width > 5 && rect.height > 5;
                    });
                    
                    if (visibleCards.length === 0) return null;
                    
                    // Sort cards by zIndex descending to get the foreground card
                    visibleCards.sort((a, b) => {
                        const za = parseInt(window.getComputedStyle(a).zIndex) || 0;
                        const zb = parseInt(window.getComputedStyle(b).zIndex) || 0;
                        return zb - za;
                    });
                    return visibleCards[0];
                }, previewSelectors).then(h => h.asElement());

                if (!previewCard) {
                    console.log('[FloatingToastHelper] No active preview card found. Waiting for cycle...');
                    await page.waitForTimeout(1500);
                    continue;
                }

                // 🆔 Surgical Identity Tracking (Name + Alpha-Numeric Body)
                const reviewerName = await page.evaluate(el => {
                    const nameEl = el.querySelector('.feedspace-reviewer-name, .fe-reviewer-name, .fe-name, b, strong, [class*="name"]');
                    return nameEl ? nameEl.textContent.trim() : '';
                }, previewCard).catch(() => "");
                const fullText = await page.evaluate(el => el.textContent || "", previewCard).catch(() => "");

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
                // Guard: re-check visibility before screenshotting — badge may have animated out
                try {
                    const stillVisible = await page.evaluate(el => {
                        if (!el) return false;
                        const s = window.getComputedStyle(el);
                        const r = el.getBoundingClientRect();
                        return s.display !== 'none' && s.visibility !== 'hidden'
                            && parseFloat(s.opacity) > 0.1 && r.width > 5 && r.height > 5;
                    }, previewCard).catch(() => false);

                    const pBox = stillVisible ? await previewCard.boundingBox() : null;
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
                    } else if (!stillVisible) {
                        console.log('[FloatingToastHelper] ⏭️  Badge animated out before screenshot — skipping blank frame.');
                    }
                } catch (e) { }

                // 👆 Expand (Hover + Hardened Multi-Click Flow)
                await previewCard.hover({ force: true }).catch(() => { });
                await page.waitForTimeout(500); // Settle hover
                
                let clicked = false;
                try {
                    await previewCard.click({ force: true, timeout: 2000 });
                    clicked = true;
                } catch (e) { }

                if (!clicked) {
                    const box = await previewCard.boundingBox().catch(() => null);
                    if (box) {
                        try {
                            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                            clicked = true;
                        } catch (e) { }
                    }
                }

                if (!clicked) {
                    await previewCard.evaluate(el => el.click()).catch(() => {});
                }

                // 🕵️ Wait for Modal & check visibility in browser context
                await page.waitForTimeout(2000);

                let isModalVisible = await page.evaluate((selList) => {
                    function findRecursively(root, s) {
                        const el = root.querySelector(s);
                        if (el) return el;
                        const children = Array.from(root.querySelectorAll('*'));
                        for (const child of children) {
                            if (child.shadowRoot) {
                                const found = findRecursively(child.shadowRoot, s);
                                if (found) return found;
                            }
                        }
                        return null;
                    }
                    const popup = findRecursively(document, selList.join(', '));
                    if (!popup) return false;
                    const style = window.getComputedStyle(popup);
                    const rect = popup.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0;
                }, expandedSelectors).catch(() => false);

                if (isModalVisible) {
                    console.log(`[FloatingToastHelper] 🚀 Modal successfully opened for: "${reviewerName}"`);
                    
                    // Freeze motion styles inside page context
                    await page.evaluate(() => {
                        let style = document.getElementById('fs-freeze-motion');
                        if (!style) {
                            style = document.createElement('style');
                            style.id = 'fs-freeze-motion';
                            style.textContent = '* { animation-play-state: paused !important; transition-duration: 0s !important; transition-property: none !important; }';
                            document.head.appendChild(style);
                        }
                    }).catch(() => null);

                    // Re-locate expanded box for screenshots
                    let expandedBox = await this.findDeep(page, expandedSelectors.join(', '));
                    if (expandedBox) {
                        // 🛡️ Geometric Probe (Truth Injection)
                        const truncationCheck = await page.evaluate((selList) => {
                            function findRecursively(root, s) {
                                const el = root.querySelector(s);
                                if (el) return el;
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) {
                                        const found = findRecursively(child.shadowRoot, s);
                                        if (found) return found;
                                    }
                                }
                                return null;
                            }
                            const popup = findRecursively(document, selList.join(', '));
                            if (popup) {
                                const rect = popup.getBoundingClientRect();
                                const distToBottom = window.innerHeight - rect.bottom;
                                return { distToBottom, isTruncated: rect.bottom > window.innerHeight };
                            }
                            return null;
                        }, expandedSelectors).catch(() => null);

                        if (truncationCheck && truncationCheck.isTruncated) {
                            console.log(`[FloatingToastHelper] ⚠️ Slivers/Truncation warning injected geometrically (gap: ${truncationCheck.distToBottom}px).`);
                            geometricWarnings.push(`Truncation warning on expanded modal: bottom overflows viewport by ${Math.abs(truncationCheck.distToBottom)}px.`);
                        }

                        // 📸 Capture top-half of the modal
                        const compositeRect = await page.evaluate((selList) => {
                            function findRecursively(root, s) {
                                const el = root.querySelector(s);
                                if (el) return el;
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) {
                                        const found = findRecursively(child.shadowRoot, s);
                                        if (found) return found;
                                    }
                                }
                                return null;
                            }
                            const popup = findRecursively(document, selList.join(', '));
                            if (!popup) return null;
                            const rect = popup.getBoundingClientRect();
                            return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
                        }, expandedSelectors).catch(() => null);

                        const vSize = page.viewportSize();
                        const padding = 10;
                        if (compositeRect) {
                            const clip = {
                                x: Math.max(0, Math.floor(compositeRect.x - padding)),
                                y: Math.max(0, Math.floor(compositeRect.y - padding)),
                                width: Math.min(Math.ceil(compositeRect.width + (padding * 2)), vSize.width),
                                height: Math.min(Math.ceil(compositeRect.height + (padding * 2)), vSize.height)
                            };
                            screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }).catch(() => null));
                        }

                        // 📜 Scroll modal to bottom
                        await page.evaluate((selList) => {
                            function findRecursively(root, s) {
                                const el = root.querySelector(s);
                                if (el) return el;
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) {
                                        const found = findRecursively(child.shadowRoot, s);
                                        if (found) return found;
                                    }
                                }
                                return null;
                            }
                            const modal = findRecursively(document, selList.join(', '));
                            if (modal) {
                                // Locate the scrollable modal container
                                const innerContent = modal.querySelector('.fs-modal-content, [class*="modal-content"]');
                                const scrollable = innerContent || modal;
                                scrollable.scrollTop = scrollable.scrollHeight;
                            }
                        }, expandedSelectors).catch(() => null);

                        await page.waitForTimeout(600); // Allow scroll to settle

                        // 📸 Capture bottom-half of the modal
                        if (compositeRect) {
                            const clip = {
                                x: Math.max(0, Math.floor(compositeRect.x - padding)),
                                y: Math.max(0, Math.floor(compositeRect.y - padding)),
                                width: Math.min(Math.ceil(compositeRect.width + (padding * 2)), vSize.width),
                                height: Math.min(Math.ceil(compositeRect.height + (padding * 2)), vSize.height)
                            };
                            screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }).catch(() => null));
                        }

                        // ❌ Close Modal
                        const closed = await page.evaluate((selList, btnList) => {
                            function findRecursively(root, s) {
                                const el = root.querySelector(s);
                                if (el) return el;
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) {
                                        const found = findRecursively(child.shadowRoot, s);
                                        if (found) return found;
                                    }
                                }
                                return null;
                            }
                            const modal = findRecursively(document, selList.join(', '));
                            if (modal) {
                                // Find close button inside shadowRoot or light DOM
                                for (const bSel of btnList) {
                                    const btn = modal.querySelector(bSel) || findRecursively(modal.shadowRoot || modal, bSel);
                                    if (btn) {
                                        btn.click();
                                        return true;
                                    }
                                }
                                // Click outside modal overlay as fallback
                                modal.click();
                                return true;
                            }
                            return false;
                        }, expandedSelectors, closeBtnSelectors).catch(() => false);

                        if (closed) {
                            await page.waitForTimeout(1000); // Wait for modal close transition
                        }
                    }

                    // 🧊 UNFREEZE ANIMATIONS
                    await page.evaluate(() => {
                        const style = document.getElementById('fs-freeze-motion');
                        if (style) style.remove();
                    }).catch(() => null);

                    await page.waitForTimeout(2000);
                } else {
                    console.log(`[FloatingToastHelper] ⚠️ Modal failed to open for: "${reviewerName}"`);
                    const popupExists = await page.evaluate((selList) => {
                        function findRecursively(root, s) {
                            const el = root.querySelector(s);
                            if (el) return el;
                            const children = Array.from(root.querySelectorAll('*'));
                            for (const child of children) {
                                if (child.shadowRoot) {
                                    const found = findRecursively(child.shadowRoot, s);
                                    if (found) return found;
                                }
                            }
                            return null;
                        }
                        const popup = findRecursively(document, selList.join(', '));
                        return popup ? {
                            tagName: popup.tagName,
                            className: popup.className,
                            display: window.getComputedStyle(popup).display,
                            visibility: window.getComputedStyle(popup).visibility,
                            height: popup.getBoundingClientRect().height
                        } : null;
                    }, expandedSelectors).catch(() => null);
                    console.log(`[FloatingToastHelper] Popup inspection:`, JSON.stringify(popupExists));
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
