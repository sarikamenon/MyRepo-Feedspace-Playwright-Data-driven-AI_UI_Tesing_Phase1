/**
 * Freezes CSS motion before a screenshot.
 *
 * Playwright's `animations: 'disabled'` finishes or cancels animations rather than
 * holding them still. For an INFINITE marquee or auto-advancing carousel that leaves
 * the track at an arbitrary offset, so a slide can be captured mid-transit and then
 * reported as a clipped or partially visible card.
 *
 * Pauses rather than removes, so the widget's laid-out geometry is preserved.
 */
const FREEZE_CSS = `
    *, *::before, *::after {
        animation-play-state: paused !important;
        transition: none !important;
        -webkit-transition: none !important;
        scroll-behavior: auto !important;
    }
`;

const FREEZE_MARKER = 'data-fs-motion-freeze';

class MotionFreeze {
    /**
     * Feedspace widgets render inside an open shadow root, and a document-level
     * <style> does not cross that boundary: `animation-play-state` is not an
     * inherited property, so a page-level rule never reaches the marquee track.
     * The freeze therefore has to be injected into every shadow root as well as
     * the document.
     */
    static async _injectIntoShadowRoots(page, css, marker) {
        return page.evaluate(({ css, marker }) => {
            let count = 0;
            const seen = new Set();

            const visit = (root) => {
                if (!root || seen.has(root)) return;
                seen.add(root);

                if (root instanceof ShadowRoot) {
                    const style = document.createElement('style');
                    style.setAttribute(marker, '');
                    style.textContent = css;
                    root.appendChild(style);
                    count++;
                }

                const scope = root instanceof ShadowRoot ? root : (root.body || root);
                scope.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) visit(el.shadowRoot);
                });
            };

            visit(document);
            return count;
        }, { css, marker }).catch(() => 0);
    }

    static async apply(context, label = 'MotionFreeze') {
        if (!context || typeof context.addStyleTag !== 'function') {
            console.warn(`[${label}] Context cannot accept a style tag; motion not frozen.`);
            return null;
        }

        const handle = await context.addStyleTag({ content: FREEZE_CSS }).catch(e => {
            console.warn(`[${label}] Failed to inject motion freeze: ${e.message}`);
            return null;
        });

        const page = typeof context.page === 'function' ? context.page() : context;
        const shadowCount = await this._injectIntoShadowRoots(page, FREEZE_CSS, FREEZE_MARKER);

        if (handle || shadowCount > 0) {
            console.log(`[${label}] Motion frozen for capture (document${shadowCount > 0 ? ` + ${shadowCount} shadow root(s)` : ', no shadow root found'}).`);
        }
        return { handle, page, shadowCount };
    }

    static async release(frozen, label = 'MotionFreeze') {
        if (!frozen) return;

        if (frozen.handle) await frozen.handle.evaluate(el => el.remove()).catch(() => { });

        if (frozen.page && frozen.shadowCount > 0) {
            await frozen.page.evaluate((marker) => {
                const seen = new Set();
                const visit = (root) => {
                    if (!root || seen.has(root)) return;
                    seen.add(root);
                    if (root instanceof ShadowRoot) {
                        root.querySelectorAll(`style[${marker}]`).forEach(s => s.remove());
                    }
                    const scope = root instanceof ShadowRoot ? root : (root.body || root);
                    scope.querySelectorAll('*').forEach(el => {
                        if (el.shadowRoot) visit(el.shadowRoot);
                    });
                };
                visit(document);
            }, FREEZE_MARKER).catch(() => { });
        }

        console.log(`[${label}] Motion freeze released.`);
    }
}

module.exports = MotionFreeze;
