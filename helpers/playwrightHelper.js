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
const MasonryHelper = require('./interactiveWidgets/masonryHelper');
const AvatarBlockHelper = require('./interactiveWidgets/avatarBlockHelper');

const MAX_SCREENSHOT_HEIGHT = 10000;


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
    '.feedspace-embed',
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
    // Narrowed attributes to prevent collisions with page builders
    '[widget_type_id]',
    '[data-feedspace-type]',
    '[unique_widget_id]',
    '[data-widget-type*="feedspace"]',
    '[id*="feedspace-widget"]'
];

const SELECTOR_STRING = FEEDSPACE_SELECTORS.join(', ');

const DISTRACTION_SELECTORS = [
    '.trustpilot-widget',
    '[id*="trustpilot"]',
    '.chat-bubble',
    '.wa__btn_popup',
    '.wa__popup_chat_box',
    '#recent_admissions',
    '.iubenda-cs-container',
    '#iubenda-cs-banner',
    '[id*="cookie"]',
    '[class*="cookie"]',
    '.popup-overlay',
    '.modal-backdrop',
    '.virtual-tour'
];

class PlaywrightHelper {
    static isBlockedUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return false;
        try {
            let normalized = urlStr.trim().toLowerCase();
            if (!/^https?:\/\//i.test(normalized)) {
                normalized = 'https://' + normalized;
            }
            const url = new URL(normalized);
            const hostname = url.hostname;
            const pathname = url.pathname;

            // 1. Wix sandboxed iframe filesusr.com
            if (hostname.includes('filesusr.com') || hostname.includes('fileusr.com')) {
                return true;
            }

            // 2. Local & Private environments
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
                return true;
            }

            // 3. Subdomains check
            if (
                hostname.startsWith('preview.') || hostname.includes('.preview.') ||
                hostname.startsWith('editor.') || hostname.includes('.editor.') ||
                hostname.startsWith('sitebuilder.') || hostname.includes('.sitebuilder.') ||
                hostname.startsWith('config.') || hostname.includes('.config.') ||
                hostname.startsWith('admin.') || hostname.includes('.admin.')
            ) {
                return true;
            }

            // 4. Path segments check (exact segment boundaries)
            const pathSegments = pathname.split('/');
            const blockedPathSegments = [
                'preview', 'editor', 'design', 'builder', 'admin',
                'wp-admin', 'config', 'login', 'signin', 'checkout', 'cart'
            ];

            if (pathSegments.some(segment => blockedPathSegments.includes(segment))) {
                return true;
            }

