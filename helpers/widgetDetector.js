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
    11: 'FLOATING_TOAST'
};

const WidgetTypeNames = {
    CAROUSEL_SLIDER: 4,
    MASONRY: 5,
    MARQUEE_STRIPE: 6,
    AVATAR_GROUP: 7,
    SINGLE_SLIDER: 8,
    MARQUEE_UPDOWN: 9,
    MARQUEE_LEFTRIGHT: 10,
    FLOATING_TOAST: 11
};

// FIX: Frontend alias terms that map to backend constants
// MARQUEE_STRIPE (backend) === STRIP_SLIDER (frontend)
const WidgetAliases = {
    'stripslider': 'MARQUEE_STRIPE',
    'strip_slider': 'MARQUEE_STRIPE',
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
    'marqueestripe': 'MARQUEE_STRIPE'
};

// CSS class signatures mapped to widget types
// FIX: Use exact class tokens instead of loose .includes() to avoid false positives
const CSS_SIGNATURES = [
    { classes: ['feedspace-vertical-scroll', 'feedspace-updown', 'vertical-marquee'], type: 'MARQUEE_UPDOWN' },
    { classes: ['fe-feedspace-avatar-group-widget-wrap', 'feedspace-avatar-group'], type: 'AVATAR_GROUP' },
    { classes: ['feedspace-carousel-widget', 'testimonial-slider', 'carousel_slider'], type: 'CAROUSEL_SLIDER' },
    { classes: ['feedspace-marque-main-wrap', 'strip-slider'], type: 'MARQUEE_STRIPE' },
    { classes: ['feedspace-floating-widget', 'fe-floating-toast', 'fe-toast-card', 'fe-chat-bubble'], type: 'FLOATING_TOAST' },
    { classes: ['feedspace-element-horizontal-scroll-widget', 'feedspace-left-right-shadow'], type: 'MARQUEE_LEFTRIGHT' },
    { classes: ['feedspace-single-review-widget', 'single-slider', 'feedspace-single-slider'], type: 'SINGLE_SLIDER' },
    { classes: ['fe-masonry', 'feedspace-masonry', 'masonry-widget'], type: 'MASONRY' }
];

class WidgetDetector {

    /**
     * Identify widget type from a config object (API response).
     * Supports: widget_type_id (int), type (int or string name).
     */
    static identify(config) {
        if (!config) return 'Unknown';

        const raw = config.widget_type_id ?? config.type;
        if (raw === null || raw === undefined) return 'Unknown';

        // FIX: Explicit numeric parse — no implicit JS coercion
        const numericId = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!isNaN(numericId) && WidgetTypeConstants[numericId]) {
            return WidgetTypeConstants[numericId];
        }

        // String name resolution
        if (typeof raw === 'string') {
            const normalized = raw.toLowerCase().replace(/[_\- ]/g, '');

            // Direct alias lookup (covers frontend terms like 'strip_slider')
            if (WidgetAliases[normalized]) return WidgetAliases[normalized];

            // Check against constant values (e.g. 'CAROUSEL_SLIDER')
            const upperRaw = raw.toUpperCase().replace(/[- ]/g, '_');
            if (WidgetTypeNames[upperRaw] !== undefined) return upperRaw;
        }

