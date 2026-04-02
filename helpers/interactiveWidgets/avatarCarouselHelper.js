class AvatarCarouselHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[AvatarCarouselHelper] Starting advanced shadow-aware interaction...');

        const screenshotBuffers = [];

        // 1. Find the "True" Widget Root and Tag it for discovery
        const discoveryTempId = 'fs_root_' + Math.random().toString(36).substr(2, 9);
        await widgetLocator.evaluate((el, id) => el.setAttribute('data-fs-discovery-root', id), discoveryTempId);
        
        const widgetRoot = await widgetLocator.evaluateHandle(el => {
            if (el.shadowRoot) return el.shadowRoot;
            if (el.querySelector('.feedspace-avatar-carousel, .feedspace-avatar-carousel-item')) return el;
            return el.parentElement;
        });

        // 2. Capture 'avatars' screenshot using Clip
        try {
            console.log('[AvatarCarouselHelper] Determining clip region for focused screenshot...');
            await widgetLocator.scrollIntoViewIfNeeded({ timeout: 3000 });
            
            const box = await widgetLocator.boundingBox();
            if (box) {
                const clip = {
                    x: Math.max(0, box.x - 100), // More left padding
                    y: Math.max(0, box.y - 100), // More top padding
                    width: box.width + 200,      // More width for right edge visibility
                    height: box.height + 200     // More height for bottom visibility
                };
                console.log(`[AvatarCarouselHelper] Taking clipped screenshot: ${JSON.stringify(clip)}`);
                const buffer = await page.screenshot({ clip, animations: 'disabled' }).catch(() => null);
                if (buffer) {
                    screenshotBuffers.push(buffer);
                    console.log('[AvatarCarouselHelper] Aggregate/Avatar focused shot captured.');
                }
            }
        } catch (e) {
            console.warn(`[AvatarCarouselHelper] Clip screenshot failed: ${e.message}`);
        }

        // 3. Find Avatars (Shadow DFS)
        const avatarSelectors = [
            '.feedspace-avatar-carousel-item',
            '.feedspace-avatar-carousel',
            '.feedspace-avatar',
            '.fe-avatar-box',
            '.fe-avatar',
            '[class*="avatar-item"]',
            'div:has(.feedspace-initials)'
        ];

        const avatars = await page.evaluate(async ({ tempId, selectors }) => {
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
                                        id = 'fs_avatar_' + Math.random().toString(36).substr(2, 9);
                                        m.setAttribute('data-fs-temp-id', id);
                                    }
                                    results.push({ id, feedId: m.getAttribute('data-feed-id') });
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
        }, { tempId: discoveryTempId, selectors: avatarSelectors });

        console.log(`[AvatarCarouselHelper] Found ${avatars.length} avatars in Shadow/DOM.`);

        // 3.5 Explicitly Hover the Rightmost Visible Avatar to check for edge clipping
        console.log(`[AvatarCarouselHelper] Locating rightmost visible avatar using raw JS geometry...`);
        let rightmostAvatarId = await page.evaluate((ids) => {
            let maxRight = -1;
            let target = null;
            ids.forEach(id => {
                const el = document.querySelector(`[data-fs-temp-id="${id}"]`) || 
                           Array.from(document.querySelectorAll('*'))
                                .find(n => n.shadowRoot && n.shadowRoot.querySelector(`[data-fs-temp-id="${id}"]`))
                                ?.shadowRoot.querySelector(`[data-fs-temp-id="${id}"]`);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    // Ensure the element is visible on screen and further right than previous
                    if (rect.width > 0 && rect.right > maxRight && rect.left < window.innerWidth) {
                        maxRight = rect.right;
                        target = id;
                    }
                }
            });
            return target;
        }, avatars.map(a => a.id));

        if (rightmostAvatarId) {
            console.log(`[AvatarCarouselHelper] Hovering rightmost avatar to trigger flip animation...`);
            const loc = page.locator(`[data-fs-temp-id="${rightmostAvatarId}"]`);
            await loc.scrollIntoViewIfNeeded();
            await loc.hover({ force: true }).catch(e => console.warn('Hover fail:', e.message));
            await page.waitForTimeout(2000); // 2 seconds for CSS flip transition
            const hoverShot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
            if (hoverShot) {
                screenshotBuffers.push(hoverShot);
                console.log(`[AvatarCarouselHelper] Rightmost avatar hover screenshot captured.`);
            }
        }

        // 4. Interact with up to 5 unique avatars
        const seenFeedIds = new Set();
        const uniqueAvatars = avatars.filter(a => {
            if (!a.feedId) return true;
            if (seenFeedIds.has(a.feedId)) return false;
            seenFeedIds.add(a.feedId);
            return true;
        });

        const targets = uniqueAvatars.slice(0, 5); 

        console.log(`[AvatarCarouselHelper] Selected ${targets.length} unique avatars for interaction.`);

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const selector = `[data-fs-temp-id="${target.id}"]`;

            try {
                console.log(`[AvatarCarouselHelper] Clicking unique avatar ${i + 1}/${targets.length} (ID: ${target.id})...`);
                
                // 1. Hover first to trigger CSS flips
                const loc = page.locator(selector).first();
                await loc.scrollIntoViewIfNeeded();
                await loc.hover({ force: true }).catch(() => {});
                await page.waitForTimeout(1000);

                // 2. Click using robust PointerEvents
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel) || 
                               Array.from(document.querySelectorAll('*'))
                                    .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                    ?.shadowRoot.querySelector(sel);
                    if (el) {
                        const eventOpts = { bubbles: true, cancelable: true, view: window };
                        el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
                        el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
                        el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
                        el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
                        el.click();
                    }
                }, selector);

                await page.waitForTimeout(2500); 

                console.log(`[AvatarCarouselHelper] Capturing viewport screenshot for review card ${i + 1}...`);
                
                // Geometric Probe for "Flat Wall" Truncation
                const truncationCheck = await page.evaluate(() => {
                    const popup = document.querySelector('.feedspace-modal, .fe-modal, [class*="modal"], [class*="popup"]');
                    if (popup) {
                        const rect = popup.getBoundingClientRect();
                        const distToBottom = window.innerHeight - rect.bottom;
                        return { 
                            hasPopup: true, 
                            distToBottom,
                            isTruncated: distToBottom < 5 // Within 5px of bottom is suspicious
                        };
                    }
                    return { hasPopup: false };
                });

                if (truncationCheck.isTruncated) {
                    const msg = `TRUTH DATA: Popup Truncation detected! (Flat Wall at bottom). Distance to bottom: ${truncationCheck.distToBottom}px.`;
                    console.log(`[SYSTEM ALERT] ${msg}`);
                    if (geometricWarnings) geometricWarnings.push(msg);
                }

                const shot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
                if (shot) screenshotBuffers.push(shot);

                await page.mouse.click(50, 50); 
                await page.waitForTimeout(1000);
            } catch (err) {
                console.warn(`[AvatarCarouselHelper] Failed to interact with avatar ${i + 1}: ${err.message}`);
            }
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarCarouselHelper;
