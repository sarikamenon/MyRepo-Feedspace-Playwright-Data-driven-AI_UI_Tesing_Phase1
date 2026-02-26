    /**
     * playwrightHelper.js
     * Feedspace Widget Playwright Automation — Corrected Version
     */

    'use strict';

    const fs = require('fs');
    const path = require('path');
    const AIEngine = require('./aiEngine');
    const ReportHelper = require('./reportHelper');
    const { WidgetDetector } = require('./widgetDetector');

    // FIX: All requires at top-level — never inside conditionals or loops
    const AvatarGroupHelper = require('./interactiveWidgets/avatarGroupHelper');
    const FloatingToastHelper = require('./interactiveWidgets/floatingToastHelper');
    const CarouselSliderHelper = require('./interactiveWidgets/carouselSliderHelper');
    const StripSliderHelper = require('./interactiveWidgets/stripSliderHelper');   // handles MARQUEE_STRIPE + SINGLE_SLIDER (same widget, frontend vs backend term)
    const VerticalScrollHelper = require('./interactiveWidgets/verticalScrollHelper');
    const HorizontalScrollHelper = require('./interactiveWidgets/horizontalScrollHelper');

    // All Feedspace widget selectors — ordered from most specific to least specific
    const FEEDSPACE_SELECTORS = [
        // Floating / Toast widgets (check first — they overlap other content)
        '.feedspace-floating-card',
        '.feedspace-toast',
        '.feedspace-floating-widget',
        '.fe-floating-preview',
        '.fe-toast-card',
        '.fe-chat-bubble',
        '.fe-floating-toast',
        '[class*="floating-toast"]',
        '[class*="chat-box"]',

        // Avatar Group
        '.fe-feedspace-avatar-group-widget-wrap',

        // Carousel
        '.feedspace-carousel-widget',
        '.testimonial-slider',
        '.carousel_slider',

        // Strip Slider / Marquee Stripe (backend=MARQUEE_STRIPE, frontend=STRIP_SLIDER — same widget)
        '.feedspace-marque-main-wrap',
        '.feedspace-show-overlay',
        '[class*="feedspace-embed"]',
        '.strip-slider',

        // Horizontal / Vertical Marquee
        '.feedspace-element-horizontal-scroll-widget',
        '.feedspace-left-right-shadow',
        '.feedspace-vertical-scroll',
        '.feedspace-updown',

        // Single Slider
        '.feedspace-single-review-widget',
        '.feedspace-single-slider',

        // Masonry
        '.fe-masonry',
        '.feedspace-masonry',

        // Generic containers
        '#feedspace-widget-container',
        '.feedspace-widget',
        '.feedspace-elements-wrapper',
        'iframe[src*="feedspace.io"]',
        'div[id*="feedspace"]',

        // Data attribute selectors (lowest priority — most generic)
        '[data-widget-type]',
        '[data-type]',
        '[widget_type_id]',
        '[data-feedspace-type]'
    ];

    const SELECTOR_STRING = FEEDSPACE_SELECTORS.join(', ');

    // Elements to hide during screenshots (distractions)
    const DISTRACTION_SELECTORS = [
        '.trustpilot-widget',
        '[id*="trustpilot"]',
        '.chat-bubble',
        '.iubenda-cs-container',
        '#iubenda-cs-banner',
        '[id*="cookie"]',
        '[class*="cookie"]',
        '.popup-overlay',
        '.modal-backdrop',
        '.virtual-tour'
    ];

    class PlaywrightHelper {
        constructor(page) {
            this.page = page;
            this.aiEngine = new AIEngine();
            this.reportHelper = new ReportHelper();
            this.config = null;

            // FIX: Separate expected (from config API) vs detected (from live page)
            this.expectedType = 'Unknown';   // What the API config says it should be
            this.widgetType = 'Unknown';     // What is actually found on the page
            this.typeMatchResult = null;     // PASS/FAIL comparison between the two

            this.aiResults = null;
            this.movementVerification = null;
            this.useFullPage = false;
        }

        /**
         * Navigate to URL with retry logic.
         * FIX: expectedType set here, widgetType stays 'Unknown' until discovery.
         */
        async init(url, widgetTypeId, config) {
            this.config = config || {};

            // FIX: Store what config SAYS the widget should be — separately from what we discover
            this.expectedType = WidgetDetector.identify({ type: widgetTypeId }) || 'Unknown';
            this.widgetType = 'Unknown'; // will be updated after discover() runs on the real page

            console.log(`[PlaywrightHelper] Expected widget type from config: ${this.expectedType} (ID: ${widgetTypeId})`);

            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    console.log(`[PlaywrightHelper] Navigating to ${url} (Attempt ${attempts}/${maxAttempts})`);

                    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

                    await this.page.waitForLoadState('load', { timeout: 30000 }).catch(() => {
                        console.log('[PlaywrightHelper] "load" event timed out — proceeding.');
                    });

                    // Wait extra for JS-injected widgets (Feedspace injects via embed.js)
                    await this._waitForFeedspaceScript().catch(() => {
                        console.log('[PlaywrightHelper] Feedspace embed script not detected in time — proceeding.');
                    });

                    return; // success

                } catch (error) {
                    console.error(`[PlaywrightHelper] Navigation Error (Attempt ${attempts}): ${error.message}`);
                    if (attempts >= maxAttempts) throw error;
                    await this._sleep(5000);
                }
            }
        }

        /**
         * Wait for Feedspace embed script to load and execute.
         * Fixes JS-injected widget detection issue.
         */
        async _waitForFeedspaceScript() {
            // Wait for the embed script response
            await this.page.waitForResponse(
                response => response.url().includes('feedspace.io') && response.status() === 200,
                { timeout: 15000 }
            );
            // Give JS a moment to render the widget into DOM
            await this._sleep(2000);
        }

        /**
         * Main validation method — discovers widget, captures screenshots, runs AI analysis.
         */
        async validateWithAI(staticFeatures) {
            console.log(`[PlaywrightHelper] Starting widget discovery — expecting: ${this.expectedType}`);

            // FIX: Guard page closed before any DOM interaction
            if (this.page.isClosed()) {
                console.error('[PlaywrightHelper] Page is closed — cannot validate.');
                return this._buildErrorResult('Page closed before validation');
            }

            let locator = null;
            let screenshotBuffers = [];

            try {
                // ── STEP 1: Wait for any widget marker to appear ─────────────────
                await this.page.waitForSelector(SELECTOR_STRING, {
                    state: 'attached',
                    timeout: 30000
                }).catch(() => {
                    console.warn('[PlaywrightHelper] Timeout waiting for widget — widget may not be on this page.');
                });

                const allMatches = this.page.locator(SELECTOR_STRING);
                const count = await allMatches.count();

                if (count === 0) {
                    console.warn('[PlaywrightHelper] No Feedspace widget found on page.');
                    this.widgetType = 'Widget Not Found';

                    // FIX: Record type mismatch explicitly
                    this.typeMatchResult = {
                        expected: this.expectedType,
                        detected: 'Widget Not Found',
                        matched: false,
                        reason: 'No Feedspace widget selectors found on the page — widget may not be embedded or is loaded in an iframe'
                    };

                    // FIX: Guard page closed before screenshot
                    if (!this.page.isClosed()) {
                        screenshotBuffers.push(await this.page.screenshot({ fullPage: true }));
                    }

                    return this._finalizeAnalysis(screenshotBuffers, staticFeatures);
                }

                console.log(`[PlaywrightHelper] Found ${count} candidate(s) — scanning for type: ${this.expectedType}`);

                // ── STEP 2: Precision scan — find element matching expected type ──
                const candidates = await allMatches.all();
                let detectedType = 'Unknown';

                for (const candidate of candidates) {
                    const discovered = await WidgetDetector.discover(candidate);
                    console.log(`[PlaywrightHelper] Candidate discovered as: ${discovered}`);

                    // FIX: Use isSameType() to handle backend/frontend alias equivalence
                    if (WidgetDetector.isSameType(discovered, this.expectedType)) {
                        locator = candidate;
                        detectedType = discovered;
                        console.log(`[PlaywrightHelper] ✅ PRECISION MATCH: ${discovered} matches expected ${this.expectedType}`);
                        break;
                    }
                }

                // ── STEP 3: Fallback — first visible, then first attached ─────────
                if (!locator) {
                    console.log(`[PlaywrightHelper] No precise match for ${this.expectedType} — falling back...`);

                    for (const candidate of candidates) {
                        const discovered = await WidgetDetector.discover(candidate);
                        if (await candidate.isVisible().catch(() => false)) {
                            locator = candidate;
                            detectedType = discovered;
                            console.log(`[PlaywrightHelper] ⚠️ Fallback: Using first visible widget (${discovered})`);
                            break;
                        }
                    }

                    if (!locator) {
                        locator = allMatches.first();
                        detectedType = await WidgetDetector.discover(locator);
                        console.log(`[PlaywrightHelper] ⚠️ Fallback: Using first attached widget (${detectedType})`);
                    }
                }

                // FIX: Now update widgetType from actual page discovery
                this.widgetType = detectedType !== 'Unknown' ? detectedType : this.expectedType;

                // FIX: Record explicit PASS/FAIL for type match — goes into report
                this.typeMatchResult = {
                    expected: this.expectedType,
                    detected: detectedType,
                    matched: WidgetDetector.isSameType(detectedType, this.expectedType),
                    reason: WidgetDetector.isSameType(detectedType, this.expectedType)
                        ? 'Widget type on page matches config'
                        : `Config says ${this.expectedType} but page has ${detectedType}`
                };

                console.log(`[PlaywrightHelper] Type match result: ${this.typeMatchResult.matched ? '✅ PASS' : '❌ FAIL'} — ${this.typeMatchResult.reason}`);

                // ── STEP 4: Prepare viewport & hide distractions ──────────────────
                // FIX: Guard page closed
                if (this.page.isClosed()) return this._buildErrorResult('Page closed during setup');

                await this.page.setViewportSize({ width: 1920, height: 1080 });

                await this.page.evaluate((selectors) => {
                    selectors.forEach(sel => {
                        try {
                            document.querySelectorAll(sel).forEach(el => {
                                const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
                                // Never hide Feedspace elements themselves
                                if (!cls.includes('fe-') && !cls.includes('feedspace')) {
                                    el.style.setProperty('display', 'none', 'important');
                                }
                            });
                        } catch (e) { /* ignore per-element errors */ }
                    });
                }, DISTRACTION_SELECTORS);

                // ── STEP 5: Scroll to widget ──────────────────────────────────────
                const normalizedType = this.widgetType.toUpperCase();

                if (normalizedType !== 'FLOATING_TOAST') {
                    await this.slowScrollToFind();
                }

                await locator.scrollIntoViewIfNeeded().catch(() => { });
                await this._sleep(1000);

                // ── STEP 6: Widget-specific interaction & screenshot capture ───────
                const box = await locator.boundingBox().catch(() => null);
                console.log(`[PlaywrightHelper] Widget bounds: ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'Unknown'}`);

                // Resolve iframe context if needed
                let interactionContext = this.page;
                const tagName = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
                if (tagName === 'iframe') {
                    const frame = await locator.contentFrame();
                    if (frame) {
                        interactionContext = frame;
                        console.log('[PlaywrightHelper] Widget is inside iframe — switching context.');
                    }
                }

                // Dispatch to correct interaction helper
                // NOTE: MARQUEE_STRIPE (backend) === STRIP_SLIDER (frontend) — both use StripSliderHelper
                if (normalizedType === 'AVATAR_GROUP') {
                    const interactiveShots = await AvatarGroupHelper.interact(
                        interactionContext, locator,
                        async () => {
                            const popup = interactionContext
                                .locator('.fe-review-box, .fe-review-box-inner, [class*="review-box"]')
                                .filter({ visible: true })
                                .first();
                            if (await popup.isVisible()) return await popup.screenshot({ animations: 'disabled' });
                            return !this.page.isClosed()
                                ? await this.page.screenshot({ fullPage: false, animations: 'disabled' })
                                : null;
                        }
                    );
                    if (interactiveShots?.length > 0) screenshotBuffers.push(...interactiveShots.filter(Boolean));

                } else if (normalizedType === 'FLOATING_TOAST') {
                    const interactiveShots = await FloatingToastHelper.interact(interactionContext, locator);
                    if (interactiveShots?.length > 0) screenshotBuffers.push(...interactiveShots);

                } else if (normalizedType === 'CAROUSEL_SLIDER') {
                    const interactiveShots = await CarouselSliderHelper.interact(interactionContext, locator);
                    if (interactiveShots?.length > 0) screenshotBuffers.push(...interactiveShots);

                } else if (
                    normalizedType === 'MARQUEE_STRIPE' ||   // backend term
                    normalizedType === 'STRIP_SLIDER' ||     // frontend alias
                    normalizedType === 'SINGLE_SLIDER'       // adjacent type — same helper
                ) {
                    const interactiveShots = await StripSliderHelper.interact(interactionContext, locator);
                    if (interactiveShots?.length > 0) screenshotBuffers.push(...interactiveShots);

                } else if (normalizedType === 'MARQUEE_UPDOWN') {
                    const { result, screenshots } = await VerticalScrollHelper.interact(
                        interactionContext, locator, this.config
                    );
                    this.movementVerification = result;
                    if (screenshots?.length > 0) screenshotBuffers.push(...screenshots);

                } else if (normalizedType === 'MARQUEE_LEFTRIGHT') {
                    const { result, screenshots } = await HorizontalScrollHelper.interact(
                        interactionContext, locator, this.config
                    );
                    this.movementVerification = result;
                    if (screenshots?.length > 0) screenshotBuffers.push(...screenshots);
                }

                // ── STEP 7: Ensure at least one focused shot ──────────────────────
                if (screenshotBuffers.length === 0) {
                    screenshotBuffers.push(await locator.screenshot({ animations: 'disabled' }));
                }

                // ── STEP 8: Full page context screenshot for AI ───────────────────
                // FIX: Guard page closed before final screenshot
                if (!this.page.isClosed()) {
                    console.log('[PlaywrightHelper] Capturing full page context for AI...');
                    screenshotBuffers.push(
                        await this.page.screenshot({ fullPage: true, animations: 'disabled' })
                    );
                }

            } catch (error) {
                console.error('[PlaywrightHelper] Validation error:', error.message);

                // FIX: Guard page closed before fallback screenshot
                if (screenshotBuffers.length === 0 && !this.page.isClosed()) {
                    try {
                        screenshotBuffers.push(await this.page.screenshot({ fullPage: true }));
                    } catch (ssError) {
                        console.error('[PlaywrightHelper] Fallback screenshot failed:', ssError.message);
                    }
                }
            }

            return this._finalizeAnalysis(screenshotBuffers, staticFeatures);
        }

        /**
         * Human-like smooth scroll to help lazy-loaded widgets appear.
         * FIX: page.isClosed() guard at start.
         */
        async slowScrollToFind() {
            if (this.page.isClosed()) return;
            console.log('[PlaywrightHelper] Smooth scrolling to find widget...');
            try {
                await this.page.evaluate(async () => {
                    const height = document.body.scrollHeight;
                    const steps = 20;
                    for (let i = 0; i <= steps; i++) {
                        window.scrollTo({ top: i * (height / steps), behavior: 'smooth' });
                        await new Promise(r => setTimeout(r, 100));
                    }
                    await new Promise(r => setTimeout(r, 1000));
                });
            } catch (e) {
                console.warn('[PlaywrightHelper] Scroll failed:', e.message);
            }
        }

        /**
         * Save screenshots and run AI analysis.
         * FIX: typeMatchResult is now included in the final output.
         */
        async _finalizeAnalysis(screenshotBuffers, staticFeatures) {
            const timestamp = Date.now();
            const screenshotDir = path.join(process.cwd(), 'screenshots');
            if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

            const savedPaths = [];

            for (let i = 0; i < screenshotBuffers.length; i++) {
                if (!screenshotBuffers[i]) continue; // skip null buffers

                const suffix = screenshotBuffers.length > 1 ? `_part${i + 1}` : '';
                // FIX: Use expectedType in filename so it's always meaningful, even if discovery failed
                const label = this.widgetType !== 'Unknown' ? this.widgetType : this.expectedType;
                const screenshotPath = path.join(screenshotDir, `${label}_${timestamp}${suffix}.png`);

                fs.writeFileSync(screenshotPath, screenshotBuffers[i]);
                savedPaths.push(screenshotPath);
                console.log(`[PlaywrightHelper] Screenshot saved: ${screenshotPath}`);
            }

            this.aiResults = await this.aiEngine.analyzeScreenshot(
                screenshotBuffers.filter(Boolean),
                this.config,
                this.widgetType,
                staticFeatures
            );

            // Append movement verification result to AI feature results
            if (this.movementVerification && this.aiResults?.feature_results) {
                const isUpdown = this.widgetType.toUpperCase().includes('UPDOWN');
                const featureName = isUpdown ? 'Cross Scroll Animation' : 'Horizontal Scrolling Animation';
                const status = this.movementVerification.status; // PASS | FAIL | ERROR | UNKNOWN

                this.aiResults.feature_results.push({
                    feature: featureName,
                    ui_status: status === 'PASS' ? 'Visible' : 'Absent',
                    config_status: 'Visible',
                    scenario: this.movementVerification.message,
                    status: (status === 'ERROR' || status === 'UNKNOWN') ? 'FAIL' : status
                });

                if (status === 'FAIL' || status === 'ERROR') {
                    this.aiResults.overall_status = 'FAIL';
                }
            }

            // FIX: Append type match result as a feature — now visible in report
            if (this.aiResults?.feature_results && this.typeMatchResult) {
                this.aiResults.feature_results.unshift({
                    feature: 'Widget Type Identification',
                    ui_status: this.typeMatchResult.detected,
                    config_status: this.typeMatchResult.expected,
                    scenario: this.typeMatchResult.reason,
                    status: this.typeMatchResult.matched ? 'PASS' : 'FAIL'
                });

                if (!this.typeMatchResult.matched) {
                    this.aiResults.overall_status = 'FAIL';
                }
            }

            return {
                expectedType: this.expectedType,          // from config API
                widgetType: this.widgetType,              // from live page discovery
                typeMatchResult: this.typeMatchResult,    // PASS/FAIL comparison
                capturedConfig: this.config,
                aiAnalysis: this.aiResults,
                movementVerification: this.movementVerification,
                screenshotPath: savedPaths[0] || null,
                screenshotPaths: savedPaths
            };
        }

        /**
         * Build a standardised error result when early exit is needed.
         */
        _buildErrorResult(reason) {
            return {
                expectedType: this.expectedType,
                widgetType: 'Error',
                typeMatchResult: {
                    expected: this.expectedType,
                    detected: 'Error',
                    matched: false,
                    reason
                },
                capturedConfig: this.config,
                aiAnalysis: null,
                movementVerification: null,
                screenshotPath: null,
                screenshotPaths: []
            };
        }

        _sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }
    }

    module.exports = PlaywrightHelper;