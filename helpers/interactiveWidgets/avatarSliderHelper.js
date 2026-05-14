class AvatarSliderHelper {
    /**
     * Interact with Avatar Slider widgets (Single Slider) by clicking arrows or avatars.
     * Captures high-res screenshots of the content area as it updates.
     *
     * @param {import('playwright').Page|import('playwright').Frame} context - Playwright context
     * @param {import('playwright').Locator} widgetLocator - The parent widget container
     * @param {string[]} geometricWarnings - Array to collect truth-data warnings
     * @returns {Promise<Buffer[]>} - Array of screenshot buffers
     */
    static async interact(context, widgetLocator, config, geometricWarnings = []) {
        console.log('[AvatarSliderHelper] Starting interactive avatar slider validation...');
        const screenshotBuffers = [];

        // Determine the actual page object for screenshots if needed
        const page = context.page ? context.page() : context;

        // 🎯 Backend-Driven Targeted Capture
        let targetedFeedNames = [];
        if (config) {
            const rawFeeds = config.widget_data?.feeds_data || config.feeds_data || config.data?.feeds_data || config.data || [];
            if (Array.isArray(rawFeeds) && rawFeeds.length > 0) {
                // Find ALL reviews that have a rating > 1
                const ratedFeeds = rawFeeds.filter(f => {
                    const r = f.rating !== null && f.rating !== undefined ? f.rating : f.response;
                    return r && r > 1;
                });
                targetedFeedNames = ratedFeeds.map(f => f.app_user_name || f.user_name || f.name).filter(Boolean);
                if (targetedFeedNames.length > 0) {
                    console.log(`[AvatarSliderHelper] Backend Targeting: Found ${targetedFeedNames.length} reviewers with ratings > 1.`);
                } else {
                    console.log(`[AvatarSliderHelper] Backend Targeting: No reviewers with rating > 1 found in data.`);
                }
            } else {
                console.log(`[AvatarSliderHelper] Backend Targeting: No feed data available in config.`);
            }
        } else {
            console.warn(`[AvatarSliderHelper] Backend Targeting: No configuration object provided.`);
        }

        try {
            // 1️⃣ Determine the interaction targets (Arrows preferred, then Avatars)
            const root = widgetLocator || context;

            const arrowSelectors = [
                '.feedspace-avatar-slider-next',
                '.feedspace-items-slider-next',
                '.next-btn',
                '.swiper-button-next',
                '.carousel-control-next',
                '.feedspace-slider-next',
                'button:has-text(">")',
                '[class*="next"]',
                '[class*="right"]',
                'svg[class*="next"]'
            ];

            const prevArrowSelectors = [
                '.feedspace-avatar-slider-prev',
                '.feedspace-items-slider-prev',
                '.prev-btn',
                '.swiper-button-prev',
                '.carousel-control-prev',
                '.feedspace-slider-prev',
                'button:has-text("<")',
                '[class*="prev"]',
                '[class*="left"]',
                'svg[class*="prev"]'
            ];

            const avatarSelectors = [
                '.feedspace-avatar-dot',
                '.feedspace-avatar-button',
                '.slider-dot',
                '.feedspace-avatar-item',
                '.avatar-item',
                '.avatar-wrapper',
                '.swiper-pagination-bullet',
                '.owl-dot',
                'div[class*="avatar-item"]:not([class*="read-more"])',
                '.swiper-slide'
            ];

            let nextArrow = root.locator(arrowSelectors.join(', ')).filter({ visible: true }).first();
            let prevArrow = root.locator(prevArrowSelectors.join(', ')).filter({ visible: true }).first();
            let avatarControls = root.locator(avatarSelectors.join(', ')).filter({ visible: true });

            const hasArrows = await nextArrow.isVisible().catch(() => false);
            const hasPrevArrow = await prevArrow.isVisible().catch(() => false);
            const avatarCount = await avatarControls.count().catch(() => 0);

            console.log(`[AvatarSliderHelper] Found: Arrows(N:${hasArrows}, P:${hasPrevArrow}), Avatars=${avatarCount}`);

            // 🎯 Phase 0: Target Hunting (Hunt for ANY reviewer with ratings > 1)
            if (targetedFeedNames.length > 0) {
                console.log(`[AvatarSliderHelper] 🕵️ Hunting for a reviewer with ratings > 1...`);
                for (let h = 0; h < 15; h++) {
                    let foundName = null;
                    for (const name of targetedFeedNames) {
                        // FUZZY MATCH: Try exact, then first name, then contains
                        const firstName = name.split(' ')[0];
                        const selectors = [`text="${name}"`, `text="${firstName}"`, `text=${firstName}`];
                        
                        for (const sel of selectors) {
                            const match = root.locator(sel).first();
                            if (await match.isVisible().catch(() => false)) {
                                foundName = name;
                                break;
                            }
                        }
                        if (foundName) break;
                    }
                    
                    if (foundName) {
                        console.log(`[AvatarSliderHelper] 🎯 Target '${foundName}' located in view!`);
                        await context.waitForTimeout(1000); // Wait for animations
                        break;
                    }
                    
                    if (hasArrows) {
                        await nextArrow.click({ force: true }).catch(() => {});
                    } else if (avatarCount > 0) {
                        await avatarControls.nth(h % avatarCount).click({ force: true }).catch(() => {});
                    } else {
                        break;
                    }
                    await context.waitForTimeout(1000);
                }
            }

            // 2️⃣ Interaction Loop
            const maxScreenshots = 8; // Increased to 8 as requested
            const maxAttempts = 15;

            // Initial screenshot
            const initialShot = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
            if (initialShot) screenshotBuffers.push(initialShot);

            let targetFound = false;
            const clickedIndices = new Set();
            const capturedIdentities = new Set();

            for (let i = 0; i < maxAttempts && screenshotBuffers.length < maxScreenshots - 1; i++) {
                try {
                    let target = null;
                    
                    // 🔘 Priority 0: Click the avatar of the targeted person (if found)
                    if (targetedFeedNames.length > 0 && !targetFound) {
                        const firstName = targetedFeedNames[0].split(' ')[0];
                        // Try finding avatar by text or alt attribute
                        const targetedAvatar = root.locator(avatarSelectors.join(', ')).filter({ hasText: firstName }).first();
                        const targetedImg = root.locator('img').filter({ hasAttribute: ['alt', new RegExp(firstName, 'i')] }).first();
                        
                        if (await targetedAvatar.isVisible().catch(() => false)) {
                            target = targetedAvatar;
                            console.log(`[AvatarSliderHelper] Target Identified: Clicking Avatar for '${targetedFeedNames[0]}'`);
                        } else if (await targetedImg.isVisible().catch(() => false)) {
                            target = targetedImg;
                            console.log(`[AvatarSliderHelper] Target Identified: Clicking Image for '${targetedFeedNames[0]}'`);
                        }
                    }

                    // 🔘 Priority 1: Click a specific unclicked avatar (best for unique shots)
                    if (!target && avatarCount > 0) {
                        let index = -1;
                        for (let j = 0; j < avatarCount; j++) {
                            const candidateIndex = (i + j) % avatarCount;
                            if (!clickedIndices.has(candidateIndex)) {
                                index = candidateIndex;
                                break;
                            }
                        }
                        
                        if (index !== -1) {
                            target = avatarControls.nth(index);
                            clickedIndices.add(index);
                            console.log(`[AvatarSliderHelper] Clicking Unique Avatar #${index + 1} (Interaction #${screenshotBuffers.length})`);
                        }
                    }

                    // 🔘 Priority 2: Use arrows if no new avatars to click
                    if (!target && hasArrows) {
                        target = nextArrow;
                        console.log(`[AvatarSliderHelper] Clicking Right Arrow (Interaction #${screenshotBuffers.length})`);
                    }

                    if (!target) break;

                    await target.scrollIntoViewIfNeeded().catch(() => { });
                    await target.click({ force: true, timeout: 5000 }).catch(() => { });

                    // Wait longer for content stabilization (stars often render slightly later)
                    await context.waitForTimeout(4000);

                    // Locate content area for high-res focus
                    const contentArea = root.locator('.feedspace-items-slider, .feedspace-single-review-widget, .feedspace-elements-wrapper').filter({ visible: true }).first();

                    if (await contentArea.isVisible()) {
                        await contentArea.scrollIntoViewIfNeeded().catch(() => { });

                        // 🎯 Targeted Snap: If a card with ratings is visible, ensure we are focused on it
                        if (targetedFeedNames.length > 0 && !targetFound) {
                            let foundMatch = null;
                            for (const name of targetedFeedNames) {
                                const firstName = name.split(' ')[0];
                                const fuzzySelectors = [`text="${name}"`, `text="${firstName}"`, `text=${firstName}`];
                                for (const sel of fuzzySelectors) {
                                    const match = contentArea.locator(sel).first();
                                    if (await match.isVisible().catch(() => false)) {
                                        foundMatch = match;
                                        console.log(`[AvatarSliderHelper] Found targeted card for '${name}' via fuzzy match.`);
                                        break;
                                    }
                                }
                                if (foundMatch) break;
                            }
                            if (foundMatch) {
                                await foundMatch.scrollIntoViewIfNeeded().catch(() => { });
                                await page.waitForTimeout(500);
                                targetFound = true; 
                            }
                        }

                        // 🟢 Expand "Read More" if present
                        await this._tryExpandReadMore(contentArea, page);
                    }

                    // 🟢 Modal/Popup Detection: If Read More opened a modal, we must capture the whole page
                    const modalSelectors = [
                        '.feedspace-modal', 
                        '.feedspace-popup', 
                        '.feedspace-lightbox', 
                        '[class*="modal-content"]', 
                        '[class*="popup-content"]',
                        '.feedspace-single-review-modal'
                    ];
                    const modal = page.locator(modalSelectors.join(', ')).filter({ visible: true }).first();
                    const isModalOpen = await modal.isVisible().catch(() => false);

                    if (isModalOpen) {
                        console.log('[AvatarSliderHelper] 📢 Modal detected! Capturing full viewport.');
                        await page.waitForTimeout(1000); // Modal animation buffer
                    }

                    // Use page if modal is open, otherwise use widgetLocator for focus
                    const shotTarget = isModalOpen ? page : (widgetLocator || (await contentArea.isVisible() ? contentArea : page));
                    const tBox = isModalOpen ? null : await shotTarget.boundingBox();
                    let buffer = null;

                    if (!isModalOpen && tBox) {
                        const vSize = page.viewportSize();
                        const padding = 150; 
                        const extraBottomPadding = 600; // 🔥 CRITICAL: Force more vertical context to catch review text below avatars
                        const clipX = Math.max(0, tBox.x - padding);
                        const clipY = Math.max(0, tBox.y - padding);

                        buffer = await page.screenshot({
                            clip: {
                                x: clipX,
                                y: clipY,
                                width: Math.min(tBox.width + (padding * 2), vSize.width - clipX),
                                height: Math.min(tBox.height + padding + extraBottomPadding, vSize.height - clipY)
                            },
                            animations: 'disabled'
                        }).catch(() => null);
                    } else {
                        buffer = await (widgetLocator || page).screenshot({ animations: 'disabled' }).catch(() => null);
                    }

                    // 🆔 Super-Fingerprint Deduplication (Scrape all visible text to create a unique ID)
                    let currentIdentity = "Unknown";
                    try {
                        const activeArea = isModalOpen ? modal : contentArea;
                        
                        // Strategy: Scrape all text, remove whitespace and numbers (dates/times), and take a large chunk
                        const rawText = await activeArea.innerText().catch(() => "");
                        const fingerprint = rawText.replace(/[\s\d\W]+/g, '').slice(0, 150);
                        
                        if (fingerprint.length > 5) {
                            currentIdentity = fingerprint;
                        } else {
                            // Fallback to name extraction if text is too sparse
                            const nameLocator = activeArea.locator('.feedspace-reviewer-name, .feedspace-user-name, h3, h4, strong').first();
                            if (await nameLocator.isVisible().catch(() => false)) {
                                currentIdentity = (await nameLocator.innerText().catch(() => "Unknown")).trim();
                            }
                        }
                    } catch (idErr) { }

                    if (buffer) {
                        const isDuplicateIdentity = currentIdentity !== "Unknown" && capturedIdentities.has(currentIdentity);
                        const lastBuffer = screenshotBuffers[screenshotBuffers.length - 1];
                        const isBinaryDuplicate = lastBuffer && buffer.equals(lastBuffer);

                        if (isDuplicateIdentity || isBinaryDuplicate) {
                            console.log(`[AvatarSliderHelper] ⏭️ Skipping duplicate review (Fingerprint: ${currentIdentity.slice(0, 20)}...)`);
                        } else {
                            screenshotBuffers.push(buffer);
                            if (currentIdentity !== "Unknown") {
                                console.log(`[AvatarSliderHelper] ✅ Captured unique review (ID: ${currentIdentity.slice(0, 20)}...)`);
                                capturedIdentities.add(currentIdentity);
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[AvatarSliderHelper] Interaction step failed: ${e.message}`);
                }
            }

            // 📸 5th Screenshot: Full Page Context (JPEG optimized)
            console.log('[AvatarSliderHelper] Capturing final full-page context shot...');
            const finalShot = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 50, scale: 'css' }).catch(() => null);
            if (finalShot) screenshotBuffers.push(finalShot);

            console.log(`[AvatarSliderHelper] Interaction complete. Captured ${screenshotBuffers.length} states.`);
        } catch (error) {
            console.warn(`[AvatarSliderHelper] Error: ${error.message}`);
        }

        return screenshotBuffers;
    }

    /**
     * Attempts to find and click "Read More" buttons to expand truncated reviews.
     */
    static async _tryExpandReadMore(container, page) {
        try {
            const selectors = [
                'button:has-text("Read More")',
                'a:has-text("Read More")',
                'span:has-text("Read More")',
                '.read-more-btn',
                '[class*="read-more"]',
                '.feedspace-read-more'
            ];
            const readMore = container.locator(selectors.join(', ')).filter({ visible: true });
            const count = await readMore.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                console.log(`[AvatarSliderHelper] Expanding Read More #${i + 1}`);
                await readMore.nth(i).click({ force: true, timeout: 2000 }).catch(() => { });
                await (page || container.page()).waitForTimeout(1000); // Animation buffer for expansion/modal
            }
        } catch (e) {
            // Non-critical failure
        }
    }
}

module.exports = AvatarSliderHelper;
