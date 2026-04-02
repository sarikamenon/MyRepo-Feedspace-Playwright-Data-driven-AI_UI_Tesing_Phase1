'use strict';

class CompanyLogoSliderHelper {
    static async interact(page, widgetLocator, geometricWarnings) {
        console.log('[CompanyLogoSliderHelper] Starting sequential interactions...');

        const screenshotBuffers = [];

        // ── 1. Scroll widget into view + initial capture ────────────────────
        try {
            await widgetLocator.evaluate(el =>
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ).catch(() => { });
            await page.waitForTimeout(2000);

            await widgetLocator
                .locator('.feedspace-company-logo, .fe-logo, img')
                .first()
                .waitFor({ state: 'visible', timeout: 10000 })
                .catch(() => { });

            const box = await widgetLocator.boundingBox();
            if (box) {
                const shot = await page.screenshot({
                    clip: {
                        x: Math.max(0, box.x - 40),
                        y: Math.max(0, box.y - 20),
                        width: box.width + 80,
                        height: box.height + 40
                    },
                    animations: 'disabled'
                }).catch(() => null);
                if (shot) screenshotBuffers.push(shot);
            }
        } catch (e) {
            console.warn(`[CompanyLogoSliderHelper] Initial capture failed: ${e.message}`);
        }

        // ── 2. Discover cards WITHOUT freezing animation ─────────────────────
        // Freezing leaves cards at stale mid-scroll coordinates.
        // Instead: pause via CSS class on the ROOT only, let the browser
        // reflow, THEN read coordinates — cards will be at rendered positions.
        try {
            const discoveryTempId = 'fs_logo_root_' + Date.now();

            await widgetLocator.evaluate((el, id) => {
                el.setAttribute('data-fs-discovery-root', id);

                // Inject a pause style scoped to this widget only
                const style = document.createElement('style');
                style.id = id + '_style';
                style.textContent = `
                    [data-fs-discovery-root="${id}"] *,
                    [data-fs-discovery-root="${id}"] *::before,
                    [data-fs-discovery-root="${id}"] *::after {
                        animation-play-state: paused !important;
                        transition: none !important;
                    }
                `;
                document.head.appendChild(style);
            }, discoveryTempId).catch(() => { });

            // Give browser one full frame to reflow after pausing
            await page.waitForTimeout(600);

            const cardSelectors = [
                '.feedspace-company-logo',
                '.feedspace-company-logo-slider-item',
                '.feedspace-logo',
                '.fe-logo',
                '.company-logo-card'
            ];

            const uniqueTargets = await page.evaluate(({ tempId, selectors }) => {
                const root = document.querySelector(`[data-fs-discovery-root="${tempId}"]`);
                if (!root) return [];

                const rootRect = root.getBoundingClientRect();
                const results = [];
                const visited = new Set();

                function scan(node) {
                    if (!node) return;
                    selectors.forEach(s => {
                        node.querySelectorAll(s).forEach(m => {
                            if (visited.has(m)) return;
                            visited.add(m);
                            const rect = m.getBoundingClientRect();
                            const style = window.getComputedStyle(m);

                            const centerX = rect.left + rect.width / 2;
                            const centerY = rect.top + rect.height / 2;

                            if (
                                rect.width > 20 &&
                                rect.height > 20 &&
                                centerX >= rootRect.left &&
                                centerX <= rootRect.right &&
                                centerY >= rootRect.top &&
                                centerY <= rootRect.bottom &&
                                style.visibility !== 'hidden' &&
                                style.display !== 'none' &&
                                parseFloat(style.opacity) > 0 &&
                                style.pointerEvents !== 'none'
                            ) {
                                // ── DYNAMIC TARGETING ID ────────────────────────────
                                const targetId = 'logo_target_' + Math.random().toString(36).substr(2, 9);
                                m.setAttribute('data-fs-interaction-id', targetId);

                                results.push({
                                    targetId,
                                    x: centerX,
                                    y: centerY,
                                    rawX: rect.left,
                                    width: rect.width,
                                    height: rect.height
                                });
                            }
                        });
                    });
                    Array.from(node.children || []).forEach(c => {
                        scan(c);
                        if (c.shadowRoot) scan(c.shadowRoot);
                    });
                }
                scan(root);

                const sorted = results.sort((a, b) => a.rawX - b.rawX);

                // Deduplicate clones: keep first occurrence per X cluster
                const deduped = [];
                for (const candidate of sorted) {
                    const isDupe = deduped.some(
                        kept => Math.abs(kept.rawX - candidate.rawX) < candidate.width * 0.5
                    );
                    if (!isDupe) deduped.push(candidate);
                }

                const halfLen = Math.floor(sorted.length / 2);
                return deduped.length >= 2 ? deduped : sorted.slice(0, halfLen);

            },


                { tempId: discoveryTempId, selectors: cardSelectors });

            console.log(`[CompanyLogoSliderHelper] Found ${uniqueTargets.length} unique cards`);
            uniqueTargets.forEach((t, i) =>
                console.log(`  Card ${i + 1}: x=${Math.round(t.x)} y=${Math.round(t.y)} (${Math.round(t.width)}x${Math.round(t.height)})`)
            );

            // ── 3. Sequential click → capture → close ───────────────────────
            for (let i = 0; i < uniqueTargets.length; i++) {
                const target = uniqueTargets[i];
                console.log(`[CompanyLogoSliderHelper] Card ${i + 1}/${uniqueTargets.length} at (${Math.round(target.x)}, ${Math.round(target.y)})`);

                const cardPromise = (async () => {
                    try {
                        // ── 3. PRE-INTERACTION RESET ──────────────────────
                        await page.evaluate(() => {
                            function hideAll(node) {
                                if (!node) return;
                                node.querySelectorAll('.feedspace-company-logo-review-popup, [class*="review-popup"], [class*="expanded"]').forEach(p => {
                                    p.style.setProperty('display', 'none', 'important');
                                    p.style.setProperty('opacity', '0', 'important');
                                });
                                Array.from(node.children || []).forEach(c => {
                                    hideAll(c);
                                    if (c.shadowRoot) hideAll(c.shadowRoot);
                                });
                            }
                            hideAll(document);
                        }).catch(() => { });
                        await page.mouse.click(20, 20);
                        await page.waitForTimeout(400);

                        await page.mouse.move(target.x, target.y);
                        await page.waitForTimeout(400);

                        // ── DUAL TRIGGER CLICK ───────────────────────────
                        const targetLocator = widgetLocator.locator(`[data-fs-interaction-id="${target.targetId}"]`);
                        await targetLocator.click({ force: true, timeout: 3000 }).catch(() => { });
                        // Fallback JS click if expansion delayed
                        await targetLocator.evaluate(el => el.click()).catch(() => { });
                        await page.waitForTimeout(1000);

                        // ── FLAT SHADOW DISCOVERY ──────────────────────────
                        let expanded = await page.evaluate(() => {
                            function getPopups(root) {
                                let found = Array.from(root.querySelectorAll('.feedspace-company-logo-review-popup, [class*="review-popup"], [class*="expanded"]'));
                                root.querySelectorAll('*').forEach(el => {
                                    if (el.shadowRoot) found = found.concat(getPopups(el.shadowRoot));
                                });
                                return found;
                            }
                            const popups = getPopups(document);
                            return popups.some(p => {
                                const s = window.getComputedStyle(p);
                                return (p.innerText || '').trim().length > 20 &&
                                       s.display !== 'none' &&
                                       s.visibility !== 'hidden' &&
                                       parseFloat(s.opacity) > 0.1;
                            });
                        }).catch(() => false);

                        if (!expanded) {
                            console.warn(`[CompanyLogoSliderHelper] Card ${i + 1}: nudging hidden popup...`);
                            await page.evaluate(({ targetId }) => {
                                // Deep ID discovery searches ALL shadow roots
                                function findDeepId(node, id) {
                                    if (!node) return null;
                                    const m = node.querySelector(`[data-fs-interaction-id="${id}"]`);
                                    if (m) return m;
                                    for (const child of Array.from(node.children || [])) {
                                        const res = findDeepId(child, id) || (child.shadowRoot ? findDeepId(child.shadowRoot, id) : null);
                                        if (res) return res;
                                    }
                                    return null;
                                }
                                const item = findDeepId(document, targetId);
                                if (item) {
                                    const p = item.querySelector('.feedspace-company-logo-review-popup, [class*="review-popup"]');
                                    if (p) {
                                        p.style.setProperty('opacity', '1', 'important');
                                        p.style.setProperty('visibility', 'visible', 'important');
                                        p.style.setProperty('height', 'auto', 'important');
                                        p.style.setProperty('display', 'block', 'important');
                                    }
                                }
                            }, { targetId: target.targetId }).catch(() => { });
                            await page.waitForTimeout(800);
                        }

                        // ── INSTANT BOUNDING BOX (No Stability Hang) ──────
                        const widgetRect = await widgetLocator.evaluate(el => {
                            const r = el.getBoundingClientRect();
                            return { x: r.x, y: r.y, width: r.width, height: r.height };
                        }).catch(() => null);

                        if (widgetRect) {
                            const clip = {
                                x: Math.max(0, Math.floor(widgetRect.x - 40)),
                                y: Math.max(0, Math.floor(widgetRect.y - 20)),
                                width: Math.min(Math.ceil(widgetRect.width + 80), 1400),
                                height: Math.min(Math.ceil(widgetRect.height + 800), 2000)
                            };
                            const shot = await page.screenshot({ clip, animations: 'disabled', timeout: 4000 }).catch(() => null);
                            if (shot) screenshotBuffers.push(shot);
                        }

                        // ── DISMISSAL ─────────────────────────────────────
                        await page.keyboard.press('Escape').catch(() => { });
                        await page.mouse.click(20, 20);
                        await page.waitForTimeout(500);

                    } catch (e) {
                        console.warn(`[CompanyLogoSliderHelper] Card ${i + 1} inner fail: ${e.message}`);
                    }
                })();

                // Global Card Timeout: Max 15s per card interaction
                const timeoutPromise = new Promise(resolve => setTimeout(resolve, 15000));
                await Promise.race([cardPromise, timeoutPromise]);
                console.log(`[CompanyLogoSliderHelper] Card ${i + 1} cycle complete`);
            }

            // Cleanup injected pause style
            await page.evaluate(id => {
                document.getElementById(id + '_style')?.remove();
            }, discoveryTempId).catch(() => { });

        } catch (err) {
            console.warn(`[CompanyLogoSliderHelper] Critical failure: ${err.message}`);
        }

        return screenshotBuffers;
    }
}

module.exports = CompanyLogoSliderHelper;