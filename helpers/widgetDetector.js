/**
 * widgetDetector.js
 * Feedspace Widget Type Detection — Corrected Version
 */

const WidgetTypeConstants = {
    4: 'CAROUSEL_SLIDER',
    5: 'MASONRY',
    6: 'MARQUEE_STRIPE',     // Backend term — same as STRIP_SLIDER on frontend
    7: 'AVATAR_GROUP',
    8: 'SINGLE_SLIDER',
    9: 'MARQUEE_UPDOWN',
    10: 'MARQUEE_LEFTRIGHT',
    11: 'FLOATING_TOAST',
    16: 'AVATAR_CAROUSEL',
    17: 'CROSS_SLIDER',
    18: 'COMPANY_LOGO_SLIDER'
};

const WidgetTypeNames = {
    CAROUSEL_SLIDER: 4,
    MASONRY: 5,
    MARQUEE_STRIPE: 6,
    AVATAR_GROUP: 7,
    SINGLE_SLIDER: 8,
    MARQUEE_UPDOWN: 9,
    MARQUEE_LEFTRIGHT: 10,
    FLOATING_TOAST: 11,
    AVATAR_CAROUSEL: 16,
    CROSS_SLIDER: 17,
    COMPANY_LOGO_SLIDER: 18
};

// Frontend alias terms that map to backend constants
const WidgetAliases = {
    'stripslider': 'MARQUEE_STRIPE',
    'marqueeslider': 'MARQUEE_STRIPE',
    'carouselslider': 'CAROUSEL_SLIDER',
    'carousel': 'CAROUSEL_SLIDER',
    'singleslider': 'SINGLE_SLIDER',
    'marqueeupdown': 'MARQUEE_UPDOWN',
    'marqueeuptown': 'MARQUEE_UPDOWN',
    'marqueeleftright': 'MARQUEE_LEFTRIGHT',
    'floatingtoast': 'FLOATING_TOAST',
    'avatargroup': 'AVATAR_GROUP',
    'masonry': 'MASONRY',
    'marqueestripe': 'MARQUEE_STRIPE',
    'avatarcarousel': 'AVATAR_CAROUSEL',
    'crossslider': 'CROSS_SLIDER',
    'avatarslider': 'SINGLE_SLIDER',
    'companylogoslider': 'COMPANY_LOGO_SLIDER'
};

// CSS class signatures mapped to widget types
const CSS_SIGNATURES = [
    { classes: ['feedspace-cross-slider', 'cross-slider', 'fe-cross-slider', 'fe-cross', '[class*="cross-slider"]'], type: 'CROSS_SLIDER' },
    { classes: ['feedspace-company-logo-slider', 'company-logo-slider', 'fe-company-logo-slider'], type: 'COMPANY_LOGO_SLIDER' },
    { classes: ['feedspace-vertical-scroll', 'feedspace-updown', 'vertical-marquee'], type: 'MARQUEE_UPDOWN' },
    { classes: ['fe-feedspace-avatar-group-widget-wrap', 'feedspace-avatar-group'], type: 'AVATAR_GROUP' },
    { classes: ['feedspace-carousel-widget', 'testimonial-slider', 'carousel_slider'], type: 'CAROUSEL_SLIDER' },
    { classes: ['feedspace-marque-main-wrap', 'strip-slider'], type: 'MARQUEE_STRIPE' },
    { classes: ['feedspace-floating-widget', 'fe-floating-toast', 'fe-toast-card', 'fe-chat-bubble'], type: 'FLOATING_TOAST' },
    { classes: ['feedspace-element-horizontal-scroll-widget', 'feedspace-left-right-shadow'], type: 'MARQUEE_LEFTRIGHT' },
    { classes: ['feedspace-single-review-widget', 'single-slider', 'feedspace-single-slider'], type: 'SINGLE_SLIDER' },
    { classes: ['fe-masonry', 'feedspace-masonry', 'masonry-widget'], type: 'MASONRY' },
    { classes: ['feedspace-avatar-carousel', 'fe-avatar-carousel', 'fe-avatar-slider', 'feedspace-embed'], type: 'AVATAR_CAROUSEL' }
];

// ── VALID WIDGET TYPE IDs ────────────────────────────────────────────────────
const VALID_TYPE_IDS = new Set(Object.keys(WidgetTypeConstants).map(Number));

class WidgetDetector {

    /**
     * Identify widget type from a raw string, numeric ID, or a full configuration object.
     * @param {any} input - The raw type ID, name, or the full config object.
     * @param {object} config - Optional fallback config for heuristics.
     * @returns {string} The canonical widget type name (e.g., 'CAROUSEL_SLIDER') or 'Unknown'.
     */
    static identify(input, config = {}) {
        let raw = null;
        let actualConfig = config;

        if (input && typeof input === 'object') {
            raw = input.widget_type_id ?? input.type;
            actualConfig = input;
        } else {
            raw = input;
        }

        if (raw === null || raw === undefined) return 'Unknown';

        const numericId = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!isNaN(numericId) && WidgetTypeConstants[numericId]) {
            return WidgetTypeConstants[numericId];
        }

        if (typeof raw === 'string') {
            const normalized = raw.toLowerCase().replace(/[_\- ]/g, '');
            if (WidgetAliases[normalized]) return WidgetAliases[normalized];
            
            // Fallback: If normalization didn't find it, try direct uppercase with underscores
            const upperRaw = raw.toUpperCase().replace(/[- ]/g, '_');
            if (WidgetTypeNames[upperRaw] !== undefined) return upperRaw;
            
            // Direct alias check for known common strings
            if (normalized === 'companylogoslider') return 'COMPANY_LOGO_SLIDER';
            if (normalized === 'crossslider') return 'CROSS_SLIDER';
            if (normalized === 'avatarcarousel') return 'AVATAR_CAROUSEL';
        }

        // HINT — Unique Config Key Detection
        if (config.show_crossbar === '1' || config.allow_cross_scrolling_animation === '1') {
            return 'CROSS_SLIDER';
        }
        if (config.is_autoplay === '1' && config.marquee_speed) {
            // Strong marquee hint
            return 'MARQUEE_STRIPE';
        }

        return 'Unknown';
    }

    /**
     * Extract widget type SAFELY from a single parsed network JSON object.
     */
    static extractFromNetworkPayload(json) {
        if (!json || typeof json !== 'object' || Array.isArray(json)) return null;

        const preferredRaw = json.widget_type_id ?? json.widget_type ?? null;
        if (preferredRaw !== null && preferredRaw !== undefined) {
            const numericId = typeof preferredRaw === 'number' ? preferredRaw : parseInt(preferredRaw, 10);
            if (!isNaN(numericId) && VALID_TYPE_IDS.has(numericId)) {
                const typeName = WidgetTypeConstants[numericId];
                const uid = json.unique_widget_id || json.unique_id || null;
                return { typeName, typeId: numericId, uniqueWidgetId: uid, data: json };
            }
        }

        const rawType = json.type;
        if (rawType !== null && rawType !== undefined) {
            const numericType = typeof rawType === 'number' ? rawType : parseInt(rawType, 10);
            if (!isNaN(numericType) && VALID_TYPE_IDS.has(numericType)) {
                const typeName = WidgetTypeConstants[numericType];
                const uid = json.unique_widget_id || json.unique_id || null;
                return { typeName, typeId: numericType, uniqueWidgetId: uid, data: json };
            }

            if (typeof rawType === 'string') {
                const resolved = WidgetDetector.identify({ type: rawType });
                if (resolved !== 'Unknown') {
                    const uid = json.unique_widget_id || json.unique_id || null;
                    return { 
                        typeName: resolved, 
                        typeId: WidgetTypeNames[resolved] ?? null, 
                        uniqueWidgetId: uid,
                        data: json 
                    };
                }
            }
        }

        return null;
    }

    /**
     * Recursively search a JSON tree for widget type payloads.
     */
    static collectFromNestedPayload(obj, results = [], depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 10) return results;

        if (Array.isArray(obj)) {
            for (const item of obj) {
                WidgetDetector.collectFromNestedPayload(item, results, depth + 1);
            }
            return results;
        }

        const extracted = WidgetDetector.extractFromNetworkPayload(obj);
        if (extracted) results.push(extracted);

        const SKIP_KEYS = new Set(['font', 'dark_mode_colors', 'cta_attributes', 'widget_customization_meta']);
        for (const key of Object.keys(obj)) {
            if (SKIP_KEYS.has(key)) continue;
            const val = obj[key];
            if (val && typeof val === 'object') {
                try {
                    WidgetDetector.collectFromNestedPayload(val, results, depth + 1);
                } catch (e) { }
            }
        }

        return results;
    }

    /**
     * Discover widget type from a live Playwright locator.
     */
    static async discover(locator, networkMap = {}) {
        if (!locator) return 'Unknown';

        let info = null;
        try {
            info = await Promise.race([
                locator.evaluate(async (el) => {
                    let id = null;

                    const getAttr = (element) => {
                        return element.getAttribute('data-widget-type') ||
                            element.getAttribute('widget_type_id') ||
                            element.getAttribute('data-type') ||
                            element.getAttribute('data-feedspace-type') ||
                            element.getAttribute('data-id');
                    };

                    // ── Path 1: Walk up DOM (including host elements) ──
                    let current = el;
                    while (current && current !== document.body) {
                        id = getAttr(current);
                        if (id) break;
                        // For Shadow DOM piercing in reverse
                        if (!current.parentElement && current.getRootNode()?.host) {
                            current = current.getRootNode().host;
                        } else {
                            current = current.parentElement;
                        }
                    }

                    // ── Path 2: Check children/shadows if not found ──
                    if (!id && el.shadowRoot) {
                        try {
                            const shadowWidget = el.shadowRoot.querySelector('[data-widget-type], [widget_type_id], [unique_widget_id], [data-type], [data-feedspace-type], [data-id], .feedspace-widget');
                            if (shadowWidget) id = getAttr(shadowWidget);
                        } catch (e) { }
                    }

                    if (!id) {
                        const child = el.querySelector('[data-widget-type], [widget_type_id], [data-type], [data-feedspace-type], [data-id]');
                        if (child) id = getAttr(child);
                    }

                    // ── Path 3: Iframe Content ──
                    let rawHtml = el.innerHTML || '';
                    if (el.tagName.toLowerCase() === 'iframe') {
                        try {
                            const doc = el.contentDocument || el.contentWindow.document;
                            if (doc && doc.body) {
                                rawHtml += ' ' + doc.body.innerHTML;
                                if (!id) {
                                    const innerWidget = doc.querySelector('[data-widget-type], [widget_type_id], [data-type], [data-feedspace-type], [data-id]');
                                    if (innerWidget) id = getAttr(innerWidget);
                                }
                            }
                        } catch (e) { }
                    }

                    if (el.shadowRoot) rawHtml += ' ' + el.shadowRoot.innerHTML;
                    const htmlSnippet = rawHtml.toLowerCase().substring(0, 2000);

                    const ownClasses = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
                    const parent = el.parentElement || el.getRootNode()?.host;
                    const parentClasses = (parent && parent.className && typeof parent.className === 'string') ? parent.className.toLowerCase() : '';
                    const allClasses = `${parentClasses} ${ownClasses}`.trim();

                    const isFeedspaceAnchor = !!(
                        allClasses.includes('feedspace-') ||
                        allClasses.includes('fe-') ||
                        allClasses.includes('ccustom-code-') ||
                        el.hasAttribute('data-fs-processed') ||
                        htmlSnippet.includes('feedspace')
                    );

                    return { idAttr: id, allClasses, htmlSnippet, isFeedspaceAnchor };
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('locator.evaluate() timed out after 5s')), 5000))
            ]);
        } catch (e) {
            console.warn(`[WidgetDetector] discover() evaluation failed: ${e.message}`);
            return 'Unknown';
        }

        if (!info) return 'Unknown';

        if (info.idAttr !== null && info.idAttr !== undefined) {
            if (networkMap[info.idAttr]) return networkMap[info.idAttr];
            const numericId = parseInt(info.idAttr, 10);
            if (!isNaN(numericId) && WidgetTypeConstants[numericId]) return WidgetTypeConstants[numericId];
            const normalizedAttr = info.idAttr.toLowerCase().replace(/[_\- ]/g, '');
            if (WidgetAliases[normalizedAttr]) return WidgetAliases[normalizedAttr];
            const upperAttr = info.idAttr.toUpperCase().replace(/[- ]/g, '_');
            if (WidgetTypeNames[upperAttr] !== undefined) return upperAttr;
        }

        const hasClass = (classString, token) => {
            if (!classString || !token) return false;
            return new RegExp(`(^|\\s)${token}(\\s|$)`).test(classString);
        };

        const classes = info.allClasses;
        const SIGNATURES_ORDERED = [
            ...CSS_SIGNATURES.filter(s => s.type === 'MASONRY'),
            ...CSS_SIGNATURES.filter(s => s.type !== 'MASONRY')
        ];

        for (const signature of SIGNATURES_ORDERED) {
            for (const cls of signature.classes) {
                if (hasClass(classes, cls)) return signature.type;
            }
        }

        // ── STEP 3: HTML Snippet Fallback ────────────────────────────────
        // If attributes and CSS classes fail, check the raw HTML for keywords.
        const snippet = info.htmlSnippet;
        if (snippet.includes('masonry')) return 'MASONRY';
        if (snippet.includes('cross-slider')) return 'CROSS_SLIDER';
        if (snippet.includes('company-logo-slider')) return 'COMPANY_LOGO_SLIDER';
        if (snippet.includes('avatar-carousel')) return 'AVATAR_CAROUSEL';
        if (snippet.includes('floating-toast') || snippet.includes('chat-bubble')) return 'FLOATING_TOAST';
        if (snippet.includes('avatar-group')) return 'AVATAR_GROUP';
        if (snippet.includes('strip-slider')) return 'MARQUEE_STRIPE';
        if (snippet.includes('single-slider')) return 'SINGLE_SLIDER';
        if (snippet.includes('marquee-updown')) return 'MARQUEE_UPDOWN';
        if (snippet.includes('marquee-leftright')) return 'MARQUEE_LEFTRIGHT';
        if (snippet.includes('carousel')) return 'CAROUSEL_SLIDER';

        return 'Unknown';
    }

    static getTypeId(typeName) {
        if (!typeName) return null;
        const normalized = typeName.toLowerCase().replace(/[_\- ]/g, '');
        const resolved = WidgetAliases[normalized] || typeName.toUpperCase().replace(/[- ]/g, '_');
        return WidgetTypeNames[resolved] ?? null;
    }

    static isSameType(typeA, typeB) {
        const resolve = (t) => {
            if (!t) return null;
            const n = t.toLowerCase().replace(/[_\- ]/g, '');
            return WidgetAliases[n] || t.toUpperCase().replace(/[- ]/g, '_');
        };
        return resolve(typeA) === resolve(typeB);
    }
}

module.exports = { WidgetDetector, WidgetTypeConstants, WidgetTypeNames, WidgetAliases, VALID_TYPE_IDS };