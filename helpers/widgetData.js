/**
 * Shared reading of a widget's `widget_data` payload.
 *
 * The empty-widget rule is used both before rendering (checkReachability in
 * playwrightHelper.js) and after the model answers (processResults in aiEngine.js).
 * It lives here so the two cannot drift apart.
 */

/** Every list a widget may carry its reviews in. Not all widgets use the same one. */
const REVIEW_LISTS = ['feeds', 'feeds_data', 'badge_sources'];

/**
 * True when the widget has nothing to render.
 *
 * Empty only when EVERY review-bearing list present is empty. The Review Badge ships
 * `feeds_data: []` beside a populated `feeds` and `badge_sources`, so the old rule
 * ("any list empty") failed every Review Badge as an empty state before it rendered.
 * A payload carrying none of these lists is not assumed empty.
 */
function isEmptyWidgetData(widgetData) {
    if (!widgetData) return true;
    if (typeof widgetData !== 'object') return false;
    if (Object.keys(widgetData).length === 0) return true;

    const lists = REVIEW_LISTS.map(key => widgetData[key]).filter(Array.isArray);
    return lists.length > 0 && lists.every(list => list.length === 0);
}

module.exports = { REVIEW_LISTS, isEmptyWidgetData };
