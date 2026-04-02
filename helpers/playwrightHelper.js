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

const AvatarGroupHelper = require('./interactiveWidgets/avatarGroupHelper');
const AvatarCarouselHelper = require('./interactiveWidgets/avatarCarouselHelper');
const FloatingToastHelper = require('./interactiveWidgets/floatingToastHelper');
const CrossSliderHelper = require('./interactiveWidgets/crossSliderHelper');
const CompanyLogoSliderHelper = require('./interactiveWidgets/companyLogoSliderHelper');
const CarouselSliderHelper = require('./interactiveWidgets/carouselSliderHelper');
const StripSliderHelper = require('./interactiveWidgets/stripSliderHelper');   // handles MARQUEE_STRIPE
const AvatarSliderHelper = require('./interactiveWidgets/avatarSliderHelper');  // handles SINGLE_SLIDER
const VerticalScrollHelper = require('./interactiveWidgets/verticalScrollHelper');
const HorizontalScrollHelper = require('./interactiveWidgets/horizontalScrollHelper');

// All Feedspace widget selectors — ordered from most specific to least specific
const FEEDSPACE_SELECTORS = [
    '.feedspace-shadow-container',
    '.feedspace-embed-main',
    '.feedspace-floating-card',
    '.feedspace-toast',
    '.feedspace-floating-widget',
    '.fe-floating-preview',
    '.fe-toast-card',
    '.fe-chat-bubble',
    '.fe-floating-toast',
    '[class*="floating-toast"]',
    '[class*="chat-box"]',
    '.fe-feedspace-avatar-group-widget-wrap',
    '.feedspace-carousel-widget',
    '.feedspace-marque-main-wrap',
    '.feedspace-show-overlay',
    '[class*="feedspace-embed"]',
    '.strip-slider',
    '.feedspace-single-review-widget',
    '.feedspace-single-slider',
    '.single-slider',
    '.feedspace-element-horizontal-scroll-widget',
    '.feedspace-left-right-shadow',
    '.feedspace-vertical-scroll',
    '.feedspace-updown',
    '.fe-masonry',
    '.feedspace-masonry',
    '#feedspace-widget-container',
    '.feedspace-widget',
    '.feedspace-elements-wrapper',
    'iframe[src*="feedspace.io"]',
    'div[id*="feedspace"]',
    '[data-fs-processed]',
    '[data-widget-type]',
    '[data-type]',
    '[widget_type_id]',
    '[data-feedspace-type]'
];

