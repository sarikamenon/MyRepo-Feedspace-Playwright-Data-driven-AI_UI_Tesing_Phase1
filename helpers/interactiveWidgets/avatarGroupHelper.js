class AvatarGroupHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[AvatarGroupHelper] Starting sequential interaction (5+ avatars, 1536x700)...');

        const screenshotBuffers = [];

        // 1️⃣ Initial State: Identify Row & Run Static Integrity Probes (Overbleed/Truncation)
        try {
            await widgetLocator.scrollIntoViewIfNeeded({ timeout: 3000 });
            const box = await widgetLocator.boundingBox();
            
            if (box) {
                // Focused initial capture
                const clip = {
                    x: Math.max(0, box.x - 50),
                    y: Math.max(0, box.y - 100),
                    width: box.width + 100,
                    height: box.height + 200
                };
                screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }));
                console.log('[AvatarGroupHelper] Initial avatar row captured.');

                // 🕵️ EXTRA: Static Integrity Probes (Shadow-DFS Support)
                const integrityResults = await page.evaluate(() => {
                    const warnings = [];
                    const foundAvatars = [];
                    const foundText = [];

                    const scan = (node) => {
                        if (!node) return;
                        
                        // Find Avatars
                        const avatarSelectors = ['.feedspace-avatar', '.feedspace-avatar-image', '[class*="avatar"]'];
                        avatarSelectors.forEach(s => {
                            node.querySelectorAll(s).forEach(el => {
                                if (el.getBoundingClientRect().width > 5) foundAvatars.push(el);
                            });
                        });

                        // Find "Trusted by" text
                        node.querySelectorAll('span, div, p').forEach(el => {
                            if (el.textContent.includes('Trusted by')) foundText.push(el);
                        });

                        // Find Star Ratings (Aggregate)
                        const starSelectors = ['.feedspace-stars', '.fe-stars', '.fe-stars-container', '[class*="stars"]'];
                        starSelectors.forEach(s => {
                            node.querySelectorAll(s).forEach(el => {
                                if (el.getBoundingClientRect().width > 2) {
                                    warnings.push(`STAR RATING VISIBLE: Found stars at (${Math.round(el.getBoundingClientRect().x)}, ${Math.round(el.getBoundingClientRect().y)})`);
                                }
                            });
                        });

                        // Recurse
                        Array.from(node.children || []).forEach(child => {
                            scan(child);
                            if (child.shadowRoot) scan(child.shadowRoot);
                        });
                    };

                    scan(document.body);

                    // 1. OVERBLEED DETECTION
                    if (foundAvatars.length > 2) {
                        const first = foundAvatars[0].getBoundingClientRect();
                        const last = foundAvatars[foundAvatars.length - 1].getBoundingClientRect();
                        const rowLeft = Math.min(first.left, last.left);
                        const rowRight = Math.max(first.right, last.right);

                        const container = document.querySelector('.feedspace-inner-box, .feedspace-inner-container, #brxe-1cbbc3');
                        if (container) {
                            const cRect = container.getBoundingClientRect();
                            if (rowLeft < cRect.left - 10) {
                                warnings.push(`OVERBLEED DETECTED: Avatar row bleeds ${Math.round(cRect.left - rowLeft)}px outside the LEFT edge of the parent.`);
                            }
                            if (rowRight > cRect.right + 10) {
                                warnings.push(`OVERBLEED DETECTED: Avatar row bleeds ${Math.round(rowRight - cRect.right)}px outside the RIGHT edge of the parent.`);
                            }
                        }
                    }

                    // 2. TEXT TRUNCATION / CORRUPTION
                    foundText.forEach(el => {
                        const isTruncated = el.scrollWidth > el.clientWidth + 5;
                        const isDuplicated = el.textContent.toLowerCase().split('trusted by').length > 2;
                        
                        if (isTruncated) {
                            warnings.push(`TEXT TRUNCATION: "${el.textContent.substring(0, 20)}..." is mathematically cut off (scrollWidth > clientWidth).`);
                        }
                        if (isDuplicated) {
                            warnings.push(`TEXT CORRUPTION: "${el.textContent.substring(0, 30)}..." appears duplicated or corrupt.`);
                        }

                        // Overlap with stars
                        const rect = el.getBoundingClientRect();
                        const stars = document.querySelector('.feedspace-stars, .fe-stars, [class*="stars"]');
                        if (stars) {
                            const sRect = stars.getBoundingClientRect();
                            const overlap = !(rect.right < sRect.left || rect.left > sRect.right || rect.bottom < sRect.top || rect.top > sRect.bottom);
                            if (overlap) warnings.push(`LAYOUT OVERLAP: "Trusted by" text overlaps the star ratings element.`);
                        }
                    });

                    return warnings;
                });

                if (integrityResults && integrityResults.length > 0) {
                    integrityResults.forEach(msg => {
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(`TRUTH DATA: ${msg}`);
                    });
                }
            }
        } catch (e) {
            console.warn(`[AvatarGroupHelper] Initial capture/integrity check failed: ${e.message}`);
        }

        // 2️⃣ Find All Avatars (Global Shadow-DFS)
        const avatarSelectors = [
            '.feedspace-avatar-group-item',
            '.feedspace-avatar',
            '.fe-avatar-box',
            '.fe-avatar',
            '.feedspace-d6-header-avatar-container img',
            '[class*="avatar-item"]',
            '[class*="avatar-container"] img',
            'div:has(> .feedspace-initials)',
            '.feedspace-avatar-image'
        ];

        const avatars = await page.evaluate(async (selectors) => {
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
                                const rect = m.getBoundingClientRect();
                                if (rect.width > 2 && rect.height > 2) {
                                    let id = m.getAttribute('data-fs-temp-id');
                                    if (!id) {
                                        id = 'fs_avatar_' + Math.random().toString(36).substr(2, 9);
                                        m.setAttribute('data-fs-temp-id', id);
                                    }
                                    results.push({ id, rect: { x: rect.x, y: rect.y } });
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
 
            findInRoot(document.body);
            return results;
        }, avatarSelectors);

        console.log(`[AvatarGroupHelper] Discovered ${avatars.length} avatars via Global Shadow DFS.`);

        // 3️⃣ Sequential Interaction (Up to 5)
        const targets = avatars.slice(0, 5); 

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const selector = `[data-fs-temp-id="${target.id}"]`;

            try {
                console.log(`[AvatarGroupHelper] Case ${i+1}: Clicking avatar at (${Math.round(target.rect.x)}, ${Math.round(target.rect.y)})...`);
                
                await page.evaluate(({ sel, rect }) => {
                    const el = document.querySelector(sel) || 
                               Array.from(document.querySelectorAll('*'))
                                    .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                    ?.shadowRoot.querySelector(sel);
                    
                    if (el) {
                        el.click();
                    } else {
                        const eventOpts = { bubbles: true, cancelable: true, view: window };
                        document.elementFromPoint(rect.x + 5, rect.y + 5)?.dispatchEvent(new MouseEvent('click', eventOpts));
                    }
                }, { sel: selector, rect: target.rect });

                await page.waitForTimeout(1500); 

                // Capture Viewport
                console.log(`[AvatarGroupHelper] Case ${i+1}: Capturing Viewport (1536x700 environment)...`);
                screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));

                const popupSelectors = '.feedspace-avatar-review-popup, .fe-review-box, .fe-modal-content';

                // Truncation Probe
                const truncationCheck = await page.evaluate((sel) => {
                    const popup = document.querySelector(sel);
                    if (popup) {
                        const r = popup.getBoundingClientRect();
                        const distToBottom = window.innerHeight - r.bottom;
                        return { isTruncated: distToBottom < 5, val: distToBottom };
                    }
                    return null;
                }, popupSelectors);

                if (truncationCheck && truncationCheck.isTruncated) {
                    const msg = `TRUTH DATA: Popup ${i+1} is TRUNCATED (hitting viewport bottom). Distance: ${Math.round(truncationCheck.val)}px.`;
                    console.log(`[SYSTEM ALERT] ${msg}`);
                    if (geometricWarnings) geometricWarnings.push(msg);
                }

                // Focused Clip
                const popupLocator = page.locator(popupSelectors).filter({visible: true}).first();
                const popupBox = await popupLocator.boundingBox().catch(() => null);
                if (popupBox) {
                    const clip = {
                        x: Math.max(0, popupBox.x - 20),
                        y: Math.max(0, popupBox.y - 20),
                        width: popupBox.width + 40,
                        height: popupBox.height + 60
                    };
                    screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }));
                }

                await page.mouse.click(10, 10); 
                await page.waitForTimeout(500);

            } catch (err) {
                console.warn(`[AvatarGroupHelper] Sequential Error ${i+1}: ${err.message}`);
            }
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarGroupHelper;