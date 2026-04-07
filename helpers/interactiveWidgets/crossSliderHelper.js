/**
 * CrossSliderHelper.js
 *
 * Handles interaction and screenshot capture for CROSS_SLIDER widgets.
 * The cross slider has two diagonal marquee tracks (L2R and R2L) forming
 * an X-shape. Cards scroll diagonally but are clicked and expanded the
 * same way as StripSlider cards.
 *
 * Signature mirrors StripSliderHelper:
 *   interact(context, widgetLocator, geometricWarnings)
 *   → returns screenshotBuffers[]
 */

class CrossSliderHelper {

    static async interact(context, widgetLocator, geometricWarnings = []) {
        console.log('[CrossSliderHelper] Starting interaction...');

        const screenshots = [];
        // context may be a Page or a Frame — get the underlying Page for full-page screenshots
        const page = context.page ? context.page() : context;
        let styleHandle = null;

        try {
            // ── STEP 0: Freeze all animations ─────────────────────────────────
            // Diagonal CSS animations make cards jump between screenshots.
            // Freeze them before any interaction so cards are stationary.
            styleHandle = await context.addStyleTag({
                content: `
                    *, *::before, *::after {
                        animation-play-state: paused !important;
                        animation-duration: 0s !important;
                        transition: none !important;
                        -webkit-transition: none !important;
                    }
                `
            }).catch(e => {
                console.warn(`[CrossSliderHelper] Motion freeze failed: ${e.message}`);
                return null;
            });

            await context.waitForTimeout(800).catch(() => { });

            // ── STEP 1: Scroll widget into view ───────────────────────────────
            if (widgetLocator) {
                await widgetLocator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
            }
            await context.waitForTimeout(1000).catch(() => { });

            // ── STEP 2: Detect cross bar (L2R + R2L tracks) ───────────────────
            // This writes to geometricWarnings so the AI prompt knows both
            // tracks are rendered, and adds a note for the CROSS BAR feature check.
            try {
                const directions = await page.evaluate(() => {
                    const isVisible = (el) => {
                        const s = window.getComputedStyle(el);
                        return el.offsetWidth > 0 && el.offsetHeight > 0 &&
                            s.visibility !== 'hidden' && s.opacity !== '0';
                    };

                    const l2rSelectors = [
                        '.feedspace-cross-slider-l2r',
                        '.fe-cross-slider-l2r',
                        '[class*="cross-slider-l2r"]',
                        '[class*="cross_slider_l2r"]'
                    ];
                    const r2lSelectors = [
                        '.feedspace-cross-slider-r2l',
                        '.fe-cross-slider-r2l',
                        '[class*="cross-slider-r2l"]',
                        '[class*="cross_slider_r2l"]'
                    ];

                    const findAny = (selectors) => selectors.some(sel => {
                        const els = document.querySelectorAll(sel);
                        return Array.from(els).some(isVisible);
                    });

                    // Also pierce shadow DOM one level
                    const shadowHosts = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot);
                    const findInShadow = (selectors) => shadowHosts.some(host =>
                        selectors.some(sel => {
                            const el = host.shadowRoot.querySelector(sel);
                            return el && isVisible(el);
                        })
                    );

                    return {
                        l2r: findAny(l2rSelectors) || findInShadow(l2rSelectors),
                        r2l: findAny(r2lSelectors) || findInShadow(r2lSelectors)
                    };
                }).catch(() => ({ l2r: false, r2l: false }));

                if (directions.l2r && directions.r2l) {
                    console.log('[CrossSliderHelper] Cross bar detected — both L2R and R2L tracks visible.');
                    geometricWarnings.push(
                        "CROSS BAR DETECTED: Both diagonal marquee tracks (L2R and R2L) are visibly rendered forming an X-shape intersection."
                    );
                } else {
                    console.log(`[CrossSliderHelper] Track status — L2R: ${directions.l2r}, R2L: ${directions.r2l}`);
                }
            } catch (e) {
                console.warn(`[CrossSliderHelper] Cross bar detection error: ${e.message}`);
            }

            // ── STEP 3: Capture initial full widget view ───────────────────────
            const initialShot = await page.screenshot({ fullPage: false, animations: 'disabled' }).catch(() => null);
            if (initialShot) {
                screenshots.push(initialShot);
                console.log('[CrossSliderHelper] Initial view captured.');
            }

            // ── STEP 4: Discover review cards ─────────────────────────────────
            // Order: most specific Feedspace classes first, generic fallback last.
            // Do NOT use [class*="card"] — too broad, matches unrelated page elements.
            const CARD_SELECTORS = [
                '.feedspace-embed-card',
                '.feedspace-review-card',
                '.feedspace-element-feed-box-wrap',
                '.feedspace-element-feed-box',
                '.fe-review-card',
                'div[data-feed-id]',
                'div[data-review-id]',
                '[data-testid="review-card"]'
            ];

            // FIX: Scope to widgetLocator — NOT context.locator().
            // If a StripSlider and CrossSlider are both on the same page,
            // context.locator() finds cards from BOTH widgets. Scoping to
            // widgetLocator ensures we only interact with cards inside THIS
            // specific cross slider container.
            if (!widgetLocator) {
                console.warn('[CrossSliderHelper] No widgetLocator provided — cannot scope card search. Aborting card interaction.');
                return screenshots;
            }
            const cardLocator = widgetLocator.locator(CARD_SELECTORS.join(', ')).filter({ visible: true });

            // Wait up to 5s for at least one card to appear inside the widget
            await cardLocator.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
                console.warn('[CrossSliderHelper] No cards found within widget boundary — proceeding anyway.');
            });

            const allCards = await cardLocator.all().catch(() => []);
            console.log(`[CrossSliderHelper] Found ${allCards.length} visible card candidates.`);

            // ── STEP 5: Deduplicate cards ──────────────────────────────────────
            const seenIds = new Set();
            const targets = [];
            const MAX_POOL = 10;
            const MAX_CAPTURES = 4;   // cross slider has fewer unique cards visible at once

            for (const card of allCards) {
                if (targets.length >= MAX_POOL) break;

                // Try to get a unique data ID — same pattern as StripSliderHelper
                const feedId = await card.getAttribute('data-feed-id').catch(() => null);
                const reviewId = await card.getAttribute('data-review-id').catch(() => null);
                const fsId = await card.getAttribute('data-fs-interaction-id').catch(() => null);
                const uid = feedId || reviewId || fsId;

                if (uid) {
                    if (!seenIds.has(uid)) {
                        seenIds.add(uid);
                        targets.push(card);
                    }
                } else {
                    // No unique ID — include it unless we have enough already
                    if (!targets.includes(card)) targets.push(card);
                }
            }

            console.log(`[CrossSliderHelper] ${targets.length} deduplicated targets to interact with.`);

            // ── STEP 6: Per-card interaction loop ─────────────────────────────
            let successfulCaptures = 0;

            for (const card of targets) {
                if (successfulCaptures >= MAX_CAPTURES) break;
                if (page.isClosed()) break;

                try {
                    // 6a. Scroll card into view and capture it standalone
                    await card.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                    await context.waitForTimeout(300).catch(() => { });

                    const cardShot = await card.screenshot({ animations: 'disabled' }).catch(() => null);
                    if (cardShot) {
                        screenshots.push(cardShot);
                        console.log(`[CrossSliderHelper] Card ${successfulCaptures + 1} standalone shot captured.`);
                    }

                    // 6b. Click the card to open popup
                    // Click the card directly — do NOT try to find inner text/span elements,
                    // those selectors are unstable and vary by review content.
                    await card.hover({ force: true }).catch(() => { });
                    await card.click({ force: true, timeout: 3000 }).catch(async () => {
                        // Fallback: dispatch click event directly
                        await card.dispatchEvent('click').catch(() => { });
                    });
                    await context.waitForTimeout(1000).catch(() => { });

                    // 6c. Wait for popup
                    const POPUP_SELECTORS = [
                        '.fe-review-box',
                        '.fe-review-box-inner',
                        '.feedspace-review-box-main',
                        '.feedspace-review-box',
                        '.fe-modal-content',
                        '[class*="review-box"]'
                    ];

                    const popup = context
                        .locator(POPUP_SELECTORS.join(', '))
                        .filter({ visible: true })
                        .first();

                    const popupVisible = await popup.isVisible().catch(() => false);

                    if (popupVisible) {
                        console.log(`[CrossSliderHelper] Popup opened for card ${successfulCaptures + 1}.`);

                        // Scroll popup into view so it is not clipped
                        await popup.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                        await context.waitForTimeout(500).catch(() => { });

                        // Full viewport shot with popup open — gives AI date/CTA/ReadMore context
                        const popupShot = await page.screenshot({
                            fullPage: false,
                            animations: 'disabled'
                        }).catch(() => null);

                        if (popupShot) {
                            screenshots.push(popupShot);
                            successfulCaptures++;
                            console.log(`[CrossSliderHelper] Popup shot ${successfulCaptures} captured.`);
                        }

                        // 6d. Close popup — try close button first, fallback to corner click
                        const CLOSE_SELECTORS = [
                            '.fe-review-box-close-icon',
                            '.feedspace-review-box-close-icon',
                            '.close-icon',
                            '.close-btn',
                            'button[aria-label="Close"]'
                        ];
                        const closeBtn = context
                            .locator(CLOSE_SELECTORS.join(', '))
                            .filter({ visible: true })
                            .first();

                        const closeVisible = await closeBtn.isVisible().catch(() => false);
                        if (closeVisible) {
                            await closeBtn.click({ timeout: 2000 }).catch(() => { });
                        } else {
                            await page.mouse.click(10, 10).catch(() => { });
                        }
                        await context.waitForTimeout(600).catch(() => { });

                    } else {
                        console.warn(`[CrossSliderHelper] No popup appeared for card ${successfulCaptures + 1} — skipping.`);
                    }

                } catch (err) {
                    console.warn(`[CrossSliderHelper] Card interaction error: ${err.message}`);
                }
            }

            // ── STEP 7: Branding capture (mirrors StripSliderHelper) ───────────
            const BRANDING_SELECTORS = [
                '.feedspace-branding-footer-link',
                '.feedspace-branding',
                '[class*="branding-footer"]',
                'a:has-text("Feedspace")'
            ];
            const branding = context.locator(BRANDING_SELECTORS.join(', ')).filter({ visible: true }).first();
            if (await branding.isVisible().catch(() => false)) {
                const brandingShot = await branding.screenshot({ animations: 'disabled' }).catch(() => null);
                if (brandingShot) {
                    screenshots.push(brandingShot);
                    console.log('[CrossSliderHelper] Branding captured.');
                }
            }

        } catch (globalErr) {
            console.error(`[CrossSliderHelper] Fatal error: ${globalErr.message}`);

            // Fallback: at least one full-page screenshot so the run is not empty
            if (screenshots.length === 0 && !page.isClosed()) {
                const fallback = await page.screenshot({ fullPage: true }).catch(() => null);
                if (fallback) screenshots.push(fallback);
            }
        } finally {
            // Always restore motion
            if (styleHandle && !page.isClosed()) {
                await styleHandle.evaluate(el => el.remove()).catch(() => { });
            }
        }

        console.log(`[CrossSliderHelper] Done — ${screenshots.length} screenshot(s) captured.`);
        return screenshots;
    }
}

module.exports = CrossSliderHelper;