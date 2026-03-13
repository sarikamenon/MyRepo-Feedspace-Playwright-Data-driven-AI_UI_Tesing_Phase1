class AvatarGroupHelper {
    static async interact(page, widgetLocator, captureCallback) {
        console.log('[AvatarGroupHelper] Starting advanced shadow-aware interaction...');

        const screenshotBuffers = [];

        // 1️⃣ Find the "True" Widget Root and Tag it for discovery
        const discoveryTempId = 'fs_root_' + Math.random().toString(36).substr(2, 9);
        await widgetLocator.evaluate((el, id) => el.setAttribute('data-fs-discovery-root', id), discoveryTempId);
        
        const widgetRoot = await widgetLocator.evaluateHandle(el => {
            if (el.shadowRoot) return el.shadowRoot;
            if (el.querySelector('.feedspace-avatar-group, .feedspace-avatar-group-item')) return el;
            return el.parentElement;
        });

        // 2️⃣ Capture 'avatars + aggregate stars' screenshot using Clip
        try {
            console.log('[AvatarGroupHelper] Determining clip region for focused screenshot...');
            await widgetLocator.scrollIntoViewIfNeeded({ timeout: 3000 });
            
            const box = await widgetLocator.boundingBox();
            if (box) {
                // Broaden the clip to catch aggregate stars which are often above or below
                const clip = {
                    x: Math.max(0, box.x - 50),
                    y: Math.max(0, box.y - 300), // Larger space above for stars (e.g. ESKK)
                    width: box.width + 100,
                    height: box.height + 400   // Generous space below for safety
                };
                console.log(`[AvatarGroupHelper] Taking clipped screenshot: ${JSON.stringify(clip)}`);
                const buffer = await page.screenshot({ clip, animations: 'disabled' }).catch(() => null);
                if (buffer) {
                    screenshotBuffers.push(buffer);
                    console.log('[AvatarGroupHelper] Aggregate/Avatar focused shot captured.');
                }
            }
        } catch (e) {
            console.warn(`[AvatarGroupHelper] Clip screenshot failed: ${e.message}`);
        }

        // 3️⃣ Find Avatars (Shadow DFS)
        const avatarSelectors = [
            '.feedspace-avatar-group-item',
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
                
                // Check current node
                selectors.forEach(s => {
                    try {
                        const matches = node.querySelectorAll(s);
                        matches.forEach(m => {
                            if (!visited.has(m)) {
                                visited.add(m);
                                const box = m.getBoundingClientRect();
                                if (box.width > 0 && box.height > 0) {
                                    // Generate a temp ID for Playwright to find it
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

                // Recurse into children
                Array.from(node.children || []).forEach(child => {
                    findInRoot(child);
                    if (child.shadowRoot) findInRoot(child.shadowRoot);
                });
            };

            findInRoot(root);
            if (root.shadowRoot) findInRoot(root.shadowRoot);

            return results;
        }, { tempId: discoveryTempId, selectors: avatarSelectors });

        console.log(`[AvatarGroupHelper] Found ${avatars.length} avatars in Shadow/DOM.`);

        // 4️⃣ Interact with up to 5 unique avatars (User requested 5 if more than 10 exist)
        const seenFeedIds = new Set();
        const uniqueAvatars = avatars.filter(a => {
            if (!a.feedId) return true;
            if (seenFeedIds.has(a.feedId)) return false;
            seenFeedIds.add(a.feedId);
            return true;
        });

        const targets = uniqueAvatars.slice(0, 5); // Take up to 5 unique ones

        console.log(`[AvatarGroupHelper] Selected ${targets.length} unique avatars for interaction.`);

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const selector = `[data-fs-temp-id="${target.id}"]`;

            try {
                console.log(`[AvatarGroupHelper] Clicking unique avatar ${i + 1}/${targets.length} (ID: ${target.id})...`);
                
                // Click via JS to ensure it pierces shadow boundaries reliably
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel) || 
                               Array.from(document.querySelectorAll('*'))
                                    .find(n => n.shadowRoot && n.shadowRoot.querySelector(sel))
                                    ?.shadowRoot.querySelector(sel);
                    if (el) {
                        el.scrollIntoView({ block: 'center' });
                        el.click();
                    }
                }, selector);

                // Wait longer for popup to be stable and fully rendered
                await page.waitForTimeout(3000); 

                // Capture standard VIEWPORT for review cards to ensure the popup is centered and legible
                console.log(`[AvatarGroupHelper] Capturing viewport screenshot for review card ${i + 1}...`);
                const shot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
                if (shot) screenshotBuffers.push(shot);

                // Close popup by clicking away from common widget areas
                await page.mouse.click(50, 50); 
                await page.waitForTimeout(1000);
            } catch (err) {
                console.warn(`[AvatarGroupHelper] Failed to interact with avatar ${i + 1}: ${err.message}`);
            }
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarGroupHelper;