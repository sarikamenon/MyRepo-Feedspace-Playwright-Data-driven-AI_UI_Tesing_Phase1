class AvatarGroupHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[AvatarGroupHelper] Starting sequential interaction (5+ avatars, 1536x700)...');

        const screenshotBuffers = [];

        // 1️⃣ Initial State: Identify Row & Run Static Integrity Probes (Overbleed/Truncation)
        try {
            const box = await widgetLocator.boundingBox();

            if (box) {
                // Focused initial capture (Generous 100px context)
                const padding = 100;
                const clip = {
                    x: Math.max(0, box.x - padding),
                    y: Math.max(0, box.y - padding),
                    width: Math.min(box.width + (padding * 2), page.viewportSize().width - Math.max(0, box.x - padding)),
                    height: Math.min(box.height + (padding * 2), page.viewportSize().height - Math.max(0, box.y - padding))
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
                    } catch (e) { }
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

        // 3️⃣ Sequential Interaction (Up to 50 unique reviews)
        const targets = avatars.slice(0, 50);
        const capturedFingerprints = new Set();
        const visitedPositions = new Set();

        let consecutiveFails = 0;
        let lastY = -1;

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const currentY = Math.round(target.rect.y);

            // 🛑 Early Exit 1: Massive Vertical Jump (Target is likely in footer or outside widget)
            if (lastY !== -1 && Math.abs(currentY - lastY) > 1000) {
                console.log(`[AvatarGroupHelper] 🛑 Stop: Detected potential layout jump (Y: ${lastY} -> ${currentY}). Ending interaction.`);
                break;
            }
            lastY = currentY;

            // 🛑 Early Exit 2: Aggressive 3-Strike Rule (Combined Duplicates/Duds)
            if (consecutiveFails >= 3 && capturedFingerprints.size > 0) {
                console.log(`[AvatarGroupHelper] 🛑 Stop: 3 consecutive unproductive interactions after finding unique content. Done.`);
                break;
            }

            const posKey = `${Math.round(target.rect.x)},${currentY}`;
            if (visitedPositions.has(posKey)) {
                console.log(`[AvatarGroupHelper] Case ${i + 1}: Skipping redundant coordinate ${posKey}`);
                continue;
            }
            visitedPositions.add(posKey);

            const selector = `[data-fs-temp-id="${target.id}"]`;

            try {
                console.log(`[AvatarGroupHelper] Case ${i + 1}: Clicking avatar at (${Math.round(target.rect.x)}, ${currentY})...`);

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

                await page.waitForTimeout(3000); // Increased for stability on slower embeds

                const popupSelectors = '.feedspace-avatar-review-popup, .fe-review-box, .fe-modal-content';
                const popupLocator = page.locator(popupSelectors).filter({ visible: true }).first();
                const popupBox = await popupLocator.boundingBox().catch(() => null);
                const vSize = page.viewportSize();

                if (!popupBox) {
                    console.log(`[AvatarGroupHelper] [DIAGNOSTIC] No visible popup found using selectors: ${popupSelectors}`);
                    console.log(`[AvatarGroupHelper] Case ${i + 1}: No popup detected after click.`);
                    consecutiveFails++;
                } else {
                    const rect = popupBox;
                    const vSize = page.viewportSize();
                    const distToBottom = vSize.height - (rect.y + rect.height);
                    const distToRight = vSize.width - (rect.x + rect.width);
                    
                    console.log(`[AvatarGroupHelper] [DIAGNOSTIC] Boundary Check: y=${Math.round(rect.y)}, h=${Math.round(rect.height)}, x=${Math.round(rect.x)}, w=${Math.round(rect.width)}. Viewport=${vSize.width}x${vSize.height}.`);

                    // 🛡️ UNIVERSAL EDGE SENTINEL Logic
                    let edgeFail = null;
                    if (distToBottom < 20) edgeFail = `FAIL_BOTTOM_EDGE_CLIPPED (Gap: ${Math.round(distToBottom)}px)`;
                    else if (rect.y < 5) edgeFail = `FAIL_TOP_EDGE_CLIPPED (y: ${Math.round(rect.y)}px)`;
                    else if (distToRight < 10) edgeFail = `FAIL_RIGHT_EDGE_CLIPPED (Gap: ${Math.round(distToRight)}px)`;
                    else if (rect.x < 5) edgeFail = `FAIL_LEFT_EDGE_CLIPPED (x: ${Math.round(rect.x)}px)`;

                    if (edgeFail) {
                        const msg = `TRUTH DATA: FAIL_LAYOUT_CLIPPED detected. Popup ${i + 1} is SLICED at the boundary. Issue: ${edgeFail}.`;
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(msg);
                    }

                    // 🛡️ Parent Container Clipping Check (New) - Detects if parent has overflow:hidden
                    const isParentClipped = await popupLocator.evaluate((el) => {
                        const getClippedParent = (node) => {
                            let p = node.parentElement;
                            while (p && p !== document.body) {
                                const s = window.getComputedStyle(p);
                                if (s.overflow !== 'visible') {
                                    const pRect = p.getBoundingClientRect();
                                    const elRect = node.getBoundingClientRect();
                                    // If element bottom is > parent bottom, it is being sliced by the parent
                                    if (elRect.bottom > pRect.bottom + 5) return p.className || p.tagName;
                                }
                                p = p.parentElement;
                            }
                            return null;
                        };
                        return getClippedParent(el);
                    }).catch(() => null);

                    if (isParentClipped) {
                        const msg = `TRUTH DATA: FAIL_CONTAINER_CLIPPED detected. Popup ${i + 1} is sliced by parent container (${isParentClipped}). The text is being cut off vertically.`;
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(msg);
                    }

                    // 🛡️ Intersection Audit (Strict visibility check)
                    const visibleRatio = await popupLocator.evaluate((el) => {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) return 0;
                        const vHeight = window.innerHeight;
                        const vWidth = window.innerWidth;
                        const visibleHeight = Math.min(r.bottom, vHeight) - Math.max(r.top, 0);
                        const visibleWidth = Math.min(r.right, vWidth) - Math.max(r.left, 0);
                        return (visibleHeight * visibleWidth) / (r.height * r.width);
                    }).catch(() => 1);

                    if (visibleRatio < 0.98) {
                        const msg = `TRUTH DATA: FAIL_LAYOUT_CLIPPED detected. Only ${Math.round(visibleRatio * 100)}% of the review card is visible. Content is being SQUEEZED or SLICED.`;
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(msg);
                    }

                    // 🛡️ Internal Overflow Audit (Detects text hidden inside the box)
                    const internalOverflow = await popupLocator.evaluate((el) => {
                        const isClipped = el.scrollHeight > el.clientHeight + 2;
                        return { isClipped, sh: el.scrollHeight, ch: el.clientHeight };
                    }).catch(() => ({ isClipped: false }));

                    if (internalOverflow.isClipped) {
                        const msg = `TRUTH DATA: FAIL_TEXT_TRUNCATED detected. Content is ${internalOverflow.sh}px but the box is only ${internalOverflow.ch}px. Text is sliced inside the container.`;
                        console.log(`[SYSTEM ALERT] ${msg}`);
                        if (geometricWarnings) geometricWarnings.push(msg);
                    }

                    // 🛡️ Content Fingerprint Check
                    const fingerprint = await popupLocator.evaluate((el, index) => {
                        const nameEl = el.querySelector('.fe-reviewer-name, [class*="name"]');
                        const textEl = el.querySelector('.fe-review-text, [class*="text"]');
                        const name = nameEl ? nameEl.innerText.trim() : '';
                        const text = textEl ? textEl.innerText.trim().substring(0, 50) : '';

                        // If both name and text are empty, it's likely a skeleton loader.
                        // Force a unique fingerprint so the interaction isn't skipped.
                        if (!name && !text) {
                            return `SKELETON_UNRENDERED_${index}_${Date.now()}`;
                        }

                        return `${name}|${text}`;
                    }, i).catch(() => null);

                    if (fingerprint && capturedFingerprints.has(fingerprint)) {
                        console.log(`[AvatarGroupHelper] Skipping duplicate review content: ${fingerprint.split('|')[0]}`);
                        consecutiveFails++;
                    } else {
                        consecutiveFails = 0; // Reset strikes on a fresh find
                        if (fingerprint) capturedFingerprints.add(fingerprint);

                        // 🛡️ Linguistic Truth Injection (Extract last words for AI to verify)
                        const lastWords = await popupLocator.evaluate((el) => {
                            const textEl = el.querySelector('.fe-review-text, [class*="text"]');
                            if (!textEl) return '';
                            const text = textEl.innerText.trim();
                            const words = text.split(/\s+/);
                            // Return the last 4 words for a strong linguistic anchor
                            return words.slice(-4).join(' ');
                        }).catch(() => '');

                        if (lastWords) {
                            const msg = `TRUTH DATA: DOM_END_TEXT is "${lastWords}". If the screenshot ends before these words, it is a FAIL.`;
                            console.log(`[SYSTEM ALERT] ${msg}`);
                            if (geometricWarnings) geometricWarnings.push(msg);
                        }

                        // 📸 Viewport Capture (Restored Baseline)
                        console.log(`[AvatarGroupHelper] Case ${i + 1}: Unique review confirmed. Capturing Viewport...`);
                        await page.waitForTimeout(1000); // Brief stabilization wait
                        screenshotBuffers.push(await page.screenshot({ fullPage: false, animations: 'disabled' }));

                        const vSize = page.viewportSize();
                        const padding = 150;
                        const clipX = Math.max(0, popupBox.x - padding);
                        const clipY = Math.max(0, popupBox.y - padding);
                        const clip = {
                            x: clipX,
                            y: clipY,
                            width: Math.min(popupBox.width + (padding * 2), vSize.width - clipX),
                            height: Math.min(popupBox.height + (padding * 2), vSize.height - clipY)
                        };
                        screenshotBuffers.push(await page.screenshot({ clip, animations: 'disabled' }));
                    console.log(`[AvatarGroupHelper] Unique review captured: ${fingerprint ? fingerprint.split('|')[0] : 'Unknown'}`);
                    }
                }

                // Close popup to avoid overlap
                await page.mouse.click(10, 10);
                await page.waitForTimeout(500);

            } catch (err) {
                console.warn(`[AvatarGroupHelper] Sequential Error ${i + 1}: ${err.message}`);
            }
        }

        return screenshotBuffers;
    }
}

module.exports = AvatarGroupHelper;