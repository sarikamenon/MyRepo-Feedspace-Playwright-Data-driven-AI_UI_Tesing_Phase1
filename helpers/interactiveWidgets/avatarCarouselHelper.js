class AvatarCarouselHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[AvatarCarouselHelper] Starting advanced shadow-aware interaction...');

        const screenshotBuffers = [];

        // 1. Find the "True" Widget Root and Tag it for discovery
        const discoveryTempId = 'fs_root_' + Math.random().toString(36).substr(2, 9);
        await widgetLocator.evaluate((el, id) => el.setAttribute('data-fs-discovery-root', id), discoveryTempId);

        // ── 🕵️ THE UNIVERSAL- "LAYOUT OVERLAP" → Apply RULE 2 → FAIL Categories A & B
        // - "SYMMETRY_SIGNAL" → **ALERT: THIS IS A GEOMETRIC SUGGESTION ONLY**. The system detected a width delta or sharp edge. However, you MUST prioritize your EYES. If you visually see rounded corners and complete text/avatars, you MUST mark Category A as **PASS**. Only fail if content is physically missing or truncated.
        // - "STAR RATING VISIBLE" → MUST report "Visible" for "Show Star Ratings"
        // on AND avatar clicking simultaneously
        const nextArrowSelectors = [
            'button.feedspace-carousel-next', '.swiper-button-next', '.fe-arrow-next', 
            '.fe-carousel-next', '[class*="arrow-right"]', '[class*="next-button"]'
        ];
        
        const itemSelectors = [
            '.feedspace-avatar-card-flip', '.feedspace-avatar-carousel-item', 
            '.fe-avatar-item', '[class*="avatar-card"]'
        ];

        console.log('[AvatarCarouselHelper] Initializing Iterative Multi-State Storyboard Audit...');

        for (let slide = 1; slide <= 3; slide++) {
            console.log(`[AvatarCarouselHelper] --- Auditing Slide ${slide} ---`);

            // 1. Audit ALL visible cards for clipping (Sentinel)
            const sentinelResults = await page.evaluate(({selList, vw, vh}) => {
                const results = [];
                function findDeep(selectors) {
                    const found = [];
                    const scan = (root) => {
                        if (!root) return;
                        selectors.forEach(s => {
                            root.querySelectorAll(s).forEach(el => {
                                if (el.getBoundingClientRect().width > 10) found.push(el);
                            });
                        });
                        Array.from(root.children || []).forEach(c => scan(c));
                        if (root.shadowRoot) scan(root.shadowRoot);
                    };
                    scan(document);
                    return found;
                }
                
                const cards = findDeep(selList);
                cards.forEach((card, idx) => {
                    const r = card.getBoundingClientRect();
                    const style = window.getComputedStyle(card);
                    const trRadius = parseFloat(style.borderTopRightRadius) || 0;
                    
                    // 🛡️ ON-STAGE BUFFER: Audit any card that is meaningfully visible
                    const isOnStage = (r.right > 20 && r.left < (vw - 20) && r.bottom > 0 && r.top < vh);
                    
                    if (isOnStage) {
                        const distToBottom = vh - r.bottom;
                        const distToTop = r.top;

                        // 1. Vertical Clipping (Zero-Tolerance)
                        if (distToBottom < -1) results.push(`FAIL_BOTTOM_EDGE_CLIPPED (Card ${idx+1}, Bleed: ${Math.abs(Math.round(distToBottom))}px)`);
                        else if (distToTop < -1) results.push(`FAIL_TOP_EDGE_CLIPPED (Card ${idx+1}, Bleed: ${Math.abs(Math.round(distToTop))}px)`);

                        // 🛡️ SYMMETRY AUDIT (End-Cap Audit)
                        const isEndCard = (r.right > vw - 15) || (r.left < 15);
                        const centerCardWidth = cards.length > 1 ? cards[Math.floor(cards.length/2)].getBoundingClientRect().width : r.width;
                        const widthDelta = Math.abs(centerCardWidth - r.width);

                        // Soften threshold to 20px (allow for standard swiper peeking/scaling)
                        if (isEndCard && widthDelta > 20) {
                            results.push(`SYMMETRY_SIGNAL: Width Delta ${Math.round(widthDelta)}px detected on Card ${idx+1}. (Visual Audit Mandatory)`);
                        }

                        if (isEndCard && trRadius < 2) {
                            results.push(`SYMMETRY_SIGNAL: Sharp corner detected on Card ${idx+1}. (Visual Audit Mandatory)`);
                        }
                    }
                });
                return results;
            }, { selList: itemSelectors, vw: page.viewportSize().width, vh: page.viewportSize().height });

            if (sentinelResults.length > 0) {
                sentinelResults.forEach(msg => {
                    const level = msg.includes('FAIL_') ? 'FAIL_LAYOUT_CLIPPED' : 'AUDIT_SIGNAL';
                    console.log(`[SYSTEM ALERT] TRUTH DATA: ${level} detected on Slide ${slide}. Issue: ${msg}`);
                    if (geometricWarnings) geometricWarnings.push(`${level}: ${msg}`);
                });
            }

            // 2. Capture Slide Screenshot
            const slideShot = await page.screenshot({ animations: 'disabled' }).catch(() => null);
            if (slideShot) screenshotBuffers.push(slideShot);

            // 3. Click 1 Avatar on this slide (Optimized from 2 to 1 for speed)
            const visibleAvatars = await page.evaluate(({selList, vw}) => {
                const found = [];
                function scan(root) {
                    if (!root) return;
                    selList.forEach(s => {
                        root.querySelectorAll(s).forEach(el => {
                            const r = el.getBoundingClientRect();
                            if (r.width > 10 && r.right > 0 && r.left < vw) {
                                let id = el.getAttribute('data-fs-temp-id');
                                if (!id) {
                                    id = 'fs_item_' + Math.random().toString(36).substr(2, 9);
                                    el.setAttribute('data-fs-temp-id', id);
                                }
                                found.push(id);
                            }
                        });
                    });
                    Array.from(root.children || []).forEach(c => scan(c));
                    if (root.shadowRoot) scan(root.shadowRoot);
                }
                scan(document);
                return found;
            }, { selList: itemSelectors, vw: page.viewportSize().width });

            const toClick = visibleAvatars.slice(0, 1);
            for (const avatarId of toClick) {
                console.log(`[AvatarCarouselHelper] Hovering and Clicking avatar: ${avatarId}`);
                
                // 1. Mandatory Hover to trigger CSS animations/flips
                await page.evaluate((id) => {
                    const sel = `[data-fs-temp-id="${id}"]`;
                    function find(root) {
                        const el = root.querySelector(sel);
                        if (el) return el;
                        const children = Array.from(root.children || []);
                        for (const c of children) {
                            const found = find(c);
                            if (found) return found;
                            if (c.shadowRoot) {
                                const shadow = find(c.shadowRoot);
                                if (shadow) return shadow;
                            }
                        }
                    }
                    const target = find(document);
                    if (target) {
                        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    }
                }, avatarId);

                await page.waitForTimeout(1000);

                // 2. Robust Pointer + Mouse Click Dispatch
                await page.evaluate((id) => {
                    const sel = `[data-fs-temp-id="${id}"]`;
                    function find(root) {
                        const el = root.querySelector(sel);
                        if (el) return el;
                        const children = Array.from(root.children || []);
                        for (const c of children) {
                            const found = find(c);
                            if (found) return found;
                            if (c.shadowRoot) {
                                const shadow = find(c.shadowRoot);
                                if (shadow) return shadow;
                            }
                        }
                    }
                    const target = find(document);
                    if (target) {
                        const eventOpts = { bubbles: true, cancelable: true, view: window };
                        target.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
                        target.dispatchEvent(new MouseEvent('mousedown', eventOpts));
                        target.dispatchEvent(new PointerEvent('pointerup', eventOpts));
                        target.dispatchEvent(new MouseEvent('mouseup', eventOpts));
                        target.click();
                    }
                }, avatarId);
                
                await page.waitForTimeout(1500); // 🏃 Optimized wait time
                
                // 📸 DEEP EXPANSION CAPTURE
                const expansionShot = await page.evaluate((id) => {
                    const modal = document.querySelector('.feedspace-modal, .fe-modal, [class*="modal"], [class*="popup"]');
                    if (modal && modal.getBoundingClientRect().height > 50) return { type: 'MODAL', id: null };
                    const cards = Array.from(document.querySelectorAll('*')).filter(n => n.getAttribute('data-fs-temp-id') === id);
                    if (cards.length > 0) return { type: 'CARD', id: id };
                    return null;
                }, avatarId);

                if (expansionShot) {
                    // 📸 FULL VIEW EXPANSION CAPTURE (Requested for context)
                    console.log(`[AvatarCarouselHelper] Capturing Full View for expansion: ${expansionShot.type}`);
                    const buffer = await page.screenshot({ animations: 'disabled' }).catch(() => null);
                    if (buffer) screenshotBuffers.push(buffer);
                }
                
                await page.mouse.click(50, 50);
                await page.waitForTimeout(800); // 🏃 Optimized wait time
            }

            if (slide === 3) break;

            // 4. Navigate to Next Slide
            const arrowClicked = await page.evaluate((sels) => {
                function findDeep(selectors) {
                    let target = null;
                    const scan = (root) => {
                        if (target) return;
                        selectors.forEach(s => {
                            const el = root.querySelector(s);
                            if (el && el.getBoundingClientRect().width > 0) target = el;
                        });
                        if (target) return;
                        Array.from(root.children || []).forEach(c => {
                            scan(c);
                            if (c.shadowRoot) scan(c.shadowRoot);
                        });
                    };
                    scan(document);
                    return target;
                }
                const btn = findDeep(sels);
                if (btn) {
                    btn.click(); return true;
                }
                return false;
            }, nextArrowSelectors);

            if (!arrowClicked) break;
            await page.waitForTimeout(1500); // 🏃 Optimized wait time
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarCarouselHelper;
