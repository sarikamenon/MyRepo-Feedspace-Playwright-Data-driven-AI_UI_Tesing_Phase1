const fs = require('fs');
const path = require('path');

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
    'AVATAR_BLOCK': 'avatarBlockFeature',
    'FLOATING_BADGE': 'floatingBadgeFeature',
    'REVIEW_BADGE': 'reviewBadgeFeature',
    'REVIEW_AND_RATINGS': 'reviewAndRatingsFeature'
};

class WidgetConfigLoader {
    static resolvePath(widgetType) {
        if (!widgetType || widgetType === 'Unknown' || widgetType === '--url') return null;
        const configName = WIDGET_CONFIG_MAP[widgetType] || String(widgetType).toLowerCase();
        return path.join(process.cwd(), 'Configs', `${configName}.json`);
    }

    static load(widgetType) {
        const configPath = this.resolvePath(widgetType);
        if (!configPath || !fs.existsSync(configPath)) return null;
        try {
            const raw = fs.readFileSync(configPath, 'utf8').trim();
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn(`[WidgetConfigLoader] Failed to parse config for ${widgetType}: ${e.message}`);
            return null;
        }
    }

    /**
     * Features the widget supports but renders only inside its popover/popup,
     * never on the resting surface. Checking these against a resting-state
     * screenshot always yields a false "configured but absent" failure.
     */
    static popoverOnlyFeatures(widgetType) {
        const config = this.load(widgetType);
        const list = config && config.popover_only_features;
        return Array.isArray(list) ? list : [];
    }

    /**
     * Features the widget does not implement at all. These must never be audited:
     * asking for a Load More button on a badge, or a review date on a logo strip,
     * produces a "configured but absent" failure against a widget that was never
     * built to render it.
     */
    static unsupportedFeatures(widgetType) {
        const config = this.load(widgetType);
        const list = config && config.unsupported_features;
        return Array.isArray(list) ? list : [];
    }

    /**
     * True when the resting surface shows aggregates (a score, a star row, a count)
     * rather than individual review cards. Per-review checks do not apply to it.
     */
    static isAggregateSurface(widgetType) {
        const config = this.load(widgetType);
        return Boolean(config && config.aggregate_surface);
    }

    static surfaceNote(widgetType) {
        const config = this.load(widgetType);
        return (config && config.surface_note) || '';
    }
}

module.exports = WidgetConfigLoader;
module.exports.WIDGET_CONFIG_MAP = WIDGET_CONFIG_MAP;
