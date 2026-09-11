/**
 * reviewBadgeHelper.js
 * Review Badge (type 23): a row of cards, one per review source. With reviews-on-click on,
 * each card is a button that opens the shared review modal at that source's newest review,
 * with prev/next navigation through the source. Review dates, Read More and the branding
 * pill exist only inside that modal.
 */
const MotionFreeze = require('../motionFreeze');

const SOURCE = '[data-source-index]';
const CLICKABLE = '.feedspace-review-badge-card-clickable';
const OVERLAY = '.fs-modal-overlay';
const INNER = '.fs-modal-inner';
const CLOSE = '.fs-modal-close';
const NEXT = '[data-rb-nav-next]';
const COUNTER = '.feedspace-review-badge-nav-counter';
const MAX_SOURCES = 3;
// The shared modal fades in on the next frame and out over its exit animation.
const MODAL_ANIM_MS = 600;

class ReviewBadgeHelper {
    static async _click(locator) {
        await locator.click({ timeout: 3000 }).catch(() => locator.evaluate(el => el.click()).catch(() => { }));
    }

    static async _capture(context, target, label) {
        const frozen = await MotionFreeze.apply(context, `ReviewBadgeHelper:${label}`);
        try {
            return await target.screenshot({ animations: 'disabled' }).catch(() => null);
        } finally {
            await MotionFreeze.release(frozen, `ReviewBadgeHelper:${label}`);
        }
    }

    static async _counter(overlay) {
        const text = await overlay.locator(COUNTER).first().innerText().catch(() => '');
        return (text || '').replace(/\s+/g, '');
    }

    /**
     * Opens the modal for up to MAX_SOURCES source cards, pages once through the first,
     * and closes each modal before the next click.
     * @returns {Promise<Buffer[]>} screenshots of the open modal card
     */
    static async interact(context, widgetLocator, geometricWarnings = []) {
        console.log('[ReviewBadgeHelper] Starting source modal validation...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        try {
            const ownsCards = widgetLocator
                ? (await widgetLocator.locator(SOURCE).count().catch(() => 0)) > 0
                : false;
            const scope = ownsCards ? widgetLocator : context;
            const cards = scope.locator(CLICKABLE).filter({ visible: true });
            const total = await cards.count().catch(() => 0);

            if (total === 0) {
                console.log('[ReviewBadgeHelper] Cards are not clickable (reviews-on-click is off).');
                geometricWarnings.push('DOM_TRUTH: This Review Badge has reviews-on-click turned off, so its cards open no modal. Report modal-only features (review date, Read More, Feedspace branding) NOT_APPLICABLE.');
                return screenshots;
            }

            let opened = 0;
            for (let i = 0; i < Math.min(total, MAX_SOURCES); i++) {
                if (page.isClosed()) break;
                const card = cards.nth(i);
                const label = ((await card.getAttribute('aria-label').catch(() => '')) || `source ${i + 1}`).trim();

                await card.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                await this._click(card);
                await page.waitForTimeout(MODAL_ANIM_MS);

                // The modal renders inside the widget's own shadow root, hidden until opened.
                const overlay = scope.locator(OVERLAY).filter({ visible: true }).first();
                if (!(await overlay.isVisible().catch(() => false))) {
                    console.warn(`[ReviewBadgeHelper] No modal opened for "${label}".`);
                    continue;
                }

                const inner = overlay.locator(INNER).first();
                const counter = await this._counter(overlay);
                const shot = await this._capture(context, inner, `source-${i + 1}`);
                if (shot) {
                    screenshots.push(shot);
                    opened++;
                }
                console.log(`[ReviewBadgeHelper] Modal open for "${label}"${counter ? ` at ${counter}` : ''}.`);

                // Page once through the first source to prove the navigation works.
                if (i === 0) {
                    const next = overlay.locator(NEXT).first();
                    if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) {
                        await this._click(next);
                        await page.waitForTimeout(400);
                        const after = await this._counter(overlay);
                        const navShot = await this._capture(context, inner, 'source-1-next');
                        if (navShot) screenshots.push(navShot);
                        if (after && after !== counter) {
                            geometricWarnings.push(`DOM_TRUTH: The Review Badge modal's next button advanced from ${counter} to ${after}.`);
                        }
                        console.log(`[ReviewBadgeHelper] Next review: ${counter || '?'} -> ${after || '?'}.`);
                    }
                }

                const close = overlay.locator(CLOSE).first();
                if (await close.isVisible().catch(() => false)) await this._click(close);
                else await page.keyboard.press('Escape').catch(() => { });
                await page.waitForTimeout(MODAL_ANIM_MS);
                if (await overlay.isVisible().catch(() => false)) {
                    await page.keyboard.press('Escape').catch(() => { });
                    await page.waitForTimeout(MODAL_ANIM_MS);
                }
                console.log(`[ReviewBadgeHelper] Modal ${(await overlay.isVisible().catch(() => false)) ? 'is still OPEN' : 'closed'} after "${label}".`);
            }

            if (opened > 0) {
                geometricWarnings.push(`DOM_TRUTH: ${screenshots.length} screenshot(s) show this Review Badge's review MODAL, opened by clicking a source card: one review card with a "<current>/<total>" navigation strip, and the Feedspace branding pill below it unless branding is hidden. Judge review date, Read More and Feedspace branding in those screenshots.`);
            } else {
                geometricWarnings.push('DOM_TRUTH: The test harness could not open this Review Badge modal, so no modal screenshot exists. Report modal-only features (review date, Read More, Feedspace branding) NOT_APPLICABLE.');
            }
        } catch (error) {
            console.warn(`[ReviewBadgeHelper] Interaction Error: ${error.message}`);
        }

        return screenshots;
    }
}

module.exports = ReviewBadgeHelper;
