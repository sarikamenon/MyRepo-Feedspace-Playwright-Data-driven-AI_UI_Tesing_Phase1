/**
 * floatingBadgeHelper.js
 * Floating Badge (type 22): a fixed rating bar that, on click, grows an in-place scrolling
 * panel of review cards above itself. The collapsed bar renders no review at all, so until
 * the panel is opened every per-review feature can only be reported NOT_APPLICABLE.
 */
const MotionFreeze = require('../motionFreeze');

const EXPANDABLE = '[data-badge-expandable]';
const TOGGLE = '[data-badge-toggle]';
const PANEL = '[data-badge-panel]';
const REVIEWS = '.feedspace-floating-badge-reviews';
const CARD = '.feedspace-floating-badge-reviews .feedspace-element-feed-box';
const EMPTY = '.feedspace-floating-badge-empty';
const READ_MORE = '.feedspace-floating-badge-reviews .feedspace-read-more-btn';
// Opening runs two staggered 0.2s phases (width, then the panel rows), and closing reverses
// them before the widget hides the panel at 440ms. Wait past both.
const PANEL_ANIM_MS = 700;

class FloatingBadgeHelper {
    static async _click(locator) {
        await locator.click({ timeout: 3000 }).catch(() => locator.evaluate(el => el.click()).catch(() => { }));
    }

    static async _isOpen(toggle, panel) {
        const expanded = await toggle.getAttribute('aria-expanded').catch(() => null);
        return expanded === 'true' && await panel.isVisible().catch(() => false);
    }

    static async _capture(context, surface, label) {
        const frozen = await MotionFreeze.apply(context, `FloatingBadgeHelper:${label}`);
        try {
            return await surface.screenshot({ animations: 'disabled' }).catch(() => null);
        } finally {
            await MotionFreeze.release(frozen, `FloatingBadgeHelper:${label}`);
        }
    }

    /** Title case, so an all-caps reviewer name cannot spell FAIL_, CUT or PARTIAL for the forced-FAIL filter. */
    static _safeName(name) {
        return String(name || '').trim().slice(0, 40).split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    }

    /** Reviewer names on the cards the list's scroll window cuts at its top or bottom edge. */
    static async _edgeCards(scope) {
        return scope.locator(REVIEWS).first().evaluate((list, { card, name }) => {
            const box = list.getBoundingClientRect();
            const straddles = r => (r.top < box.top - 1 && r.bottom > box.top + 1)
                || (r.top < box.bottom - 1 && r.bottom > box.bottom + 1);
            return [...list.querySelectorAll(card)]
                .filter(el => straddles(el.getBoundingClientRect()))
                .map(el => (el.querySelector(name)?.textContent || '').trim())
                .filter(Boolean);
        }, { card: '.feedspace-element-feed-box', name: '.feedspace-element-bio-name' }).catch(() => []);
    }

    /**
     * The scroll-edge fact. cutByShot pairs a screenshot label with the reviewer names on the
     * cards its scroll window cuts. Naming them stops the model calling a cut that runs through
     * the review text "truncation within the visible card area".
     */
    static _scrollEdgeFact(edge, cutByShot = []) {
        const named = cutByShot
            .filter(([, names]) => names.length)
            .map(([shot, names]) => `${names.map(n => this._safeName(n)).join(' and ')} in ${shot}`);
        return `DOM_TRUTH_PANEL_SCROLL_EDGE: The review list in the open panel scrolls (${edge.scrollHeight}px of cards in a ${edge.clientHeight}px window) and ends at the top edge of the rating bar, with nothing drawn over it (measured in the DOM). Its top and bottom edges are scroll edges: a card straddling one is partly outside the window, not covered, overlapped or truncated. `
            + (named.length ? `Cards straddling an edge: ${named.join('; ')}. Text cut on those cards, wherever the cut falls in the review, is scroll clipping. ` : '')
            + 'Do not report overlap, blockage, slicing or truncation for them.';
    }