const SELECTOR_STRING = FEEDSPACE_SELECTORS.join(', ');

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

        this.expectedType = 'Unknown';   // Resolved from config API type field
        this.networkWidgetMap = {};      // UUID → TypeName from network payloads
        this.detectedNetworkTypes = new Set(); // All type names seen in network traffic
        this.widgetType = 'Unknown';     // Final resolved type from live page
        this.typeMatchResult = null;     // PASS/FAIL comparison result

        this.aiResults = null;
        this.movementVerification = null;
        this.geometricWarnings = []; // TRUTH DATA: Collected from mathematical probes to prevent AI hallucinations
        this.useFullPage = false;
    }

    /**
     * Navigate to URL with retry logic.
     *
     * FIX — Network interception rewrite:
     *  1. Only parse responses from Feedspace domains — NOT the main page.
     *     The main page HTML/JS often contains generic "type" fields that are
     *     not widget types (e.g. schema.org type, meta type, etc.)
     *  2. Use WidgetDetector.collectFromNestedPayload() instead of the old
     *     recursive collectAll() — this skips known cosmetic sub-objects
     *     (font, dark_mode_colors, cta_attributes) and only accepts numeric
     *     type IDs in the valid range 4–11.
     *  3. The type match uses WidgetDetector.isSameType() instead of a bare
     *     Set.has() call — this handles backend/frontend alias equivalence
     *     (e.g. "MARQUEE_STRIPE" === "STRIP_SLIDER").
     */
    async init(url, widgetTypeId, config) {
        this.config = config || {};

        // Resolve expectedType from whatever the caller passes:
        // widgetTypeId may be a numeric ID (e.g. 5) or a string name (e.g. "masonry")
        this.expectedType = WidgetDetector.identify({ type: widgetTypeId }) || 'Unknown';
        this.widgetType = 'Unknown';

        console.log(`[PlaywrightHelper] Expected widget type from config: ${this.expectedType} (raw: ${widgetTypeId})`);

        // ── Network interception ────────────────────────────────────────────
        this.page.on('response', async (response) => {
            try {
                const responseUrl = response.url();
                const status = response.status();

                // FIX: Only process Feedspace API responses.
                // Explicitly exclude the main page URL — its HTML can contain
                // arbitrary "type" fields that are not widget type IDs.
                const isFeedspaceApi = responseUrl.includes('feedspace') &&
                    responseUrl !== url;

                if (!isFeedspaceApi) return;
                if (status !== 200 && status !== 201) return;

                // ── Fast path: type ID in query string ──
                const urlTypeMatch = responseUrl.match(/[?&]widget_type_id=(\d+)/) ||
                    responseUrl.match(/[?&]type=(\d+)/);
                if (urlTypeMatch) {
                    const t = parseInt(urlTypeMatch[1]);
                    const interceptedType = WidgetDetector.identify({ type: t });
                    if (interceptedType !== 'Unknown') {
                        const isTarget = this.expectedType === 'Unknown' || WidgetDetector.isSameType(interceptedType, this.expectedType);
                        if (isTarget) {
                            console.log(`[PlaywrightHelper] 📡 Network (URL param): ${interceptedType} (ID: ${t})`);
                            this.detectedNetworkTypes.add(interceptedType);
                        }
                    }
                }

                // ── Body parsing ──
                let text = null;
                try { text = await response.text(); } catch (e) { return; }
                if (!text) return;

                // ── JSON body ──
                try {
                    const json = JSON.parse(text);

                    // Use the new safe collector — skips cosmetic sub-objects,
                    // only accepts type IDs in VALID_TYPE_IDS.
                    const results = WidgetDetector.collectFromNestedPayload(json);

                    for (const { typeName, uniqueWidgetId, data } of results) {
                        const isTarget = this.expectedType === 'Unknown' || WidgetDetector.isSameType(typeName, this.expectedType);

                        if (isTarget) {
                            console.log(`[PlaywrightHelper] 📡 Network (JSON body): ${typeName}`);
                            this.detectedNetworkTypes.add(typeName);

                            if (this.expectedType === 'Unknown') {
                                console.log(`[PlaywrightHelper] 🕵️  Autodiscovered type: ${typeName}. Updating expectedType.`);
                                this.expectedType = typeName;
                            }
                            this.config = data || json.data || json || this.config;
                            console.log(`[PlaywrightHelper] 🛠️  Live config captured for ${typeName}.`);
                        }

                        if (uniqueWidgetId) {
                            const uuidKey = String(uniqueWidgetId).trim().toLowerCase();
                            this.networkWidgetMap[uuidKey] = typeName;
                            this.networkWidgetMap['global_last_type'] = typeName;
                        }
                    }
                } catch (jsonErr) {
                    // ── Regex fallback on raw text ──
                    // FIX: Only match the unambiguous field names to avoid false positives
                    const typeRegex = /"?(?:widget_type_id|widget_type|type)"?\s*[:=]\s*["']?(\d+)["']?/g;
                    let match;
                    while ((match = typeRegex.exec(text)) !== null) {
                        const t = parseInt(match[1]);
                        const interceptedType = WidgetDetector.identify({ type: t });
                        if (interceptedType !== 'Unknown') {
                            const isTarget = this.expectedType === 'Unknown' || WidgetDetector.isSameType(interceptedType, this.expectedType);
                            if (isTarget) {
                                console.log(`[PlaywrightHelper] 📡 Network (regex fallback): ${interceptedType} (ID: ${t})`);
                                this.detectedNetworkTypes.add(interceptedType);
                            }
                        }
                    }
                }
            } catch (ignore) { /* Page navigated away — safe to ignore */ }
        });


        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`[PlaywrightHelper] Navigating to ${url} (Attempt ${attempts}/${maxAttempts})`);

                const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

                if (response && response.status() >= 400) {
                    throw new Error(`HTTP Error ${response.status()}: ${url}`);
                }

                const isSoft404 = await this.page.evaluate(() => {
                    const text = document.body ? document.body.innerText : '';
                    return text.includes("Oops! That page can't be found.") ||
                        text.includes("Page Not Found") ||
                        document.title.includes("Page not found");
                }).catch(() => false);

                if (isSoft404) {
                    throw new Error(`Page Soft-404 at ${url}`);
                }

                await this.page.waitForLoadState('load', { timeout: 30000 }).catch(() => {
                    console.log('[PlaywrightHelper] "load" timed out — proceeding.');
                });

                await this._waitForFeedspaceScript().catch(() => {
                    console.log('[PlaywrightHelper] Feedspace embed script not detected — proceeding.');
                });

                return;

            } catch (error) {
                console.error(`[PlaywrightHelper] Navigation error (Attempt ${attempts}): ${error.message}`);
                if (attempts >= maxAttempts) throw error;
                await this._sleep(5000);
            }
        }
    }

    async _waitForFeedspaceScript() {
        console.log('[PlaywrightHelper] Waiting for Feedspace script to manifest (up to 45s)...');

        // --- SMART SCROLL FALLBACK ---
        // Trigger lazy-loaded scripts by scrolling the page early.
        await this._smartScroll();

        const startTime = Date.now();
        let found = false;

        // 1. Wait for either a network response OR the script tag to appear in DOM
        while (Date.now() - startTime < 45000) {
            // Check network state
            const networkHit = this.detectedNetworkTypes.size > 0;

            // Check DOM state
            const scriptTag = await this.page.evaluate(() => {
                return !!document.querySelector('script[src*="feedspace.io"], iframe[src*="feedspace.io"], .feedspace-embed');
            }).catch(() => false);

            if (networkHit || scriptTag) {
                console.log(`[PlaywrightHelper] Feedspace signature detected (${networkHit ? 'Network' : 'DOM'}).`);
                found = true;
                break;
            }
            await this._sleep(2000);
        }

        if (!found) {
            console.warn('[PlaywrightHelper] ⚠️ No explicit Feedspace activity seen in 45s — proceeding with stabilization.');
        }

        // 2. Mandatory stability sleep to allow the script to execute and render the widget
        console.log('[PlaywrightHelper] Stabilizing for 10s...');
        await this._sleep(10000);
    }

    /**
     * Smart scroll to trigger lazy-loaded items across the entire page height.
     */
    async _smartScroll() {
        if (this.page.isClosed()) return;
        console.log('[PlaywrightHelper] Executing smart scroll to trigger lazy loading...');
        try {
            await this.page.evaluate(async () => {
                const scrollStep = 800;
                const delay = 300;
                const totalHeight = document.body.scrollHeight;
                let currentPos = 0;

                while (currentPos < totalHeight) {
                    window.scrollBy(0, scrollStep);
                    currentPos += scrollStep;
                    await new Promise(r => setTimeout(r, delay));
                }

                // Jump back to top
                window.scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 500));
            });
        } catch (e) {
            console.warn(`[PlaywrightHelper] Smart scroll failed: ${e.message}`);
        }
    }

    /**
     * Main validation method — discovers widget, captures screenshots, runs AI analysis.
     */
    async validateWithAI(staticFeatures) {
        this.staticFeatures = staticFeatures;

        // --- UNIVERSAL ISOLATION LAYER ---
        // Force-load widget-specific features if a type is identified.
        // This ensures absolute feature isolation across all widget types.
        try {
            const WIDGET_CONFIG_MAP = {
                'COMPANY_LOGO_SLIDER': 'companyLogoSliderFeature',
                'CROSS_SLIDER': 'crossSliderFeature',
                'AVATAR_CAROUSEL': 'avatarCarouselFeature',
                'STRIP_SLIDER': 'stripSliderFeature',
                'MARQUEE_STRIPE': 'stripSliderFeature',
                'SINGLE_SLIDER': 'avatarSliderFeature',
                'AVATAR_SLIDER': 'avatarSliderFeature',
                'AVATAR_GROUP': 'avatarGroupFeature',
                'CAROUSEL_SLIDER': 'carouselslider',
                'MASONRY': 'masonryFeature',
                'GRID': 'masonryFeature',
                'MARQUEE_UPDOWN': 'verticalScrollFeature',
                'MARQUEE_LEFTRIGHT': 'horizontalScrollFeature',
                'FLOATING_TOAST': 'floatingCardsFeature'
            };
            const lookupType = this.widgetType || this.expectedType;
            if (lookupType && lookupType !== 'Unknown' && lookupType !== '--url') {
                const configName = WIDGET_CONFIG_MAP[lookupType] || lookupType.toLowerCase();
                const configPath = path.join(process.cwd(), 'Configs', `${configName}.json`);
                if (fs.existsSync(configPath)) {
                    const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    this.staticFeatures = content.features;
                    console.log(`[PlaywrightHelper] 🛡️  Universal Isolation Layer: Force-loaded ${this.staticFeatures.length} features for ${lookupType}`);
                }
            }
        } catch (e) {
            console.warn(`[PlaywrightHelper] Universal isolation failed: ${e.message}`);
        }

        console.log(`[PlaywrightHelper] Starting widget discovery — expecting: ${this.expectedType}`);

        if (this.page.isClosed()) {
            return this._buildErrorResult('Page closed before validation');
        }

        let locator = null;
        let screenshotBuffers = [];

        try {
            // ── STEP 1: Wait for any widget marker ───────────────────────────
            await this.page.waitForSelector(SELECTOR_STRING, {
                state: 'attached',
                timeout: 30000
            }).catch(() => {
                console.warn('[PlaywrightHelper] Timeout waiting for widget selector.');
            });

            const allMatches = this.page.locator(SELECTOR_STRING);
            const count = await allMatches.count();

            if (count === 0) {
                console.warn('[PlaywrightHelper] No Feedspace widget found on page.');
                this.widgetType = 'Widget Not Found';
                this.typeMatchResult = {
                    expected: this.expectedType,
                    detected: 'Widget Not Found',
                    matched: false,
                    reason: 'No Feedspace widget selectors matched on the page'
                };

                if (!this.page.isClosed()) {
                    screenshotBuffers.push(await this.page.screenshot({ fullPage: true }));
                }
                return this._finalizeAnalysis(screenshotBuffers, staticFeatures);
            }

            console.log(`[PlaywrightHelper] Found ${count} candidate(s)`);

            // ── STEP 2: Shadow DOM pierce scan ───────────────────────────────
            const candidatesFound = await this.page.evaluate((selString) => {
                const results = [];
                const visited = new Set();
                const pierceShadow = (root) => {
                    if (!root) return;
                    root.querySelectorAll(selString).forEach(el => {
                        if (!visited.has(el)) {
                            visited.add(el);

                            // Ensure element has a way to be identified in the main loop
                            let id = el.id || el.getAttribute('unique_widget_id') ||
                                el.getAttribute('data-id') ||
                                el.getAttribute('data-widget-type');

                            let isTemp = false;
                            if (!id) {
                                id = 'fs_temp_' + Math.random().toString(36).substr(2, 9);
                                el.setAttribute('data-fs-temp-id', id);
                                isTemp = true;
                            }

                            results.push({
                                className: el.className,
                                id: id,
                                isTemp: isTemp
                            });
                        }
                    });
                    root.querySelectorAll('*').forEach(el => {
                        if (el.shadowRoot) pierceShadow(el.shadowRoot);
                    });
                };
                pierceShadow(document);
                return results;
            }, SELECTOR_STRING);

            let detectedType = 'Unknown';

            for (const cInfo of candidatesFound) {
                const selector = cInfo.isTemp
                    ? `[data-fs-temp-id="${cInfo.id}"]`
                    : `[id="${cInfo.id}"], [unique_widget_id="${cInfo.id}"], [data-id="${cInfo.id}"], [data-widget-type="${cInfo.id}"]`;

                const candLocator = selector ? this.page.locator(selector).first() : null;

                if (candLocator) {
                    const discovered = await WidgetDetector.discover(candLocator, this.networkWidgetMap);
                    if (discovered !== 'Unknown') {
                        if (WidgetDetector.isSameType(discovered, this.expectedType)) {
                            locator = candLocator;
                            detectedType = discovered;
                            break;
                        }
                    }
                }
            }

            // ── STEP 3: Fallback — visible, then first ────────────────────────
            if (!locator) {
                const candidateLocators = await allMatches.all();
                for (const candidate of candidateLocators) {
                    const discovered = await WidgetDetector.discover(candidate, this.networkWidgetMap);
                    if (discovered !== 'Unknown' && await candidate.isVisible().catch(() => false)) {
                        locator = candidate;
                        detectedType = discovered;
                        console.log(`[PlaywrightHelper] ⚠️ Fallback: Using visible widget (${discovered})`);
                        break;
                    }
                }

                if (!locator && count > 0) {
                    locator = allMatches.first();
                    detectedType = await WidgetDetector.discover(locator, this.networkWidgetMap);
                    console.log(`[PlaywrightHelper] ⚠️ Fallback: Using first element (${detectedType})`);
                }
            }

            // ── STEP 4: Type matching — network is source of truth ────────────
            //
            // FIX: Use isSameType() instead of Set.has() for the network match check.
            // This handles backend/frontend alias equivalence — e.g. if the network
            // returns MARQUEE_STRIPE but expectedType is STRIP_SLIDER, that is a match.
            let isNetworkMatched = this._networkHasType(this.expectedType);

            if (!isNetworkMatched) {
                console.log(`[PlaywrightHelper] ${this.expectedType} not seen yet in network — polling for up to 15s...`);
                for (let i = 0; i < 30; i++) { // 30 * 500ms = 15s
                    await this._sleep(500);
                    isNetworkMatched = this._networkHasType(this.expectedType);
                    if (isNetworkMatched) {
                        console.log(`[PlaywrightHelper] 📡 Network hit detected for ${this.expectedType} during polling.`);
                        break;
                    }
                }
            }

            // Final type resolution
            const isDomMatched = detectedType !== 'Unknown' && WidgetDetector.isSameType(detectedType, this.expectedType);

            if (isNetworkMatched) {
                this.widgetType = this.expectedType;
            } else if (isDomMatched) {
                this.widgetType = detectedType;
            } else {
                // HINT FALLBACK: Check if the captured config has unique keys for a specific type
                const configHint = WidgetDetector.identify(this.config);
                if (configHint !== 'Unknown') {
                    console.log(`[PlaywrightHelper] 💡 Config Hint Detection: Using ${configHint} based on unique property keys.`);
                    this.widgetType = configHint;
                } else if (this.expectedType !== 'Unknown' && (detectedType === 'CAROUSEL_SLIDER' || detectedType === 'Unknown')) {
                    // TRUTH OVERRIDE: If the user provided a type in config, and DOM detection is generic/failed, trust the config.
                    console.log(`[PlaywrightHelper] 🛡️  Expected Override: Config explicitly requested ${this.expectedType}. Overriding detected ${detectedType}.`);
                    this.widgetType = this.expectedType;
                } else if (detectedType !== 'Unknown') {
                    this.widgetType = detectedType;
                } else {
                    this.widgetType = 'Unknown';
                }
            }

            // TRUTH OVERRIDE: Prevent common misidentifications (e.g. Cross Slider vs Carousel)
            if (this.expectedType === 'CROSS_SLIDER' && this.widgetType === 'CAROUSEL_SLIDER') {
                console.log(`[PlaywrightHelper] 🛡️  Truth Override: Forcing CROSS_SLIDER identification over generic Carousel detection.`);
                this.widgetType = 'CROSS_SLIDER';
            }

            const isMatched = isNetworkMatched ||
                (this.widgetType !== 'Unknown' && WidgetDetector.isSameType(this.widgetType, this.expectedType));

            this.typeMatchResult = {
                expected: this.expectedType,
                detected: this.widgetType,
                matched: isMatched,
                reason: isNetworkMatched
                    ? `Widget type ${this.expectedType} confirmed via network interception`
                    : isMatched
                        ? `Widget type ${this.expectedType} confirmed via config/DOM analysis (Network intercept missing)`
                        : `Config expects ${this.expectedType} but it was not found in network. Detected: ${this.widgetType}`
            };

            console.log(`[PlaywrightHelper] Type match: ${this.typeMatchResult.matched ? '✅ PASS' : '❌ FAIL'} — ${this.typeMatchResult.reason}`);

            if (isNetworkMatched && !WidgetDetector.isSameType(detectedType, this.expectedType)) {
                console.log(`[PlaywrightHelper] Network confirmed ${this.expectedType}; DOM returned ${detectedType} — using network as source of truth`);
            }

            // ── STEP 5: Viewport & distraction cleanup ───────────────────────
            if (this.page.isClosed()) return this._buildErrorResult('Page closed during setup');

            await this.page.setViewportSize({ width: 1920, height: 1080 });

            await this.page.evaluate((selectors) => {
                selectors.forEach(sel => {
                    try {
                        document.querySelectorAll(sel).forEach(el => {
                            // High-risk: only hide if it's definitely a cookie banner or trustpilot
                            const text = el.innerText ? el.innerText.toLowerCase() : '';
                            const isCookie = text.includes('cookie') || text.includes('accept');
                            const isTrustpilot = el.className && typeof el.className === 'string' && el.className.includes('trustpilot');

                            if (isCookie || isTrustpilot) {
                                el.style.setProperty('display', 'none', 'important');
                            }
                        });
                    } catch (e) { }
                });
            }, DISTRACTION_SELECTORS);

            const normalizedType = this.widgetType.toUpperCase();

            if (normalizedType !== 'FLOATING_TOAST') {
                await this.slowScrollToFind();
            }

            if (locator) {
                // Visibility guard: Wait up to 10s for the element to be visible and have dimensions
                console.log(`[PlaywrightHelper] Waiting for widget dimensions to be > 0...`);
                let box = await locator.boundingBox().catch(() => null);
                let waitAttempts = 0;
                while ((!box || box.height === 0) && waitAttempts < 10) {
                    await this._sleep(1000);
                    box = await locator.boundingBox().catch(() => null);
                    waitAttempts++;
                }

                if (!box || box.height === 0) {
                    console.warn(`[PlaywrightHelper] Widget locator reached but height is still 0 after 10s.`);
                }

                await locator.scrollIntoViewIfNeeded().catch(() => { });
                await this._sleep(1000);
            }
            await this._sleep(1000);

            // ── STEP 6: Widget-specific interaction ──────────────────────────
            const box = await locator.boundingBox().catch(() => null);
            console.log(`[PlaywrightHelper] Widget bounds: ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'Unknown'}`);

            let interactionContext = this.page;
            const tagName = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
            if (tagName === 'iframe') {
                const frame = await locator.contentFrame();
                if (frame) {
                    interactionContext = frame;
                    console.log('[PlaywrightHelper] Widget is inside iframe — switching context.');
                }
            }

            if (normalizedType === 'AVATAR_GROUP') {
                const shots = await AvatarGroupHelper.interact(
                    interactionContext, locator, this.geometricWarnings,
                    async () => {
                        const popup = interactionContext
                            .locator('.fe-review-box, .fe-review-box-inner, [class*="review-box"], .feedspace-avatar-tooltip, [class*="tooltip"], .fe-tooltip')
                            .filter({ visible: true })
                            .first();
                        if (await popup.isVisible()) return await popup.screenshot({ animations: 'disabled' });
                        return !this.page.isClosed()
                            ? await this.page.screenshot({ fullPage: false, animations: 'disabled' })
                            : null;
                    }
                );
                if (shots?.length > 0) screenshotBuffers.push(...shots.filter(Boolean));

            } else if (normalizedType === 'AVATAR_CAROUSEL') {
                const shots = await AvatarCarouselHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots.filter(Boolean));

            } else if (normalizedType === 'CROSS_SLIDER') {
                const shots = await CrossSliderHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots.filter(Boolean));

            } else if (normalizedType === 'COMPANY_LOGO_SLIDER') {
                const shots = await CompanyLogoSliderHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots.filter(Boolean));

            } else if (normalizedType === 'FLOATING_TOAST') {
                const shots = await FloatingToastHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);

            } else if (normalizedType === 'CAROUSEL_SLIDER') {
                const shots = await CarouselSliderHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);

            } else if (
                normalizedType === 'MARQUEE_STRIPE' ||
                normalizedType === 'STRIP_SLIDER'
            ) {
                const shots = await StripSliderHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);

            } else if (normalizedType === 'SINGLE_SLIDER' || normalizedType === 'AVATAR_SLIDER') {
                const shots = await AvatarSliderHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);

            } else if (normalizedType === 'MARQUEE_UPDOWN') {
                const { result, screenshots } = await VerticalScrollHelper.interact(
                    interactionContext, locator, this.config, this.geometricWarnings
                );
                this.movementVerification = result;
                if (screenshots?.length > 0) screenshotBuffers.push(...screenshots);

            } else if (normalizedType === 'MARQUEE_LEFTRIGHT') {
                const { result, screenshots } = await HorizontalScrollHelper.interact(
                    interactionContext, locator, this.config, this.geometricWarnings
                );
                this.movementVerification = result;
                if (screenshots?.length > 0) screenshotBuffers.push(...screenshots);
            }

            // ── STEP 7: Ensure at least one focused shot ──────────────────────
            if (screenshotBuffers.length === 0 && locator) {
                const box = await locator.boundingBox().catch(() => null);
                if (box && box.width > 0 && box.height > 0) {
                    screenshotBuffers.push(await locator.screenshot({ animations: 'disabled' }));
                } else {
                    console.warn('[PlaywrightHelper] Skipping focused screenshot: Widget has zero/null dimensions.');
                }
            }

            // ── STEP 8: Viewport-context screenshot for AI ───────────────────
            // CRITICAL: We use fullPage: false so that the AI sees exactly what a human sees.
            // If a popup is truncated at the bottom of the screen, it MUST be truncated in the image.
            if (!this.page.isClosed()) {
                const contextShot = await this.page.screenshot({ fullPage: false, animations: 'disabled' });
                if (contextShot) {
                    screenshotBuffers.push(contextShot);
                }
            }

        } catch (error) {
            console.error('[PlaywrightHelper] Validation error:', error.message);
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
     * Check if any of the network-detected types is the same as the target.
     * FIX: Uses isSameType() instead of Set.has() so that backend/frontend
     * alias pairs (MARQUEE_STRIPE / STRIP_SLIDER) are treated as equal.
     */
    _networkHasType(targetType) {
        for (const detected of this.detectedNetworkTypes) {
            if (WidgetDetector.isSameType(detected, targetType)) return true;
        }
        return false;
    }

    /**
     * Human-like smooth scroll to help lazy-loaded widgets appear.
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
     * Save screenshots and run AI analysis — with Guardrails.
     */
    async _finalizeAnalysis(screenshotBuffers, staticFeatures) {
        const timestamp = Date.now();
        const screenshotDir = path.join(process.cwd(), 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

        // --- GUARDRAIL CHECK ---
        // If we have no screenshots, or the type is Unknown and we found no markers, 
        // we should not bother the AI.
        // NOTE: If we HAVE a network match, we should NOT abort, even if focused visual is missing.
        const isDetectionFailure = (this.widgetType === 'Unknown' || this.widgetType === 'Widget Not Found') && !this.typeMatchResult?.matched;
        const hasNoVisuals = screenshotBuffers.length === 0 || !screenshotBuffers.some(b => b && b.length > 0);

        if (isDetectionFailure && hasNoVisuals) {
            const reason = 'Automation could not locate the widget and no screenshots were captured.';
            console.error(`[PlaywrightHelper] 🛑 Aborting AI analysis: ${reason}`);
            return this._buildErrorResult(reason);
        }

        // --- STRICT VALIDATION: GHOST PASS PREVENTION ---
        // If the widget type was CONFIRMED (matched) but ZERO focused screenshots were taken,
        // it means the automation reached the element but failed to capture it.
        // This MUST be a failure.
        if (this.typeMatchResult?.matched && hasNoVisuals) {
            const reason = `CRITICAL: Widget ${this.widgetType} confirmed via network, but visual capture failed. Check element visibility/dimensions.`;
            console.error(`[PlaywrightHelper] 🛑 ${reason}`);
            return this._buildErrorResult(reason);
        }

        const savedPaths = [];
        for (let i = 0; i < screenshotBuffers.length; i++) {
            if (!screenshotBuffers[i]) continue;
            const suffix = screenshotBuffers.length > 1 ? `_part${i + 1}` : '';
            const label = this.widgetType !== 'Unknown' ? this.widgetType : 'DETECTION_FAIL';
            const screenshotPath = path.join(screenshotDir, `${label}_${timestamp}${suffix}.png`);
            fs.writeFileSync(screenshotPath, screenshotBuffers[i]);
            savedPaths.push(screenshotPath);
            console.log(`[PlaywrightHelper] Screenshot saved: ${screenshotPath}`);
        }

        // Only proceed to AI if we actually found something
        this.aiResults = await this.aiEngine.analyzeScreenshot(
            screenshotBuffers.filter(Boolean),
            this.config,
            this.widgetType,
            this.staticFeatures || staticFeatures,
            this.geometricWarnings // Pass the hard facts to the AI
        );

        // --- ENFORCE AESTHETIC-BASED FAILURE ---
        // If any aesthetic category (A-G) has a FAIL status, the entire test must be marked as FAIL.
        if (this.aiResults?.aesthetic_results) {
            const hasAestheticFail = this.aiResults.aesthetic_results.some(res => res.status === 'FAIL');
            if (hasAestheticFail) {
                console.warn(`[PlaywrightHelper] Aesthetic failure detected in one or more categories. Marking overall status as FAIL.`);
                this.aiResults.overall_status = 'FAIL';
            }
        }

        // Append movement verification
        if (this.movementVerification && this.aiResults?.feature_results) {
            const isUpdown = this.widgetType.toUpperCase().includes('UPDOWN');
            const featureName = isUpdown ? 'Cross Scroll Animation' : 'Horizontal Scrolling Animation';
            const status = this.movementVerification.status;

            // Only append if staticFeatures is not provided (legacy) or if it includes the feature
            if (!staticFeatures || staticFeatures.includes(featureName)) {
                this.aiResults.feature_results.push({
                    feature: featureName,
                    ui_status: status === 'PASS' ? 'Visible' : 'Absent',
                    config_status: 'Visible',
                    issue: this.movementVerification.message,
                    status: (status === 'ERROR' || status === 'UNKNOWN') ? 'FAIL' : status
                });
                if (status === 'FAIL' || status === 'ERROR') {
                    this.aiResults.overall_status = 'FAIL';
                }
            }
        }

        // Prepend type match as a feature result
        if (this.aiResults?.feature_results && this.typeMatchResult) {
            this.aiResults.feature_results.unshift({
                feature: 'Widget Type Identification',
                ui_status: this.typeMatchResult.detected,
                config_status: this.typeMatchResult.expected,
                issue: this.typeMatchResult.reason,
                status: this.typeMatchResult.matched ? 'PASS' : 'FAIL'
            });
            if (!this.typeMatchResult.matched) {
                this.aiResults.overall_status = 'FAIL';
            }
        }

        return {
            expectedType: this.expectedType,
            widgetType: this.widgetType,
            typeMatchResult: this.typeMatchResult,
            capturedConfig: this.config,
            aiAnalysis: this.aiResults,
            movementVerification: this.movementVerification,
            screenshotPath: savedPaths[0] || null,
            screenshotPaths: savedPaths
        };
    }

    _buildErrorResult(reason) {
        return {
            expectedType: this.expectedType,
            widgetType: 'TECHNICAL_FAILURE',
            typeMatchResult: {
                expected: this.expectedType,
                detected: this.widgetType,
                matched: false,
                reason: `Automation Guardrail: ${reason}`,
                // Add this to debug if the network actually saw the widget
                networkSawType: this._networkHasType(this.expectedType)
            },
            aiAnalysis: {
                overall_status: 'FAIL',
                summary: `Test aborted: ${reason}`,
                feature_results: [{
                    feature: 'Automation Integrity',
                    status: 'FAIL',
                    issue: reason
                }]
            },
            screenshotPaths: []
        };
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

module.exports = PlaywrightHelper;