            // Other path-based checks (like wp-admin.php or sitebuilder filenames)
            if (pathname.includes('wp-admin') || pathname.includes('sitebuilder')) {
                return true;
            }

        } catch (e) {
            // Fallback substring checks with word boundary regexes
            const lowerUrl = urlStr.toLowerCase();
            if (lowerUrl.includes('filesusr.com') || lowerUrl.includes('fileusr.com')) return true;
            if (lowerUrl.includes('localhost') || lowerUrl.includes('127.0.0.1') || lowerUrl.includes('0.0.0.0')) return true;

            const blockedKeywords = [
                'preview', 'editor', 'design', 'builder', 'sitebuilder',
                'admin', 'wp-admin', 'config', 'login', 'signin', 'checkout', 'cart'
            ];
            for (const keyword of blockedKeywords) {
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (regex.test(lowerUrl)) return true;
            }
        }
        return false;
    }

    static async checkReachability(url, maxAttempts = 3, targetWidgetId = null) {
        if (PlaywrightHelper.isBlockedUrl(url)) {
            return {
                status: 'BLOCKED_URL',
                error_code: 'BLOCKED_BY_FILTER',
                message: 'The URL matches a blocked pattern (preview, editor, admin, config, local environment, or Wix sandbox iframe).'
            };
        }

        const axios = require('axios');
        const https = require('https');

        let attempts = 0;
        let lastError = null;

        // Extract widget ID from URL ONLY if the URL belongs to feedspace domain
        let widgetId = targetWidgetId;
        if (!widgetId && url.includes('feedspace.io')) {
            const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
            if (uuidMatch) {
                widgetId = uuidMatch[0];
            }
        }

        while (attempts < maxAttempts) {
            attempts++;
            try {
                const response = await axios.get(url, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                    },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    validateStatus: (status) => true
                });

                const status = response.status;
                if (status === 404) {
                    return {
                        status: 'NOT_FOUND',
                        error_code: 'HTTP_404',
                        message: 'Page not found (404)'
                    };
                }
                if (status === 401 || status === 403) {
                    return {
                        status: 'ACCESS_DENIED',
                        error_code: status === 401 ? 'HTTP_401' : 'HTTP_403',
                        message: status === 401 ? 'Access denied (401)' : 'Access denied (403)'
                    };
                }
                if (status >= 500) {
                    lastError = {
                        status: 'UNREACHABLE',
                        error_code: `HTTP_${status}`,
                        message: `Server returned an error (${status})`
                    };
                } else {
                    // REACHABLE: Check if the widget is empty before returning REACHABLE
                    const html = response.data || '';
                    if (!widgetId && typeof html === 'string') {
                        const dataIdMatch = html.match(/class=["']?[^"'>]*feedspace[^"'>]*["']?[^>]*data-id=["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/i) ||
                            html.match(/data-id=["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/i) ||
                            html.match(/unique_widget_id=["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/i);
                        if (dataIdMatch) {
                            widgetId = dataIdMatch[1];
                        } else {
                            const idx = html.toLowerCase().indexOf('feedspace');
                            if (idx !== -1) {
                                const context = html.substring(Math.max(0, idx - 100), Math.min(html.length, idx + 300));
                                const uuidMatch = context.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
                                if (uuidMatch) {
                                    widgetId = uuidMatch[0];
                                }
                            }
                        }
                    }

                    if (widgetId) {
                        try {
                            const configRes = await axios.get(`https://api.feedspace.io/v3/embed/${widgetId}`, {
                                timeout: 5000,
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                                },
                                httpsAgent: new https.Agent({ rejectUnauthorized: false })
                            });

                            const configData = configRes.data?.data || configRes.data;
                            if (configData) {
                                const widgetData = configData.widget_data;
                                const hasZeroFeeds = !widgetData ||
                                    (typeof widgetData === 'object' && Object.keys(widgetData).length === 0) ||
                                    (Array.isArray(widgetData.feeds) && widgetData.feeds.length === 0) ||
                                    (Array.isArray(widgetData.feeds_data) && widgetData.feeds_data.length === 0);

                                if (hasZeroFeeds) {
                                    return {
                                        status: 'EMPTY_WIDGET',
                                        error_code: 'EMPTY_WIDGET',
                                        message: 'The Feedspace widget contains zero active feeds/reviews'
                                    };
                                }
                            }
                        } catch (configError) {
                            console.warn(`[Prevalidation] Failed to fetch config for widget ID ${widgetId}: ${configError.message}`);
                        }
                    }

                    return {
                        status: 'REACHABLE',
                        error_code: null,
                        message: null
                    };
                }
            } catch (error) {
                let status = 'UNREACHABLE';
                let error_code = 'CONNECTION_ERROR';
                let message = `CONNECTION_ERROR: ${error.message}`;

                const code = error.code || '';
                const msg = (error.message || '').toLowerCase();

                if (code === 'ENOTFOUND' || msg.includes('getaddrinfo')) {
                    error_code = 'DNS_RESOLUTION_FAILED';
                    message = 'Website address could not be resolved';
                } else if (code === 'ECONNREFUSED') {
                    error_code = 'CONNECTION_REFUSED';
                    message = 'Connection refused by website';
                } else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || msg.includes('timeout')) {
                    error_code = 'REQUEST_TIMEOUT';
                    message = 'Website response timed out';
                } else if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate') || msg.includes('proto')) {
                    error_code = 'SSL_ERROR';
                    message = 'SSL/Secure connection error';
                }

                lastError = { status, error_code, message };
            }

            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        return lastError || {
            status: 'UNREACHABLE',
            error_code: 'CONNECTION_ERROR',
            message: 'Connection failed or website is down'
        };
    }

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
    async init(url, widgetTypeId, config, widgetUUID = null) {
        this.config = config || {};
        this.widgetUUID = widgetUUID || this.config.unique_widget_id || this.config.widgetId || this.config.id || null;

        // Resolve expectedType from whatever the caller passes:
        // widgetTypeId may be a numeric ID (e.g. 5) or a string name (e.g. "masonry")
        this.expectedType = WidgetDetector.identify({ type: widgetTypeId }) || 'Unknown';
        this.widgetType = 'Unknown';
        this.feedspaceActivitySeen = false;

        console.log(`[PlaywrightHelper] Expected widget type from config: ${this.expectedType} (raw: ${widgetTypeId})`);

        // ── Network interception ────────────────────────────────────────────
        this.page.on('response', async (response) => {
            try {
                // 1. Status & Resource Filtering (Fastest exits)
                const status = response.status();
                if (status !== 200 && status !== 201) return;

                const resourceType = response.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) return;

                // 2. URL & Content Context
                const responseUrl = response.url();
                if (!responseUrl.includes('feedspace')) return;

                const contentType = (response.headers()['content-type'] || '').toLowerCase();
                if (contentType.includes('text/html') || contentType.includes('image/') || contentType.includes('font/')) return;

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
                            // ── DEEP MERGE CONFIG ──
                            // Prevent loss of customization data (fonts, colors) when a 'data-only' 
                            // response arrives later in the stream.
                            const newData = data || json.data || json;
                            if (newData && typeof newData === 'object') {
                                if (!this.config || typeof this.config !== 'object') {
                                    this.config = newData;
                                } else {
                                    // Non-destructive merge of top-level keys
                                    this.config = {
                                        ...this.config,
                                        ...newData,
                                        widget_customization: {
                                            ...(this.config.widget_customization || {}),
                                            ...(newData.widget_customization || {})
                                        },
                                        widget_data: {
                                            ...(this.config.widget_data || {}),
                                            ...(newData.widget_data || {})
                                        }
                                    };
                                }
                            }
                            console.log(`[PlaywrightHelper] 🛠️  Live config captured/merged for ${typeName}.`);
                        }

                        if (uniqueWidgetId) {
                            const uuidKey = String(uniqueWidgetId).trim().toLowerCase();
                            this.networkWidgetMap[uuidKey] = typeName;
                            this.networkWidgetMap['global_last_type'] = typeName;
                        }
                    }
                } catch (jsonErr) {
                    // SILENT GUARD: If JSON parsing fails, we fall back to regex.
                    // No console.warn here to prevent noise for non-standard payloads.

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
                    const status = response.status();
                    let friendlyMsg = `The requested page is currently unavailable (${status} Error).`;
                    if (status === 404) friendlyMsg = `The requested page could not be found (404 Error).`;
                    if (status === 401 || status === 403) friendlyMsg = `Access denied or authorization required to view this page (${status} Error).`;
                    if (status >= 500) friendlyMsg = `The server for this page is currently experiencing issues (${status} Error).`;
                    throw new Error(friendlyMsg);
                }

                const isSoft404 = await this.page.evaluate(() => {
                    const text = document.body ? document.body.innerText : '';
                    return text.includes("Oops! That page can't be found.") ||
                        text.includes("Page Not Found") ||
                        (text.includes("404") && text.toLowerCase().includes("not found")) ||
                        document.title.includes("Page not found") ||
                        document.title.includes("404 Not Found") ||
                        document.title.startsWith("404 -");
                }).catch(() => false);

                if (isSoft404) {
                    throw new Error(`The page reached appears to be a "Not Found" landing page.`);
                }

                await this.page.waitForLoadState('load', { timeout: 30000 }).catch(() => {
                    console.log('[PlaywrightHelper] "load" timed out — proceeding.');
                });

                await this._waitForFeedspaceScript().catch(() => {
                    console.log('[PlaywrightHelper] Feedspace embed script not detected — proceeding.');
                });

                // ── MODAL CRUSHER ──
                // Dismiss common blocking popups (cookies, newsletters, etc.)
                await this._dismissModals();

                return;

            } catch (error) {
                const msg = error.message || '';
                if (msg.includes('net::ERR_NAME_NOT_RESOLVED')) {
                    console.error(`[PlaywrightHelper] 🛑 DNS Failure: The domain could not be resolved. URL is likely invalid or private.`);
                    throw new Error('CONNECTIVITY_DNS_FAILURE: The domain name used in the URL could not be resolved. Please verify the URL or ensure the site is public.');
                }
                if (msg.includes('net::ERR_CONNECTION_TIMED_OUT')) {
                    console.error(`[PlaywrightHelper] 🛑 Connection Timeout: The server took too long to respond.`);
                    throw new Error('CONNECTIVITY_TIMEOUT: The server did not respond in time. The site might be down or blocked by a firewall.');
                }

                console.error(`[PlaywrightHelper] Navigation error (Attempt ${attempts}): ${error.message}`);
                if (attempts >= maxAttempts) throw error;
                await this._sleep(5000);
            }
        }
    }

    async _waitForFeedspaceScript() {
        console.log('[PlaywrightHelper] Waiting for Feedspace script to manifest (up to 45s)...');

        // 1. Programmatically trigger interaction events to bypass lazy-loaders (e.g. WP Rocket)
        await this.page.evaluate(() => {
            try {
                const triggerEvents = ['scroll', 'mousemove', 'mousedown', 'keydown', 'touchstart'];
                triggerEvents.forEach(evtType => {
                    window.dispatchEvent(new Event(evtType));
                    document.dispatchEvent(new Event(evtType));
                });
            } catch (e) { }
        }).catch(() => { });

        // 2. Playwright-native interaction fallback
        try {
            await this.page.mouse.move(200, 200);
            await this.page.mouse.wheel(0, 100);
            await this.page.mouse.wheel(0, -100);
        } catch (e) { }

        // --- SMART SCROLL FALLBACK ---
        // Trigger lazy-loaded scripts by scrolling the page early.
        await this._smartScroll();

        let count = 0;
        // 3. Find any candidate container and scroll to it to trigger IntersectionObserver sentinel
        try {
            const candidates = this.page.locator(SELECTOR_STRING);
            count = await candidates.count();
            console.log(`[PlaywrightHelper] Pre-scroll check: Found ${count} candidate containers for script triggering.`);
            for (let i = 0; i < count; i++) {
                const candidate = candidates.nth(i);
                if (await candidate.isVisible().catch(() => false)) {
                    console.log(`[PlaywrightHelper] Scrolling candidate ${i + 1}/${count} into view...`);
                    await candidate.scrollIntoViewIfNeeded().catch(() => { });
                    await this._sleep(1000); // Give it a moment to trigger Sentinel loading
                }
            }
        } catch (e) {
            console.warn(`[PlaywrightHelper] Pre-scrolling candidates failed: ${e.message}`);
        }

        const startTime = Date.now();
        let found = false;

        // Reduce wait time if no candidate selectors are present at all
        const maxWaitTime = count > 0 ? 45000 : 5000;

        // 4. Wait for either a network response OR the script tag / initialized widget to appear in DOM
        while (Date.now() - startTime < maxWaitTime) {
            // Check network state
            const networkHit = this.detectedNetworkTypes.size > 0;

            // Check DOM state - must be actual script or an initialized widget container (having shadowRoot or children)
            const scriptTag = await this.page.evaluate(() => {
                const hasScript = !!document.querySelector('script[src*="feedspace.io"], iframe[src*="feedspace.io"]');
                const hasInitializedWidget = Array.from(document.querySelectorAll('.feedspace-embed, [class*="feedspace-embed"]')).some(el => {
                    return el.shadowRoot || el.children.length > 0 || el.getAttribute('data-fs-processed') === 'true' || el.getAttribute('data-status') === 'ready';
                });
                return hasScript || hasInitializedWidget;
            }).catch(() => false);

            if (networkHit || scriptTag) {
                console.log(`[PlaywrightHelper] Feedspace signature detected (${networkHit ? 'Network' : 'DOM'}).`);
                found = true;
                this.feedspaceActivitySeen = true;
                break;
            }
            await this._sleep(2000);
        }

        if (!found) {
            console.warn('[PlaywrightHelper] ⚠️ No explicit Feedspace activity seen in 45s — proceeding with stabilization.');
        }

        // 5. Mandatory stability sleep to allow the script to execute and render the widget
        console.log('[PlaywrightHelper] Stabilizing for 10s...');
        await this._sleep(10000);
    }

    /**
     * Dismiss common blocking modals (CHIUDI, Accept, Close, etc.)
     */
    async _dismissModals() {
        console.log('[PlaywrightHelper] 🛠️  Modal Crusher: Checking for blocking popups...');
        try {
            await this.page.evaluate(() => {
                const closePatterns = [
                    'chiudi', 'close', 'accept', 'acconsento', 'agree', 'ok', 'understand', 'got it', 'dismiss', 'ho capito'
                ];

                // Search for buttons or elements that look like close/accept buttons
                const elements = Array.from(document.querySelectorAll('button, a, span, div, i'));
                let clicked = 0;

                for (const el of elements) {
                    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                    const isMatch = closePatterns.includes(text) ||
                        (text === 'x' && el.offsetWidth < 50) ||
                        (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('close'));

                    if (isMatch) {
                        const style = window.getComputedStyle(el);
                        const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0 &&
                            style.display !== 'none' && style.visibility !== 'hidden' &&
                            style.opacity !== '0';

                        if (isVisible) {
                            el.click();
                            clicked++;
                        }
                    }
                }
                return clicked;
            }).then(count => {
                if (count > 0) console.log(`[PlaywrightHelper] 🛡️  Modal Crusher: Dismissed ${count} potential popup(s).`);
            });
            await this._sleep(2000); // Wait for modal to disappear
        } catch (e) {
            console.warn(`[PlaywrightHelper] ⚠️ Modal Crusher failed: ${e.message}`);
        }
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
                let currentPos = 0;

                while (currentPos < document.body.scrollHeight) {
                    window.scrollBy(0, scrollStep);
                    currentPos += scrollStep;
                    await new Promise(r => setTimeout(r, delay));

                    // Safety guard to prevent infinite scroll loops on infinite scroll pages
                    if (currentPos > 25000) break;
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


        console.log(`[PlaywrightHelper] Starting widget discovery — expecting: ${this.expectedType}`);

        if (this.page.isClosed()) {
            return this._buildErrorResult('Page closed before validation');
        }

        let locator = null;
        let screenshotBuffers = [];

        try {
            // ── STEP 1: Wait for any widget marker ───────────────────────────
            let locatorFrame = this.page;

            // If no Feedspace activity was seen during initialization, reduce wait time from 45s to 0s (skip wait)
            const activityDetected = this.feedspaceActivitySeen || this.detectedNetworkTypes.size > 0;
            const domWaitTimeout = activityDetected ? 45000 : 0;

            // Wait for selector in any frame
            const foundFrame = await this._waitForSelectorInAnyFrame(SELECTOR_STRING, domWaitTimeout);
            if (foundFrame) {
                locatorFrame = foundFrame;
                console.log(`[PlaywrightHelper] Found active frame containing widget.`);
            }

            const allMatches = locatorFrame.locator(SELECTOR_STRING);
            const count = await allMatches.count();

            if (count === 0) {
                const signInResult = await this._handleSignInPage();
                if (signInResult) return signInResult;

                const reason = 'False invocation: Feedspace widget not embedded (No Feedspace widget selectors matched on the page)';
                console.warn(`[PlaywrightHelper] 🛑 ${reason}`);
                this.widgetType = 'Widget Not Found';
                this.typeMatchResult = {
                    expected: this.expectedType,
                    detected: 'Widget Not Found',
                    matched: false,
                    reason: reason
                };

                return this._buildErrorResult(reason, 'FALSE_INVOCATION');
            }
            console.log(`[PlaywrightHelper] Found ${count} candidate(s)`);

            // ── STEP 2: Shadow DOM pierce scan ───────────────────────────────
            const candidatesFound = await locatorFrame.evaluate((selString) => {
                const results = [];
                const visited = new Set();
                const pierceShadow = (root) => {
                    if (!root) return;
                    root.querySelectorAll(selString).forEach(el => {
                        if (!visited.has(el)) {
                            visited.add(el);

                            // Visibility Check (Native DOM)
                            const rect = el.getBoundingClientRect();
                            const style = window.getComputedStyle(el);
                            const isVisibleOnUI = (
                                rect.width > 1 &&
                                rect.height > 1 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                style.opacity !== '0'
                            );

                            const hasStars = el.querySelector('.fs-rating-star, .fas.fa-star, .far.fa-star, [class*="star"], .fs-stars-wrapper, svg[class*="star"], [class*="rating-star"], [class*="star-icon"]');
                            const hasNumericalRating = Array.from(el.querySelectorAll('div, span, b')).some(el => {
                                const text = el.innerText.trim();
                                return /^\d+(\.\d+)?$/.test(text) && parseFloat(text) > 0 && parseFloat(text) <= 10;
                            });
                            const isRatingFound = hasStars || hasNumericalRating;

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
                                isTemp: isTemp,
                                isVisible: isVisibleOnUI,
                                isPrimary: el.classList.contains('feedspace-embed-main')
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

            // Sort candidates: Primary selectors (.feedspace-embed-main) and then Visible ones first
            candidatesFound.sort((a, b) => {
                if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
                if (a.isVisible !== b.isVisible) return a.isVisible ? -1 : 1;
                return 0;
            });

            let detectedType = 'Unknown';
            let bestHiddenLocator = null;

            for (const cInfo of candidatesFound) {
                const selector = cInfo.isTemp
                    ? `[data-fs-temp-id="${cInfo.id}"]`
                    : `[id="${cInfo.id}"], [unique_widget_id="${cInfo.id}"], [data-id="${cInfo.id}"], [data-widget-type="${cInfo.id}"]`;

                const candLocator = selector ? locatorFrame.locator(selector).first() : null;

                if (candLocator) {
                    // Direct UUID match bypasses discovery checks
                    const isUuidMatch = this.widgetUUID && (cInfo.id === this.widgetUUID || cInfo.uniqueWidgetIdAttr === this.widgetUUID);
                    if (isUuidMatch) {
                        locator = candLocator;
                        detectedType = this.expectedType;
                        console.log(`[PlaywrightHelper] 🎯 Exact Widget UUID Match: Found container matching targeted UUID ${this.widgetUUID}`);
                        break;
                    }

                    const discovered = await WidgetDetector.discover(candLocator, this.networkWidgetMap);
                    if (discovered !== 'Unknown') {
                        const isMatch = WidgetDetector.isSameType(discovered, this.expectedType);
                        if (isMatch) {
                            if (cInfo.isVisible) {
                                locator = candLocator;
                                detectedType = discovered;
                                break; // High-priority visible match found
                            } else if (!bestHiddenLocator) {
                                bestHiddenLocator = candLocator;
                                detectedType = discovered;
                            }
                        }
                    }
                }
            }

            // ── STEP 3: Verification ────────────────────────────────────────
            // If we found a locator but it's hidden, and we have a network match, report the failure.
            let isNetworkMatched = this._networkHasType(this.expectedType);

            if (!isNetworkMatched) {
                const seenTypes = [...new Set(Object.values(this.networkWidgetMap))];
                console.log(`[PlaywrightHelper] ${this.expectedType} not seen yet in network (Intercepted types so far: [${seenTypes.join(', ') || 'None'}]) — polling...`);
                for (let i = 0; i < 30; i++) {
                    await this._sleep(500);
                    isNetworkMatched = this._networkHasType(this.expectedType);
                    if (isNetworkMatched) break;
                }
            }

            // FINAL DIAGNOSTIC: Check if it's found in network but hidden in UI
            if (isNetworkMatched && (!locator && bestHiddenLocator)) {
                const reason = `Empty State: No widget embedded or visible from the frontend (Network intercepted widget ${this.expectedType} but the container is hidden or missing from the rendered DOM)`;
                console.warn(`[PlaywrightHelper] 🚨 Container Detection Failure: Network Intercept matched ${this.expectedType} but the container is HIDDEN.`);
                this.widgetType = this.expectedType;
                this.typeMatchResult = {
                    expected: this.expectedType,
                    detected: this.expectedType,
                    matched: false, // Explicitly marked as NOT matched for reporting
                    reason: reason
                };

                return this._buildErrorResult(reason);
            }

            if (!locator && !isNetworkMatched) {
                const signInResult = await this._handleSignInPage();
                if (signInResult) return signInResult;

                const seenTypes = [...new Set(Object.values(this.networkWidgetMap))];
                let reason;
                let statusOverride = 'FALSE_INVOCATION';
                if (seenTypes.length > 0) {
                    reason = `Configuration Mismatch: Expected widget type ${this.expectedType}, but widget identified as ${seenTypes.join(', ')}`;
                    statusOverride = 'FAIL';
                } else {
                    reason = `False invocation: Feedspace widget not embedded (No valid container or network signature found for ${this.expectedType})`;
                    statusOverride = 'FALSE_INVOCATION';
                }
                console.warn(`[PlaywrightHelper] ⚠️  ${reason}`);
                this.widgetType = 'Widget Not Found';
                this.typeMatchResult = {
                    expected: this.expectedType,
                    detected: 'Widget Not Found',
                    matched: false,
                    reason: reason
                };

                return this._buildErrorResult(reason, statusOverride);
            }

            // --- Continue with normal flow if visible match was found ---

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
                } else if (locator && this.expectedType !== 'Unknown' && detectedType !== this.expectedType) {
                    // TRUTH OVERRIDE: If the user provided a type in config, and DOM detection returned something else, 

                    // trust the config ONLY if a locator was found and it has Feedspace signatures.
                    const isRealFeedspace = await locator.evaluate(el => {
                        const classes = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
                        const html = el.innerHTML ? el.innerHTML.toLowerCase() : '';
                        const hasAttr = Array.from(el.attributes).some(attr =>
                            attr.name.includes('feedspace') || attr.value.includes('feedspace') ||
                            attr.name.includes('unique_widget_id') || attr.name.includes('widget_type_id')
                        );
                        return classes.includes('feedspace') || classes.includes('fe-') || html.includes('feedspace') || hasAttr;
                    }).catch(() => false);

                    if (isRealFeedspace) {
                        console.log(`[PlaywrightHelper] 🛡️  Expected Override: Config explicitly requested ${this.expectedType}. Overriding detected ${detectedType}.`);
                        this.widgetType = this.expectedType;
                    } else {
                        console.warn(`[PlaywrightHelper] 🛡️  Override Blocked: Found locator but it lacks Feedspace signatures. Avoiding Ghost Pass.`);
                        this.widgetType = 'Unknown';
                    }
                } else if (detectedType !== 'Unknown') {
                    this.widgetType = detectedType;
                } else {
                    this.widgetType = 'Unknown';
                }
            }

            // TRUTH OVERRIDE: Prevent common misidentifications (e.g. Cross Slider vs Carousel or Single Slider)
            if (this.expectedType === 'CROSS_SLIDER') {
                const genericSliders = ['CAROUSEL_SLIDER', 'SINGLE_SLIDER', 'AVATAR_SLIDER', 'AVATAR_CAROUSEL'];
                if (genericSliders.includes(this.widgetType)) {
                    console.log(`[PlaywrightHelper] 🛡️  Truth Override: Forcing CROSS_SLIDER identification over common misdetected type: ${this.widgetType}.`);
                    this.widgetType = 'CROSS_SLIDER';
                }
            }

            if (this.expectedType === 'FLOATING_TOAST') {
                if (this.widgetType === 'AVATAR_CAROUSEL' || this.widgetType === 'AVATAR_GROUP') {
                    console.log(`[PlaywrightHelper] 🛡️  Truth Override: Forcing FLOATING_TOAST identification. Mis-routing blocked for ${this.widgetType}.`);
                    this.widgetType = 'FLOATING_TOAST';
                }
            }

            if (this.expectedType === 'AVATAR_GROUP' || this.expectedType === 'AVATAR_BLOCK' || this.expectedType === 'AVATAR_CAROUSEL') {
                const genericSliders = ['CAROUSEL_SLIDER', 'SINGLE_SLIDER', 'UNKNOWN'];
                if (genericSliders.includes(this.widgetType.toUpperCase())) {
                    console.log(`[PlaywrightHelper] 🛡️  Truth Override: Forcing ${this.expectedType} identification over detected ${this.widgetType}.`);
                    this.widgetType = this.expectedType;
                }
            }

            if (this.expectedType === 'COMPANY_LOGO_SLIDER') {
                if (this.widgetType === 'MARQUEE_STRIPE' || this.widgetType === 'CAROUSEL_SLIDER' || this.widgetType === 'Unknown') {
                    console.log(`[PlaywrightHelper] 🛡️  Truth Override: Forcing COMPANY_LOGO_SLIDER identification over detected ${this.widgetType}.`);
                    this.widgetType = 'COMPANY_LOGO_SLIDER';
                }
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

            // --- UNIVERSAL ISOLATION LAYER ---
            // Force-load widget-specific features now that the type is IDENTIFIED.
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
                    'FLOATING_TOAST': 'floatingCardsFeature',
                    'AVATAR_BLOCK': 'avatarBlockFeature'
                };
                const lookupType = this.widgetType || this.expectedType;
                if (lookupType && lookupType !== 'Unknown' && lookupType !== '--url') {
                    const configName = WIDGET_CONFIG_MAP[lookupType] || lookupType.toLowerCase();
                    const configPath = path.join(process.cwd(), 'Configs', `${configName}.json`);
                    console.log(`[PlaywrightHelper] 🛡️  Isolation Check: Looking for ${configPath} (Type: ${lookupType})`);
                    if (fs.existsSync(configPath)) {
                        const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        this.staticFeatures = content.features;
                        console.log(`[PlaywrightHelper] 🛡️  Universal Isolation Layer: Force-loaded ${this.staticFeatures.length} features for ${lookupType}`);
                    } else {
                        console.warn(`[PlaywrightHelper] 🛡️  Isolation Skip: No local config file found at ${configPath}`);
                    }
                }
            } catch (e) {
                console.warn(`[PlaywrightHelper] Universal isolation failed: ${e.message}`);
            }

            // ── STEP 5: Viewport & distraction cleanup ───────────────────────
            if (this.page.isClosed()) return this._buildErrorResult('Page closed during setup');

            const normalizedType = this.widgetType.toUpperCase();

            // 🚨 Viewport Lockdown: To reproduce the user's slicing issue, we must lock the height to 700px.
            // At 1080px (default), the review box fits and we get a false PASS.
            const vHeight = normalizedType === 'AVATAR_GROUP' ? 700 : 1080;
            await this.page.setViewportSize({ width: 1536, height: vHeight });

            await this.page.evaluate((selectors) => {
                selectors.forEach(sel => {
                    try {
                        document.querySelectorAll(sel).forEach(el => {
                            el.style.setProperty('display', 'none', 'important');
                            el.style.setProperty('visibility', 'hidden', 'important');
                            el.style.setProperty('opacity', '0', 'important');
                        });
                    } catch (e) { }
                });

                // Inject global CSS to handle late-loading elements
                const style = document.createElement('style');
                style.textContent = selectors.map(s => `${s} { display: none !important; visibility: hidden !important; opacity: 0 !important; }`).join('\n');
                document.head.appendChild(style);
            }, DISTRACTION_SELECTORS);

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

                // Header-Aware Scrolling: Ensures the widget isn't hidden by sticky nav bars
                await this._scrollToWidget(locator, locatorFrame);
                await this._sleep(1500);
            }
            await this._sleep(500);

            // ── STEP 5.5: Pagination Handling moved after context resolution to support iframes

            // ── DOM "TRUTH" SNIFFING (SCOPED TO WIDGET) ─────────────────────
            // This detects presence of elements buried in Shadow DOM to prevent AI hallucination and background interference.
            let domTruth = { iconsFound: false, starsFound: false, itemCount: 0 };
            if (locator) {
                // 🛰️ FLOATING_TOAST PRE-WAIT: Toast cards are body-level fixed overlays animated in
                // after a delay. Wait up to 6s for the portrait elements to exist in DOM.
                // NOTE: We check DOM EXISTENCE (not visibility) — the parent container may be
                // opacity:0 until the entrance animation fires. FloatingToastHelper handles visible cycling.
                if (normalizedType === 'FLOATING_TOAST') {
                    console.log('[PlaywrightHelper] ⏳ FLOATING_TOAST: Waiting up to 6s for body-level toast elements in DOM...');
                    const floatingAppearSels = [
                        '.feedspace-portrait', '[data-avatar-name]',
                        '.feedspace-toast', '.fe-toast-card', '.fe-floating-preview',
                        '.fe-floating-toast', '.fe-shadow-container'
                    ];
                    let toastAppeared = false;
                    for (let tw = 0; tw < 3 && !toastAppeared; tw++) {
                        await this._sleep(2000);
                        toastAppeared = await this.page.evaluate((sels) => {
                            // Check existence only — parent may be hidden during animation
                            for (const sel of sels) {
                                if (document.querySelectorAll(sel).length > 0) return true;
                            }
                            return false;
                        }, floatingAppearSels).catch(() => false);
                        if (toastAppeared) {
                            console.log(`[PlaywrightHelper] ✅ FLOATING_TOAST: Elements found in DOM after ${(tw + 1) * 2}s.`);
                        }
                    }
                    if (!toastAppeared) {
                        console.warn('[PlaywrightHelper] ⚠️ FLOATING_TOAST: Elements not found in DOM within 6s. Proceeding anyway.');
                    }
                }

                // 🛰️ CONTENT POLLING LOOP (Harden against Race Conditions)
                // If we found the container but 0 items, we poll up to 5 times (10s total) 
                // to give the widget content time to surface in the DOM.
                let pollAttempts = 0;
                const maxPolls = 5;

                while (pollAttempts < maxPolls) {
                    pollAttempts++;

                    domTruth = await locator.evaluate(el => {
                        const iconSels = [
                            '.feedspace-d6-header-icon', '.feedspace-element-header-icon',
                            'img[src*="social-icons"]', 'a[aria-label*=".com"]',
                            '[class*="platform-icon"]', '.fe-platform-icon',
                            '[class*="platform-logo"]', 'svg[class*="platform"]'
                        ];
                        const starSels = [
                            '.feedspace-rating', '.star-rating', 'svg[class*="star"]',
                            '.fe-stars', '.fe-rating-icon', '[class*="rating-star"]',
                            '.fs-stars-wrapper', '.fs-rating-star', '.fas.fa-star',
                            '.far.fa-star', '[class*="star-icon"]', '[class*="star"]'
                        ];
                        const itemSels = [
                            '.feedspace-card', '.fe-feed-item', '.review-card',
                            '[class*="feed-box"]:not([class*="-wrap"]):not([class*="-inner"]):not([class*="-header"]):not([class*="-row"]):not([class*="-footer"])', '[class*="review-card"]',
                            '[class*="-element-d"]',
                            '.feedspace-reviewer-name', '.fe-name', '.fe-reviewer-name',
                            '[data-feed-id]', '.fe-review-body', '.feedspace-body',
                            '.carousel-item', '.fe-slick-slide', '.slick-slide',
                            '.feedspace-avatar', '.fe-avatar', '[class*="avatar"]',
                            '.feedspace-logo', '.fe-logo', '[class*="logo"]'
                        ];

                        const findDeep = (root, selectors) => {
                            for (const sel of selectors) {
                                if (root.querySelector(sel)) return true;
                            }
                            const children = [...root.querySelectorAll('*')];
                            for (const child of children) {
                                if (child.shadowRoot && findDeep(child.shadowRoot, selectors)) return true;
                            }
                            return false;
                        };

                        const countDeep = (root, selectors) => {
                            let total = 0;
                            for (const sel of selectors) {
                                total += root.querySelectorAll(sel).length;
                            }
                            const children = [...root.querySelectorAll('*')];
                            for (const child of children) {
                                if (child.shadowRoot) total += countDeep(child.shadowRoot, selectors);
                            }
                            return total;
                        };

                        // FIX: Only call countDeep once on the root or its shadow.
                        // Recursive logic handles the rest correctly.
                        const brandingSels = [
                            '.feedspace-branding-footer-link', '.feedspace-branding',
                            '.feedspace-branding-pill', '[class*="branding-footer"]',
                            '[class*="feedspace-branding"]'
                        ];
                        const context = el.shadowRoot || el;
                        const iconsFound = findDeep(context, iconSels);
                        const starsFound = findDeep(context, starSels);
                        const brandingFound = findDeep(context, brandingSels) || !!document.querySelector(brandingSels.join(', '));
                        let itemCount = countDeep(context, itemSels);

                        // FLOATING_TOAST FALLBACK: Toast cards are appended directly to <body> as fixed overlays,
                        // not inside the feedspace-embed container. If we find zero items inside the
                        // container, scan the full document for toast-specific markers (existence only —
                        // parent container may be opacity:0 during animation cycle).
                        if (itemCount === 0) {
                            const floatingToastDocSels = [
                                '.feedspace-portrait', '[data-avatar-name]',
                                '.feedspace-widget-close', '.feedspace-toast',
                                '.fe-toast-card', '.fe-floating-toast', '.fe-floating-preview',
                                '.fe-shadow-container', '.fe-chat-bubble', '.fe-bubble-launcher'
                            ];
                            for (const sel of floatingToastDocSels) {
                                const found = document.querySelectorAll(sel);
                                // Check existence only — visibility handled by FloatingToastHelper
                                if (found.length > 0) {
                                    itemCount = found.length;
                                    break;
                                }
                            }
                        }

                        return { iconsFound, starsFound, brandingFound, itemCount };
                    }).catch(() => ({ iconsFound: false, starsFound: false, brandingFound: false, itemCount: 0 }));

                    if (domTruth.itemCount > 0) break;
                    if (pollAttempts < maxPolls) {
                        console.log(`[PlaywrightHelper] 🛰️  Content Poll ${pollAttempts}/${maxPolls}: 0 items found. Waiting 2s...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                // Backup check via config widget_data
                const hasZeroFeeds = this.config && (
                    (this.config.widget_data !== undefined && this.config.widget_data !== null && typeof this.config.widget_data === 'object' && Object.keys(this.config.widget_data).length === 0) ||
                    (this.config.widget_data && Array.isArray(this.config.widget_data.feeds) && this.config.widget_data.feeds.length === 0) ||
                    (this.config.widget_data && Array.isArray(this.config.widget_data.feeds_data) && this.config.widget_data.feeds_data.length === 0)
                );

                // GENERAL API BYPASS: If DOM sniffing returns 0 items, but the network-intercepted
                // API config confirms that feeds exist in the database, we bypass the DOM empty-state gate.
                // This prevents false positives due to rendering delays, iframe isolation, or modified class names,
                // while letting the visual audit confirm whether the widget actually renders.
                if (domTruth.itemCount === 0) {
                    const apiFeeds = this.config?.widget_data?.feeds;
                    const apiFeedsData = this.config?.widget_data?.feeds_data;
                    const confirmedFeedCount = Array.isArray(apiFeeds) ? apiFeeds.length
                        : Array.isArray(apiFeedsData) ? apiFeedsData.length : -1;
                    if (confirmedFeedCount > 0) {
                        console.log(`[PlaywrightHelper] ✅ API confirms ${confirmedFeedCount} feeds. Bypassing DOM empty-state gate for ${normalizedType} (DOM sniffing counted 0 items).`);
                        domTruth.itemCount = confirmedFeedCount;
                    }
                }


                if (domTruth.itemCount === 0 || hasZeroFeeds) {
                    const reason = 'Empty State: The widget contains zero visible/active reviews on the frontend';
                    console.warn(`[PlaywrightHelper] 🛰️  DOM Sniff: EMPTY STATE CONFIRMED. ${reason}`);
                    this.widgetType = this.expectedType;
                    this.typeMatchResult = {
                        expected: this.expectedType,
                        detected: this.widgetType,
                        matched: true,
                        reason: reason
                    };
                    await this._restoreIsolatedElements();
                    return this._buildErrorResult(reason);
                } else {
                    console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Found ${domTruth.itemCount} item(s) after ${pollAttempts} poll(s).`);
                }

                // Wait for layout, slider initialization, and dynamic styles to settle before sniffing elements/boundaries
                await this._sleep(1500);

                let isBrandingClipped = false;
                let isCardClipped = false;

                if (domTruth.itemCount > 0) {
                    try {
                        const clippingStatus = await locator.evaluate(el => {
                            const isElementClippedVerticallyByAncestors = (elem) => {
                                const rect = elem.getBoundingClientRect();
                                if (rect.width === 0 || rect.height === 0) return true;

                                // Ignore internal widget overflow: hidden. Start parent traversal from
                                // outside (above) the outer Feedspace embed wrapper container.
                                const embedContainer = elem.closest('.feedspace-embed, [data-fs-target-widget="true"]');
                                let parent = embedContainer ? embedContainer.parentElement : elem.parentElement;

                                while (parent) {
                                    const style = window.getComputedStyle(parent);
                                    const hasVerticalOverflow = style.overflow === 'hidden' || style.overflowY === 'hidden';
                                    if (hasVerticalOverflow) {
                                        const pRect = parent.getBoundingClientRect();
                                        const isClipped = rect.bottom > pRect.bottom + 2 || rect.top < pRect.top - 2;
                                        if (isClipped) return true;
                                    }
                                    parent = parent.parentElement || (parent.getRootNode && parent.getRootNode().host);
                                }
                                return false;
                            };


                            const brandingSels = [
                                '.feedspace-branding-footer-link', '.feedspace-branding',
                                '.feedspace-branding-pill', '[class*="branding-footer"]',
                                '[class*="feedspace-branding"]'
                            ];

                            const findBranding = (root) => {
                                const list = [];
                                for (const sel of brandingSels) {
                                    const found = Array.from(root.querySelectorAll(sel)).filter(item => {
                                        const rect = item.getBoundingClientRect();
                                        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(item).display !== 'none';
                                    });
                                    list.push(...found);
                                }
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) list.push(...findBranding(child.shadowRoot));
                                }
                                return list;
                            };
                            const brandings = findBranding(el.shadowRoot || el);
                            for (const sel of brandingSels) {
                                const found = Array.from(document.querySelectorAll(sel)).filter(item => {
                                    const rect = item.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(item).display !== 'none';
                                });
                                brandings.push(...found);
                            }

                            const brandingClipped = brandings.length === 0 || brandings.every(b => isElementClippedVerticallyByAncestors(b));

                            const cardSels = ['.feedspace-card', '.fe-feed-item', '.review-card', '[class*="feed-box"]:not([class*="-wrap"]):not([class*="-inner"]):not([class*="-header"]):not([class*="-row"]):not([class*="-footer"])', '[class*="review-card"]'];
                            const findCards = (root) => {
                                const list = [];
                                for (const sel of cardSels) {
                                    const found = Array.from(root.querySelectorAll(sel)).filter(item => {
                                        const rect = item.getBoundingClientRect();
                                        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(item).display !== 'none';
                                    });
                                    list.push(...found);
                                }
                                const children = Array.from(root.querySelectorAll('*'));
                                for (const child of children) {
                                    if (child.shadowRoot) list.push(...findCards(child.shadowRoot));
                                }
                                return list;
                            };
                            const cards = findCards(el.shadowRoot || el);
                            const cardClipped = cards.length > 0 && cards.some(c => isElementClippedVerticallyByAncestors(c));

                            return { brandingClipped, cardClipped };
                        }).catch(() => ({ brandingClipped: false, cardClipped: false }));

                        isBrandingClipped = clippingStatus.brandingClipped;
                        isCardClipped = clippingStatus.cardClipped;
                    } catch (err) {
                        console.warn(`[PlaywrightHelper] Clipping evaluation failed: ${err.message}`);
                    }
                }

                if (domTruth.iconsFound) {
                    console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Social Icons DETECTED within widget.`);
                    this.geometricWarnings.push("DOM_TRUTH: Social Platform Icons ARE present on the review cards (e.g., next to name or in corner). You MUST report them as 'Visible'.");
                }
                if (domTruth.brandingFound) {
                    if (isBrandingClipped) {
                        console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Feedspace Branding is CLIPPED by ancestors.`);
                        this.geometricWarnings.push("DOM_TRUTH_BRANDING_ABSENT: Feedspace branding is present in the DOM but visually clipped/truncated by the parent webpage layout constraints.");
                    } else {
                        console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Feedspace Branding DETECTED.`);
                        this.geometricWarnings.push("DOM_TRUTH: Feedspace Branding (Pill/Badge) IS present at the bottom or edge of the widget. You MUST report it as 'Visible'. Check all provided screenshots, including the dedicated branding shot.");
                    }
                } else {
                    console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Feedspace Branding NOT FOUND in DOM.`);
                    this.geometricWarnings.push("DOM_TRUTH_BRANDING_ABSENT: Feedspace branding is absent from the DOM.");
                }
                if (isCardClipped) {
                    console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Review cards are CLIPPED by ancestors.`);
                    this.geometricWarnings.push("DOM_TRUTH_CARD_CLIPPED: The review cards (boundary lines) are visually clipped/truncated at the bottom by parent webpage layout constraints (overflow: hidden). This means the boundary line of the card is missing/cut off in the UI.");
                }

                if (!domTruth.starsFound && domTruth.itemCount > 0) {
                    if (['AVATAR_BLOCK', 'AVATAR_CAROUSEL', 'AVATAR_GROUP', 'FLOATING_TOAST', 'COMPANY_LOGO_SLIDER', 'CROSS_SLIDER'].includes(normalizedType)) {
                        console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Review Ratings NOT FOUND on base widget. AI must check expanded popups.`);
                        this.geometricWarnings.push(`DOM_TRUTH: Base widget has no stars. For ${normalizedType}, stars are inside the expanded review popups. Check the popup screenshots to confirm.`);
                    } else {
                        console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Review Ratings NOT FOUND within widget.`);
                        this.geometricWarnings.push("DOM_TRUTH: Review Ratings (Stars) are NOT present inside the widget review cards. Ignore any stars visible on the background page outside the widget.");
                    }
                }

                // Check if navigation/indicator controls are required based on review count
                try {
                    const rawFeeds = this.config?.feeds_data || this.config?.data?.feeds_data || this.config?.widget_data?.feeds_data || [];
                    const renderedCardsCount = await locator.evaluate(el => {
                        return el.querySelectorAll('.swiper-slide, .slick-slide, .feedspace-card, .fe-feed-item, [class*="review-card"]').length;
                    }).catch(() => 0);

                    const reviewsCount = rawFeeds.length || renderedCardsCount;

                    if (reviewsCount > 0 && reviewsCount <= 4) {
                        console.log(`[PlaywrightHelper] 🛰️  DOM Sniff: Widget has only ${reviewsCount} reviews (<= 4). Navigation/indicator controls are NOT required.`);
                        this.geometricWarnings.push("SLIDER_NO_NAVIGATION_REQUIRED: The widget has 4 or fewer reviews. Navigation controls (Left & Right Buttons/Shift Buttons) and Slider Indicators (dots) are NOT required in this layout and their absence is expected and a PASS.");
                    }

                    // Sniff presence and clipping of arrows and indicators inside the Feedspace widget container (with Shadow DOM piercing)
                    const arrowStatus = await locator.evaluate(el => {
                        const isElementClippedVerticallyByAncestors = (elem) => {
                            const rect = elem.getBoundingClientRect();
                            if (rect.width === 0 || rect.height === 0) return true;
                            let parent = elem.parentElement;
                            while (parent) {
                                const style = window.getComputedStyle(parent);
                                const hasVerticalOverflow = style.overflow === 'hidden' || style.overflowY === 'hidden';
                                if (hasVerticalOverflow) {
                                    const pRect = parent.getBoundingClientRect();
                                    const isClipped = rect.bottom > pRect.bottom + 2 || rect.top < pRect.top - 2;
                                    if (isClipped) return true;
                                }
                                parent = parent.parentElement || (parent.getRootNode && parent.getRootNode().host);
                            }
                            return false;
                        };

                        const arrowSels = ['.swiper-button-next', '.swiper-button-prev', '.slick-next', '.slick-prev', '[class*="arrow"]', '[class*="prev"]', '[class*="next"]'];
                        const pierceFind = (root) => {
                            const list = [];
                            for (const sel of arrowSels) {
                                const found = Array.from(root.querySelectorAll(sel)).filter(item => {
                                    const rect = item.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(item).display !== 'none';
                                });
                                list.push(...found);
                            }
                            const children = Array.from(root.querySelectorAll('*'));
                            for (const child of children) {
                                if (child.shadowRoot) list.push(...pierceFind(child.shadowRoot));
                            }
                            return list;
                        };
                        const arrows = pierceFind(el.shadowRoot || el);
                        if (arrows.length === 0) return { present: false, clipped: false };
                        const allClipped = arrows.every(item => isElementClippedVerticallyByAncestors(item));
                        return { present: true, clipped: allClipped };
                    }).catch(() => ({ present: false, clipped: false }));

                    const indicatorStatus = await locator.evaluate(el => {
                        const isElementClippedVerticallyByAncestors = (elem) => {
                            const rect = elem.getBoundingClientRect();
                            if (rect.width === 0 || rect.height === 0) return true;
                            let parent = elem.parentElement;
                            while (parent) {
                                const style = window.getComputedStyle(parent);
                                const hasVerticalOverflow = style.overflow === 'hidden' || style.overflowY === 'hidden';
                                if (hasVerticalOverflow) {
                                    const pRect = parent.getBoundingClientRect();
                                    const isClipped = rect.bottom > pRect.bottom + 2 || rect.top < pRect.top - 2;
                                    if (isClipped) return true;
                                }
                                parent = parent.parentElement || (parent.getRootNode && parent.getRootNode().host);
                            }
                            return false;
                        };

                        const indicatorSels = ['.swiper-pagination', '.slick-dots', '[class*="pagination"]', '[class*="dots"]', '[class*="indicator"]'];
                        const pierceFind = (root) => {
                            const list = [];
                            for (const sel of indicatorSels) {
                                const found = Array.from(root.querySelectorAll(sel)).filter(item => {
                                    const rect = item.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(item).display !== 'none';
                                });
                                list.push(...found);
                            }
                            const children = Array.from(root.querySelectorAll('*'));
                            for (const child of children) {
                                if (child.shadowRoot) list.push(...pierceFind(child.shadowRoot));
                            }
                            return list;
                        };
                        const indicators = pierceFind(el.shadowRoot || el);
                        if (indicators.length === 0) return { present: false, clipped: false };
                        const allClipped = indicators.every(item => isElementClippedVerticallyByAncestors(item));
                        return { present: true, clipped: allClipped };
                    }).catch(() => ({ present: false, clipped: false }));

                    if (!arrowStatus.present) {
                        console.log('[PlaywrightHelper] 🛰️  DOM Sniff: Navigation arrows NOT found inside Feedspace widget container.');
                        this.geometricWarnings.push("DOM_TRUTH_ARROWS_ABSENT: No slider navigation arrows/buttons are present inside the Feedspace widget container in the DOM. Ignore any arrows visible elsewhere on the page.");
                    } else if (arrowStatus.clipped) {
                        console.log('[PlaywrightHelper] 🛰️  DOM Sniff: Navigation arrows are present but CLIPPED by ancestors.');
                        this.geometricWarnings.push("DOM_TRUTH_ARROWS_CLIPPED: Slider navigation arrows are present in the DOM but visually clipped/truncated by the parent webpage layout constraints.");
                    }

                    if (!indicatorStatus.present) {
                        console.log('[PlaywrightHelper] 🛰️  DOM Sniff: Slider indicators NOT found inside Feedspace widget container.');
                        this.geometricWarnings.push("DOM_TRUTH_INDICATORS_ABSENT: No slider indicator dots/lines are present inside the Feedspace widget container in the DOM. Ignore any dots/lines visible elsewhere on the page.");
                    } else if (indicatorStatus.clipped) {
                        console.log('[PlaywrightHelper] 🛰️  DOM Sniff: Slider indicators are present but CLIPPED by ancestors.');
                        this.geometricWarnings.push("DOM_TRUTH_INDICATORS_CLIPPED: Slider indicators are present in the DOM but visually clipped/truncated by the parent webpage layout constraints.");
                    }

                    // Check if Read More button is present but hidden
                    const readMoreStatus = await locator.evaluate(el => {
                        const findReadMore = (root) => {
                            const buttons = Array.from(root.querySelectorAll('button, a, span')).filter(btn => {
                                return /Read More|Read Less/i.test(btn.innerText || btn.textContent);
                            });
                            const children = Array.from(root.querySelectorAll('*'));
                            for (const child of children) {
                                if (child.shadowRoot) buttons.push(...findReadMore(child.shadowRoot));
                            }
                            return buttons;
                        };
                        const readMores = findReadMore(el.shadowRoot || el);
                        if (readMores.length === 0) return { present: false, hidden: false };
                        const allHidden = readMores.every(btn => {
                            const style = window.getComputedStyle(btn);
                            return style.display === 'none' || style.visibility === 'hidden' || btn.classList.contains('hidden');
                        });
                        return { present: true, hidden: allHidden };
                    }).catch(() => ({ present: false, hidden: false }));

                    if (readMoreStatus.present && readMoreStatus.hidden) {
                        console.log('[PlaywrightHelper] 🛰️  DOM Sniff: Read More buttons are present in DOM but hidden because all reviews are short.');
                        this.geometricWarnings.push("DOM_TRUTH_READ_MORE_NOT_NEEDED: Read More buttons are present in the DOM but hidden because all review texts are short. This is expected behavior.");
                    }
                } catch (e) {
                    console.warn(`[PlaywrightHelper] Navigation/indicator elements check failed: ${e.message}`);
                }
            } else {
                console.warn('[PlaywrightHelper] Skipping DOM Sniff: No valid widget locator found.');
            }

            // Isolate Feedspace widget from page background/interfering widgets
            if (locator) {
                await locator.evaluate(el => {
                    el.setAttribute('data-fs-target-widget', 'true');
                }).catch(() => { });

                // Recursive Frame Marking: Walk all the way up the parent frame tree and mark
                // every frame element as kept so page isolation doesn't hide any ancestor frames.
                let currentFrame = locatorFrame;
                while (currentFrame && currentFrame !== this.page.mainFrame()) {
                    const frameElementHandle = await currentFrame.frameElement().catch(() => null);
                    if (frameElementHandle) {
                        await frameElementHandle.evaluate(el => {
                            el.setAttribute('data-fs-keep-iframe', 'true');
                        }).catch(() => { });
                    }
                    currentFrame = currentFrame.parentFrame();
                }
            }

            // FLOATING_TOAST: Skip widget isolation entirely.
            // The floating toast renders body-level fixed overlays outside the feedspace-embed container.
            // Running _isolateWidget() would hide these overlays (they are not children of the target container),
            // resulting in blank white screenshots. FloatingToastHelper captures its own focused clip shots.
            if (normalizedType !== 'FLOATING_TOAST') {
                await this._isolateWidget();
            } else {
                console.log('[PlaywrightHelper] ⏭️  FLOATING_TOAST: Skipping page isolation (body-level overlay widget).');
            }



            // ── STEP 6: Widget-specific interaction ──────────────────────────
            const box = locator ? await locator.boundingBox().catch(() => null) : null;
            if (box) {
                console.log(`[PlaywrightHelper] Widget bounds: ${Math.round(box.width)}x${Math.round(box.height)}`);
            } else {
                console.warn('[PlaywrightHelper] Widget bounds: Unknown (Locator missing or height 0)');
            }

            let interactionContext = this.page;
            if (locator) {
                if (locatorFrame !== this.page.mainFrame()) {
                    interactionContext = locatorFrame;
                    console.log('[PlaywrightHelper] Widget is inside iframe — switching context.');
                } else {
                    const tagName = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
                    if (tagName === 'iframe') {
                        const contentFrame = await locator.contentFrame();
                        if (contentFrame) {
                            interactionContext = contentFrame;
                            console.log('[PlaywrightHelper] Widget is iframe — switching context.');
                        }
                    }
                }
            }

            // Patch interactionContext if it is a Frame and doesn't have a screenshot method
            if (interactionContext && typeof interactionContext.screenshot !== 'function') {
                const self = this;
                interactionContext.screenshot = async function (options = {}) {
                    const frameElement = await this.frameElement();
                    if (frameElement) {
                        return await frameElement.screenshot(options).catch(() => null);
                    }
                    return await self.page.screenshot(options).catch(() => null);
                };
            }

            // ── STEP 6.5: Pagination Handling (Context Aware Storyboard) ─────
            // This loop handles capturing the 4-shot storyboard progression (0, 1, 4, Final)
            await this._handleLoadMoreLoop(interactionContext, screenshotBuffers);

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
                const shots = await AvatarSliderHelper.interact(interactionContext, locator, this.config, this.geometricWarnings);
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

            } else if (normalizedType === 'MASONRY' || normalizedType === 'GRID') {
                const shots = await MasonryHelper.interact(interactionContext, locator, this.config, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);

            } else if (normalizedType === 'AVATAR_GROUP') {
                const shots = await AvatarGroupHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);
            } else if (normalizedType === 'AVATAR_BLOCK') {
                const shots = await AvatarBlockHelper.interact(interactionContext, locator, this.geometricWarnings);
                if (shots?.length > 0) screenshotBuffers.push(...shots);
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

            // ── STEP 7.5: Branding-Specific Capture (Prevent Clipping) ──────
            if (domTruth.brandingFound) {
                const brandingSels = ['.feedspace-branding-footer-link', '.feedspace-branding', '[class*="branding-footer"]'];
                const branding = interactionContext.locator(brandingSels.join(', ')).filter({ visible: true }).first();
                if (await branding.isVisible().catch(() => false)) {
                    const brandingShot = await branding.screenshot({ animations: 'disabled' }).catch(() => null);
                    if (brandingShot) {
                        console.log('[PlaywrightHelper] Branding captured via dedicated screenshot.');
                        screenshotBuffers.push(brandingShot);
                    }
                }
            }

            // ── STEP 8: Viewport-context screenshot for AI ───────────────────
            // CRITICAL: We use fullPage: false by default to catch truncation.
            // However, for MASONRY (Wall of Love), we add a fullPage: true shot to see the whole wall.
            if (!this.page.isClosed()) {
                const isWall = (normalizedType === 'MASONRY' || normalizedType === 'GRID');

                // Final Viewport Shot (Catch truncation)
                const viewportShot = await this._safeScreenshot(this.page, { fullPage: false });
                if (viewportShot) screenshotBuffers.push(viewportShot);

                // Full Page Shot (Context for long widgets or popups)
                const hasPopup = this.geometricWarnings.some(w => w.includes('POPUP_DETECTED'));
                if (isWall || hasPopup) {
                    console.log(`[PlaywrightHelper] Capturing Full Page shot (${isWall ? 'Wall' : 'Popup'} context).`);
                    const fullShot = await this._safeScreenshot(this.page, { fullPage: true });
                    if (fullShot) screenshotBuffers.push(fullShot);
                }
            }

            // Restore isolated page elements
            await this._restoreIsolatedElements();

        } catch (error) {
            console.error('[PlaywrightHelper] Validation error:', error.message);
            // Restore isolated page elements in case of failure
            await this._restoreIsolatedElements();
            if (screenshotBuffers.length === 0 && !this.page.isClosed()) {
                try {
                    const isMarquee = this.widgetType && (this.widgetType.includes('MARQUEE') || this.widgetType.includes('SLIDER'));
                    screenshotBuffers.push(await this.page.screenshot({ fullPage: !isMarquee, animations: 'disabled' }));
                } catch (ssError) {
                    console.error('[PlaywrightHelper] Fallback screenshot failed:', ssError.message);
                }
            }
        }

        return this._finalizeAnalysis(screenshotBuffers, this.staticFeatures);
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
            const reason = 'Feedspace widget not detected on this page.';
            console.error(`[PlaywrightHelper] 🛑 Aborting AI analysis: ${reason}`);
            return this._buildErrorResult(reason);
        }

        // --- STRICT VALIDATION: GHOST PASS PREVENTION ---
        // If the widget type was CONFIRMED (matched) but ZERO focused screenshots were taken,
        // it means the automation reached the element but failed to capture it.
        // This MUST be a failure.
        if (this.typeMatchResult?.matched && hasNoVisuals) {
            const reason = `Feedspace widget (${this.widgetType}) detected via network, but failed to render visually on page.`;
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

    /**
     * Hides all elements on the page except the targeted Feedspace container and its ancestors/descendants.
     */
    async _isolateWidget() {
        try {
            console.log('[PlaywrightHelper] 🛡️  Isolating target Feedspace widget: hiding other page elements & sibling widgets.');
            await this.page.evaluate((selString) => {
                const keep = new Set();

                // Keep any marked iframe elements and their ancestors
                document.querySelectorAll('[data-fs-keep-iframe="true"]').forEach(iframe => {
                    let curr = iframe;
                    while (curr) {
                        keep.add(curr);
                        curr = curr.parentElement || (curr.getRootNode && curr.getRootNode().host);
                    }
                });

                // GENERAL OVERLAY PROTECTION: Keep standard modal, tooltip, and popup elements (often appended directly to <body>)
                // for all widgets so that page isolation doesn't hide overlays during clicks/interactions.
                const overlaySels = [
                    '.fe-review-box', '.fe-modal-content', '[class*="review-box"]', '.feedspace-expanded-review',
                    '.fs-modal-overlay', '.fs-modal-inner', '.fs-modal-content', '.feedspace-review-card',
                    '.feedspace-avatar-tooltip', '[class*="tooltip"]', '.fe-tooltip',
                    '.feedspace-toast', '.fe-toast-card', '.fe-floating-preview', '.fe-floating-toast',
                    '.fe-shadow-container', '.fe-chat-bubble', '.fe-bubble-launcher',
                    '.feedspace-portrait', '[data-avatar-name]', '.feedspace-widget-close'
                ];
                overlaySels.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                        let curr = el;
                        while (curr) {
                            keep.add(curr);
                            curr = curr.parentElement || (curr.getRootNode && curr.getRootNode().host);
                        }
                    });
                });

                // Find targeted widget, falling back to all matching selectors if no target marked
                const targetWidgets = document.querySelectorAll('[data-fs-target-widget="true"]');
                const targets = targetWidgets.length > 0 ? targetWidgets : document.querySelectorAll(selString);

                const pierceFind = (root) => {
                    targets.forEach(target => {
                        // Check if the target is within the current root subtree
                        if (root.contains && !root.contains(target)) return;

                        let curr = target;
                        while (curr && curr !== root) {
                            keep.add(curr);
                            curr = curr.parentElement || (curr.getRootNode && curr.getRootNode().host);
                        }
                        if (curr) keep.add(curr); // Add root if we reached it

                        const children = target.querySelectorAll('*');
                        children.forEach(c => {
                            keep.add(c);
                            if (c.shadowRoot) {
                                const subChildren = c.shadowRoot.querySelectorAll('*');
                                subChildren.forEach(sc => keep.add(sc));
                            }
                        });
                    });

                    root.querySelectorAll('*').forEach(el => {
                        if (el.shadowRoot) pierceFind(el.shadowRoot);
                    });
                };

                pierceFind(document);

                // Now hide everything else
                const all = document.querySelectorAll('*');
                all.forEach(el => {
                    if (!keep.has(el) &&
                        el.tagName !== 'HTML' &&
                        el.tagName !== 'BODY' &&
                        el.tagName !== 'HEAD' &&
                        el.tagName !== 'SCRIPT' &&
                        el.tagName !== 'STYLE') {

                        const computedStyle = window.getComputedStyle(el);
                        if (computedStyle.display !== 'none') {
                            el.dataset.fsOriginalDisplay = el.style.display || 'block';
                            el.style.setProperty('display', 'none', 'important');
                        }
                    }
                });
            }, SELECTOR_STRING);
        } catch (e) {
            console.warn('[PlaywrightHelper] Failed to isolate widget:', e.message);
        }
    }

    /**
     * Restores all elements that were hidden by _isolateWidget.
     */
    async _restoreIsolatedElements() {
        try {
            console.log('[PlaywrightHelper] 🛡️  Restoring hidden page elements.');
            await this.page.evaluate(() => {
                const hidden = document.querySelectorAll('[data-fs-original-display]');
                hidden.forEach(el => {
                    el.style.display = el.dataset.fsOriginalDisplay === 'block' ? '' : el.dataset.fsOriginalDisplay;
                    el.removeAttribute('data-fs-original-display');
                });

                // Clean up any data-fs-keep-iframe attributes
                document.querySelectorAll('[data-fs-keep-iframe]').forEach(el => {
                    el.removeAttribute('data-fs-keep-iframe');
                });

                // Clean up any data-fs-target-widget attributes
                document.querySelectorAll('[data-fs-target-widget]').forEach(el => {
                    el.removeAttribute('data-fs-target-widget');
                });
            }).catch(e => console.warn('[PlaywrightHelper] Restore evaluation failed:', e.message));
        } catch (e) {
            console.warn('[PlaywrightHelper] Failed to restore elements:', e.message);
        }
    }

    async _handleSignInPage() {
        const currentUrl = this.page.url().toLowerCase();
        const pageTitle = (await this.page.title().catch(() => '')).toLowerCase();

        const isSignInPage = currentUrl.includes('/signin') ||
            currentUrl.includes('/login') ||
            currentUrl.includes('/sign-in') ||
            (currentUrl.includes('signin') && !currentUrl.includes('feedspace')) ||
            (currentUrl.includes('login') && !currentUrl.includes('feedspace')) ||
            pageTitle.includes('login') ||
            pageTitle.includes('sign in') ||
            pageTitle.includes('signin');

        if (isSignInPage) {
            const passMessage = 'This is the sign-in/login page, no Feedspace widgets found';
            console.log(`[PlaywrightHelper] ℹ️ ${passMessage} (URL: ${this.page.url()})`);
            this.widgetType = 'Sign-in Page';
            this.typeMatchResult = {
                expected: this.expectedType,
                detected: 'Sign-in Page',
                matched: true,
                reason: passMessage
            };

            const savedPaths = [];
            try {
                if (!this.page.isClosed()) {
                    const buffer = await this.page.screenshot({ fullPage: true }).catch(() => null);
                    if (buffer) {
                        const timestamp = Date.now();
                        const screenshotDir = path.join(process.cwd(), 'screenshots');
                        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
                        const screenshotPath = path.join(screenshotDir, `SigninPage_${timestamp}.png`);
                        fs.writeFileSync(screenshotPath, buffer);
                        savedPaths.push(screenshotPath);
                    }
                }
            } catch (e) {
                console.warn(`[PlaywrightHelper] Could not take signin page screenshot: ${e.message}`);
            }

            return {
                expectedType: this.expectedType,
                widgetType: 'Sign-in Page',
                typeMatchResult: this.typeMatchResult,
                capturedConfig: this.config,
                aiAnalysis: {
                    overall_status: 'PASS',
                    summary: passMessage,
                    feature_results: [{
                        feature: 'Widget Presence Check',
                        status: 'PASS',
                        issue: passMessage
                    }]
                },
                screenshotPath: savedPaths[0] || null,
                screenshotPaths: savedPaths
            };
        }
        return null;
    }

    _buildErrorResult(reason, statusOverride = 'FAIL') {
        const staticFeatures = this.staticFeatures || [];
        const featureResults = staticFeatures.map(f => ({
            feature: typeof f === 'string' ? f : (f.name || 'Unknown'),
            ui_status: 'Absent',
            config_status: 'Visible',
            issue: reason,
            remarks: 'Feature is absent due to Empty State/No widget embedded.',
            status: statusOverride
        }));

        if (featureResults.length === 0) {
            featureResults.push({
                feature: 'Validation Integrity',
                ui_status: 'Absent',
                config_status: 'Visible',
                issue: reason,
                remarks: 'Validation failed.',
                status: statusOverride
            });
        }

        const aestheticResults = [
            { category: "A. LAYOUT & SPACING", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "B. ELEMENT CONTAINMENT", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "C. CONTENT & TEXT RENDERING", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "D. AVATAR RENDERING", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "E. MEDIA & IMAGES", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "F. THEME & COLOR VISIBILITY", issue: reason, severity: "CRITICAL", status: statusOverride },
            { category: "G. POPUPS & MODALS", issue: reason, severity: "CRITICAL", status: statusOverride }
        ];

        return {
            expectedType: this.expectedType,
            widgetType: this.widgetType || 'Unknown',
            error: reason,
            typeMatchResult: {
                expected: this.expectedType,
                detected: this.widgetType || 'Unknown',
                matched: false,
                reason: reason,
                networkSawType: this._networkHasType(this.expectedType)
            },
            aiAnalysis: {
                overall_status: statusOverride,
                summary: reason,
                analysis_message: reason,
                feature_results: featureResults,
                aesthetic_results: aestheticResults
            },
            screenshotPaths: []
        };
    }

    async _handleLoadMoreLoop(context, screenshotBuffers = []) {
        const type = (this.widgetType || "").toUpperCase();
        const isSlider = type.includes('SLIDER') || type.includes('CAROUSEL') || type.includes('MARQUEE') || type.includes('TOAST') || type.includes('AVATAR_GROUP') || type.includes('AVATAR_BLOCK');

        if (isSlider) {
            console.log(`[PlaywrightHelper] Skipping "Load More" loop for ${type} widget.`);
            // [DEPRECATED] Expand any visible "Read More" for sliders/marquees/toasts
            // await this._expandReadMore(context);

            // Just capture the initial state for the storyboard
            if (screenshotBuffers.length === 0) {
                const initialShot = await context.screenshot({ animations: 'disabled' }).catch(() => null);
                if (initialShot) screenshotBuffers.push(initialShot);
            }
            return;
        }

        let clickCount = 0;
        const maxClicks = 10;
        const loadMoreSelector = 'span:has-text("Load More"), button:has-text("Load More")';

        console.warn(`[PlaywrightHelper] 🔄 Initializing "Load More" storyboard loop (Max ${maxClicks} clicks)...`);

        // --- View 1: Initial State (Click 0) ---
        if (screenshotBuffers.length === 0) {
            await this._expandReadMore(context);
            const initialShot = await context.screenshot({ animations: 'disabled' }).catch(() => null);
            if (initialShot) {
                console.log('[PlaywrightHelper] Storyboard: Captured View 1 (Initial State)');
                screenshotBuffers.push(initialShot);
            }
        }

        while (clickCount < maxClicks) {
            try {
                // Ensure the button is visible and re-centered
                const button = context.locator(loadMoreSelector).filter({ visible: true }).first();
                if (!(await button.isVisible())) {
                    console.log('[PlaywrightHelper] "Load More" button no longer visible. Expansion complete.');
                    break;
                }

                clickCount++;
                console.warn(`[PlaywrightHelper] 🔄 Clicking "Load More" (${clickCount}/${maxClicks})...`);

                // Force scroll to button before clicking to maintain human visibility
                await button.scrollIntoViewIfNeeded().catch(() => { });
                await button.click({ force: true, timeout: 5000 }).catch(async () => {
                    await button.evaluate(el => el.click());
                });

                // Wait for content to arrive and stabilize
                await this._sleep(2000);

                // --- View 2 & 3: Progression States (Click 1 and 4) ---
                if (clickCount === 1 || clickCount === 4) {
                    console.log(`[PlaywrightHelper] Storyboard: Capturing View ${clickCount === 1 ? '2' : '3'}...`);
                    // Ensure new content is expanded before screenshot
                    await this._expandReadMore(context);
                    // Smart scroll: Ensure we see the NEWLY loaded area
                    await context.evaluate(() => window.scrollBy(0, 400)).catch(() => { });
                    const shot = await this._safeScreenshot(context, {});
                    if (shot) screenshotBuffers.push(shot);
                }

            } catch (err) {
                console.warn(`[PlaywrightHelper] ⚠️ Pagination loop interrupted at click ${clickCount}:`, err.message);
                break;
            }
        }

        // --- View 4: Final State (After Loop) ---
        if (clickCount > 0) {
            console.log('[PlaywrightHelper] Storyboard: Captured View 4 (Final State)');
            const finalShot = await context.screenshot({ animations: 'disabled' }).catch(() => null);
            if (finalShot) screenshotBuffers.push(finalShot);
        }

        console.log(`[PlaywrightHelper] ✅ Storyboard sequence complete with ${screenshotBuffers.length} images.`);
    }

    /**
     * Injects CSS to freeze all animations and transitions.
     * Prevents motion-blur hallucinations on moving widgets (Marquees/Sliders).
     */
    async _pauseAnimations() {
        try {
            console.log('[PlaywrightHelper] ❄️ Freezing animations...');
            await this.page.addStyleTag({
                content: `
                    *, *::before, *::after {
                        animation-play-state: paused !important;
                        transition-duration: 0s !important;
                        transition-property: none !important;
                        animation-duration: 0s !important;
                        animation-iteration-count: 1 !important;
                        scroll-behavior: auto !important;
                    }
                `
            }).catch(() => null);
            await this._sleep(500); // Stabilization wait
        } catch (e) {
            console.warn('[PlaywrightHelper] Animation freeze failed:', e.message);
        }
    }

    /**
     * Header-Aware scroll to ensure widget is visible and not covered by sticky headers.
     */
    async _scrollToWidget(locator, frame) {
        if (!locator) return;
        try {
            const targetFrame = frame || this.page;
            if (targetFrame !== this.page.mainFrame()) {
                const frameElementHandle = await targetFrame.frameElement();
                if (frameElementHandle) {
                    await this.page.evaluate(([iframeEl, headerOffset]) => {
                        const rect = iframeEl.getBoundingClientRect();
                        const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
                        const targetY = currentScroll + rect.top - headerOffset;
                        window.scrollTo({
                            top: Math.max(0, targetY),
                            behavior: 'auto'
                        });
                    }, [frameElementHandle, 100]); // 100px offset for header
                    console.log('[PlaywrightHelper] Scrolled subframe container into view with header offset.');
                    return;
                }
            }

            await locator.evaluate((el) => {
                // 1. Calculate Header Height
                const headerHeight = Array.from(document.querySelectorAll('*'))
                    .filter(node => {
                        const style = window.getComputedStyle(node);
                        return (style.position === 'fixed' || style.position === 'sticky') &&
                            parseFloat(style.top) === 0 &&
                            node.offsetHeight > 10 &&
                            node.offsetHeight < 300; // Filter out full-page overlays
                    })
                    .reduce((max, node) => Math.max(max, node.offsetHeight), 0);

                // 2. Scroll with Offset
                const rect = el.getBoundingClientRect();
                const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
                const targetY = currentScroll + rect.top - (headerHeight + 50); // 50px extra breathing room

                window.scrollTo({
                    top: Math.max(0, targetY),
                    behavior: 'auto' // Instant scroll to avoid capture lag
                });
            });
            console.log('[PlaywrightHelper] Header-aware scroll complete.');
        } catch (e) {
            console.warn('[PlaywrightHelper] Custom scroll failed, falling back:', e.message);
            await locator.scrollIntoViewIfNeeded().catch(() => { });
        }
    }

    /**
     * Finds and clicks all "Read More" buttons within a container to expand content.
     */
    async _expandReadMore(containerLocator) {
        if (!containerLocator) return;

        // 🛡️ Guard: Skip expansion for Marquee/Slider widgets to prevent "Slice Fail" layout defects
        const isConstrained = this.widgetType && (
            this.widgetType.includes('MARQUEE') ||
            this.widgetType.includes('SLIDER') ||
            this.widgetType.includes('CAROUSEL')
        );

        if (isConstrained) {
            console.log(`[PlaywrightHelper] 🛡️ Skipping 'Read More' expansion for constrained widget type: ${this.widgetType}`);
            return;
        }

        try {
            // Find all elements containing "Read More" (buttons, links, or spans)
            // We use a broader selector and filter by visibility
            const readMoreLocators = [
                containerLocator.getByText('Read More', { exact: false }),
                containerLocator.locator('a:has-text("Read More")'),
                containerLocator.locator('button:has-text("Read More")'),
                containerLocator.locator('span:has-text("Read More")')
            ];

            for (const loc of readMoreLocators) {
                const count = await loc.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                    const btn = loc.nth(i);
                    if (await btn.isVisible().catch(() => false)) {
                        console.log(`[PlaywrightHelper] Clicking 'Read More' button ${i + 1}`);
                        await btn.click({ force: true, timeout: 2000 }).catch(() => { });
                        await this._sleep(200); // Animation buffer
                    }
                }
            }
        } catch (e) {
            console.warn(`[PlaywrightHelper] Read More expansion failed: ${e.message}`);
        }
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async _waitForSelectorInAnyFrame(selector, timeout = 45000) {
        if (timeout <= 0) return null;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            if (this.page.isClosed()) return null;
            for (const frame of this.page.frames()) {
                try {
                    if (frame.isDetached()) continue;
                    const count = await frame.locator(selector).count().catch(() => 0);
                    if (count > 0) {
                        return frame;
                    }
                } catch (e) { }
            }
            await this._sleep(1000);
        }
        return null;
    }

    /**
     * Safe Screenshot Wrapper: Prevents 400 API errors by capping dimensions.
     */
    async _safeScreenshot(target, options = {}) {
        try {
            if (!target || this.page.isClosed()) return null;

            // Handle Frame target by delegating to its frameElement
            const isFrame = typeof target.screenshot === 'function' && typeof target.page === 'function' && typeof target.boundingBox !== 'function';
            if (isFrame) {
                const frameElement = await target.frameElement();
                if (frameElement) {
                    return await this._safeScreenshot(frameElement, options);
                } else {
                    return await this._safeScreenshot(this.page, options);
                }
            }

            const isPage = target === this.page;
            let height = 0;
            let width = 0;

            if (isPage) {
                const size = this.page.viewportSize();
                width = size ? size.width : 1536;
                height = await this.page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
            } else {
                const box = await target.boundingBox().catch(() => null);
                if (box) {
                    width = box.width;
                    height = box.height;
                }
            }

            const screenshotOptions = { ...options, animations: 'disabled' };

            // If we are doing fullPage or the target element is too tall, we must cap it
            const shouldCap = (options.fullPage || !isPage) && height > MAX_SCREENSHOT_HEIGHT;

            if (shouldCap) {
                console.warn(`[PlaywrightHelper] 🛡️  Dimension Guard: Target height (${Math.round(height)}px) exceeds safety limit. Capping at ${MAX_SCREENSHOT_HEIGHT}px.`);

                const originalSize = this.page.viewportSize();
                const targetWidth = width || (originalSize ? originalSize.width : 1536);

                try {
                    await this.page.setViewportSize({
                        width: Math.round(targetWidth),
                        height: MAX_SCREENSHOT_HEIGHT
                    });

                    const shot = await target.screenshot({ ...screenshotOptions, fullPage: false }).catch(() => null);

                    if (originalSize) await this.page.setViewportSize(originalSize).catch(() => { });
                    return shot;
                } catch (vpError) {
                    console.error(`[PlaywrightHelper] Viewport expansion failed: ${vpError.message}`);
                    // Fallback to normal screenshot if viewport expansion fails
                }
            }

            return await target.screenshot(screenshotOptions).catch((e) => {
                console.error(`[PlaywrightHelper] Screenshot failed: ${e.message}`);
                return null;
            });
        } catch (e) {
            console.error(`[PlaywrightHelper] Safe screenshot error: ${e.message}`);
            return null;
        }
    }
}

module.exports = PlaywrightHelper;