    /**
     * Opens the panel, captures it (plus a Read More expansion and a scrolled view when
     * available), then closes it so later steps see the resting badge again.
     * @returns {Promise<Buffer[]>} screenshots of the OPEN badge, bar and panel together
     */
    static async interact(context, widgetLocator, geometricWarnings = []) {
        console.log('[FloatingBadgeHelper] Starting review panel validation...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        try {
            // The badge portals into a body-level shadow root outside the embed container.
            // Playwright CSS pierces open shadow roots, so the whole context can reach it.
            const ownsToggle = widgetLocator
                ? (await widgetLocator.locator(TOGGLE).count().catch(() => 0)) > 0
                : false;
            const scope = ownsToggle ? widgetLocator : context;
            const toggle = scope.locator(TOGGLE).first();

            if (!(await toggle.isVisible().catch(() => false))) {
                console.log('[FloatingBadgeHelper] Badge is not expandable (reviews-on-click is off).');
                geometricWarnings.push('DOM_TRUTH: This Floating Badge is not expandable (reviews-on-click is off), so it has no review panel. Report per-review features NOT_APPLICABLE.');
                return screenshots;
            }

            // The bar and its panel share one fixed element. When the locator already IS that
            // element it has no expandable descendant.
            const surface = (await scope.locator(EXPANDABLE).count().catch(() => 0)) > 0
                ? scope.locator(EXPANDABLE).filter({ visible: true }).first()
                : scope;
            const panel = scope.locator(PANEL).first();

            await this._click(toggle);
            await page.waitForTimeout(PANEL_ANIM_MS);
            if (!(await this._isOpen(toggle, panel))) {
                console.warn('[FloatingBadgeHelper] The review panel did not open.');
                geometricWarnings.push('DOM_TRUTH: The test harness could not open this Floating Badge review panel, so no panel screenshot exists. Report per-review features NOT_APPLICABLE.');
                return screenshots;
            }

            const cardCount = await scope.locator(CARD).count().catch(() => 0);
            const isEmpty = await scope.locator(EMPTY).isVisible().catch(() => false);
            console.log(`[FloatingBadgeHelper] Panel OPEN with ${cardCount} review card(s)${isEmpty ? ' (empty state)' : ''}.`);

            const box = await surface.boundingBox().catch(() => null);
            if (box && box.y < -2) {
                geometricWarnings.push(`ADVISORY: The open Floating Badge panel extends ${Math.round(-box.y)}px above the top of the viewport.`);
            }

            const openShot = await this._capture(context, surface, 'open');
            if (openShot) screenshots.push(openShot);

            if (isEmpty || cardCount === 0) {
                geometricWarnings.push('DOM_TRUTH: The Floating Badge panel was opened and shows its "no reviews yet" empty state: the source has no reviews to list. Report per-review features NOT_APPLICABLE.');
            } else {
                geometricWarnings.push(`DOM_TRUTH: This Floating Badge was clicked open for the screenshots that show a list of review cards above the rating bar (${cardCount} card(s) loaded). Judge per-review features (ratings, platform icons, review dates, Read More) in those screenshots. A truncated review expands in place; the panel has no modal.`);

                // The list scrolls in a window that ends at the bar, so the card at its bottom
                // edge is always cut. Gemini read that as the bar covering the panel; measure it.
                const edge = await scope.locator(REVIEWS).first().evaluate(list => {
                    const box = list.getBoundingClientRect();
                    const x = Math.round((box.left + box.right) / 2);
                    const root = list.getRootNode();
                    const above = root.elementFromPoint(x, Math.floor(box.bottom) - 2);
                    const below = root.elementFromPoint(x, Math.ceil(box.bottom) + 6);
                    return {
                        scrollHeight: list.scrollHeight,
                        clientHeight: list.clientHeight,
                        uncovered: Boolean(above) && list.contains(above),
                        endsThere: Boolean(below) && !list.contains(below)
                    };
                }).catch(() => null);
                const listClear = Boolean(edge && edge.scrollHeight > edge.clientHeight + 1 && edge.uncovered && edge.endsThere);
                const cutByShot = [['the first open-panel screenshot', openShot ? await this._edgeCards(scope) : []]];

                const readMore = scope.locator(READ_MORE).filter({ visible: true }).first();
                if (await readMore.isVisible().catch(() => false)) {
                    await this._click(readMore);
                    await page.waitForTimeout(400);
                    const shot = await this._capture(context, surface, 'read-more');
                    if (shot) {
                        screenshots.push(shot);
                        cutByShot.push(['the Read More screenshot', await this._edgeCards(scope)]);
                    }
                    console.log('[FloatingBadgeHelper] Expanded one review with Read More.');
                }

                const scrolled = await scope.locator(REVIEWS).first().evaluate(el => {
                    const before = el.scrollTop;
                    el.scrollTop = before + el.clientHeight;
                    return el.scrollTop > before;
                }).catch(() => false);
                if (scrolled) {
                    // Lets lazy media load and the next chunk of cards append.
                    await page.waitForTimeout(500);
                    const shot = await this._capture(context, surface, 'scrolled');
                    if (shot) {
                        screenshots.push(shot);
                        cutByShot.push(['the scrolled screenshot', await this._edgeCards(scope)]);
                    }
                    console.log('[FloatingBadgeHelper] Scrolled the review list.');
                }

                if (listClear) {
                    const cut = cutByShot.map(([, names]) => names.join(', ') || 'none').join(' | ');
                    console.log(`[FloatingBadgeHelper] Review list scrolls and ends at the bar; nothing covers it. Cards cut per screenshot: ${cut}`);
                    geometricWarnings.push(this._scrollEdgeFact(edge, cutByShot));
                }
            }

            await this._click(toggle);
            await page.waitForTimeout(PANEL_ANIM_MS);
            if (await this._isOpen(toggle, panel)) {
                await page.keyboard.press('Escape').catch(() => { });
                await page.waitForTimeout(PANEL_ANIM_MS);
            }
            console.log(`[FloatingBadgeHelper] Panel ${(await this._isOpen(toggle, panel)) ? 'is still OPEN' : 'closed'} after interaction.`);
        } catch (error) {
            console.warn(`[FloatingBadgeHelper] Interaction Error: ${error.message}`);
        }

        return screenshots;
    }
}

module.exports = FloatingBadgeHelper;