        return 'Unknown';
    }

    /**
     * Discover widget type from a live Playwright locator.
     * Priority: data attribute ID → data attribute name → CSS class signatures
     * FIX: Explicit numeric parse, timeout guard, word-boundary CSS matching, SINGLE_SLIDER added
     */
    static async discover(locator) {
        if (!locator) return 'Unknown';

        let info = null;

        try {
            info = await Promise.race([
                locator.evaluate(async (el) => {
                    const getAttr = (element) =>
                        element.getAttribute('data-widget-type') ||
                        element.getAttribute('widget_type_id') ||
                        element.getAttribute('data-type') ||
                        element.getAttribute('data-feedspace-type') ||
                        element.getAttribute('data-id');

                    // 1. Search UPWARDS for any widget identifier
                    let current = el;
                    let id = null;
                    while (current && current !== document.body) {
                        id = getAttr(current);
                        if (id) break;
                        current = current.parentElement;
                    }

                    // 2. IFrame handling - if this is an iframe, check its content (if accessible)
                    if (!id && el.tagName.toLowerCase() === 'iframe') {
                        try {
                            const doc = el.contentDocument || el.contentWindow.document;
                            const innerWidget = doc.querySelector('[data-widget-type], [widget_type_id], [data-type], [data-feedspace-type], [data-id]');
                            if (innerWidget) id = getAttr(innerWidget);
                        } catch (e) { /* ignore cross-origin errors */ }
                    }

                    // 3. Search DOWNWARDS if still not found
                    if (!id) {
                        const child = el.querySelector('[data-widget-type], [widget_type_id], [data-type], [data-feedspace-type], [data-id]');
                        if (child) id = getAttr(child);
                    }

                    // 4. Anchor check: is this a Feedspace widget based on common inner box classes?
                    const isFeedspaceAnchor = !!(
                        el.querySelector('.feedspace-element-feed-box-wrap, .fe-review-card, .feedspace-element-inner, .feedspace-element-grid') ||
                        el.classList.contains('feedspace-embed') ||
                        el.classList.contains('feedspace-widget')
                    );

                    // Collect classes for fallback
                    const collectClasses = (element) => {
                        const cls = (element.className && typeof element.className === 'string')
                            ? element.className : '';
                        return cls;
                    };

                    const ownClasses = collectClasses(el);
                    const parentClasses = el.parentElement ? collectClasses(el.parentElement) : '';
                    const childClasses = Array.from(el.children)
                        .slice(0, 5)
                        .map(c => collectClasses(c))
                        .join(' ');

                    const allClasses = `${parentClasses} ${ownClasses} ${childClasses}`.toLowerCase().trim();
                    const htmlSnippet = el.innerHTML ? el.innerHTML.toLowerCase().substring(0, 800) : '';

                    return { idAttr: id, allClasses, htmlSnippet, isFeedspaceAnchor };
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('locator.evaluate() timed out after 5s')), 5000)
                )
            ]);
        } catch (e) {
            console.warn(`[WidgetDetector] discover() evaluation failed: ${e.message}`);
            return 'Unknown';
        }

        if (!info) return 'Unknown';

        // ── PRIORITY 1: ID Attribute (Numeric or String) ─────────────────────
        if (info.idAttr !== null && info.idAttr !== undefined) {
            const numericId = parseInt(info.idAttr, 10);
            if (!isNaN(numericId) && WidgetTypeConstants[numericId]) {
                return WidgetTypeConstants[numericId];
            }

            const normalizedAttr = info.idAttr.toLowerCase().replace(/[_\- ]/g, '');
            if (WidgetAliases[normalizedAttr]) return WidgetAliases[normalizedAttr];

            const upperAttr = info.idAttr.toUpperCase().replace(/[- ]/g, '_');
            if (WidgetTypeNames[upperAttr] !== undefined) return upperAttr;
        }

        // ── PRIORITY 2: CSS Signature Fallback ───────────────────────────────
        const hasClass = (classString, token) => {
            return new RegExp(`(^|\\s)${token}(\\s|$)`).test(classString);
        };

        const classes = info.allClasses;

        for (const signature of CSS_SIGNATURES) {
            for (const cls of signature.classes) {
                if (hasClass(classes, cls)) {
                    return signature.type;
                }
            }
        }

        // ── PRIORITY 3: Anchor-Based Fallback (if it looks like Feedspace) ───
        if (info.isFeedspaceAnchor) {
            // If it's a Feedspace element but we don't know the type,
            // guess based on common keywords in classes/html
            const html = info.htmlSnippet;
            if (html.includes('vertical-scroll') || html.includes('updown')) return 'MARQUEE_UPDOWN';
            if (html.includes('horizontal-scroll') || html.includes('left-right')) return 'MARQUEE_LEFTRIGHT';
            if (html.includes('carousel')) return 'CAROUSEL_SLIDER';
            if (html.includes('strip-slider')) return 'MARQUEE_STRIPE';

            // Default anchor guess for scrolling widgets
            return 'MARQUEE_UPDOWN';
        }

        // ── PRIORITY 4: HTML Snippet Fallback ────────────────────────────────
        const html = info.htmlSnippet;
        if (html.includes('feedspace-vertical-scroll') || html.includes('updown')) return 'MARQUEE_UPDOWN';
        if (html.includes('feedspace-marque') || html.includes('strip-slider')) return 'MARQUEE_STRIPE';
        if (html.includes('carousel')) return 'CAROUSEL_SLIDER';
        if (html.includes('masonry')) return 'MASONRY';
        if (html.includes('floating-toast') || html.includes('fe-toast')) return 'FLOATING_TOAST';
        if (html.includes('horizontal-scroll') || html.includes('left-right')) return 'MARQUEE_LEFTRIGHT';
        if (html.includes('single-slider') || html.includes('single-review')) return 'SINGLE_SLIDER';
        if (html.includes('avatar-group')) return 'AVATAR_GROUP';

        return 'Unknown';
    }

    /**
     * Get the numeric type ID from a widget type name.
     * Supports both backend and frontend (alias) names.
     */
    static getTypeId(typeName) {
        if (!typeName) return null;
        const normalized = typeName.toLowerCase().replace(/[_\- ]/g, '');
        const resolved = WidgetAliases[normalized] || typeName.toUpperCase().replace(/[- ]/g, '_');
        return WidgetTypeNames[resolved] ?? null;
    }

    /**
     * Check if two type strings refer to the same widget
     * (handles backend/frontend alias equivalence).
     */
    static isSameType(typeA, typeB) {
        const resolve = (t) => {
            if (!t) return null;
            const n = t.toLowerCase().replace(/[_\- ]/g, '');
            return WidgetAliases[n] || t.toUpperCase().replace(/[- ]/g, '_');
        };
        return resolve(typeA) === resolve(typeB);
    }
}

module.exports = { WidgetDetector, WidgetTypeConstants, WidgetTypeNames, WidgetAliases };