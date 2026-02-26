/**
 * HorizontalScrollHelper.js
 * Programmatically verifies horizontal scroll movement and row directions.
 */
class HorizontalScrollHelper {
    /**
     * Verifies horizontal scroll movement and row directions.
     * 
     * @param {import('playwright').Page|import('playwright').Frame} context - Playwright context
     * @param {import('playwright').Locator} widgetLocator - Locator for the marquee widget
     * @param {Object} config - Widget configuration (includes allow_cross_scrolling_animation)
     * @returns {Promise<Object>} - Verification results
     */
    static async interact(context, widgetLocator, config = {}) {
        console.log('[HorizontalScrollHelper] Starting horizontal movement verification & capture...');
        const screenshots = [];
        const page = context.page ? context.page() : context;

        try {
            // 🛡️ Prevent "Freezing": Move mouse to safe corner and force animations
            await page.mouse.move(0, 0);
            await page.addStyleTag({
                content: `
                    * { 
                        animation-play-state: running !important; 
                        transition-property: none !important;
                    }
                    *:hover { 
                        animation-play-state: running !important; 
                    }
                `
            }).catch(() => null);

            // Warmup: Scroll slightly to wake up rendering pipeline in headless
            await page.evaluate(() => window.scrollBy(0, 1));
            await page.waitForTimeout(100);
            await page.evaluate(() => window.scrollBy(0, -1));

            // 1️⃣ Identify rows - try common classes or containers with horizontal flow
            const rowSelectors = [
                '.feedspace-elements-wrapper',
                '.marquee-row',
                '.carousel_slider',
                '[class*="marquee_row"]',
                '[class*="elements-wrapper"]',
                '.marquee-container',
                '.feedspace-marquee-inner'
            ];

            let rows = context.locator(rowSelectors.join(', ')).filter({ visible: true });
            let rowCount = await rows.count();

            if (rowCount === 0) {
                console.log('[HorizontalScrollHelper] Primary row selectors failed. Searching for containers with >1 child (targeted)...');
                // Target containers that might be the scrolling wrapper
                const containers = context.locator('div, section, ul').filter({ visible: true });
                const count = await containers.count().catch(() => 0);

                for (let i = 0; i < Math.min(count, 50); i++) {
                    const candidate = containers.nth(i);
                    // Check if candidate is within the widget area
                    const isInside = await candidate.evaluate((el, widget) => {
                        return widget.contains(el) || el === widget;
                    }, await widgetLocator.elementHandle()).catch(() => true);

                    if (!isInside) continue;

                    const childCount = await candidate.locator('> *').count().catch(() => 0);
                    if (childCount > 1) {
                        // Check if children are side-by-side (approximate)
                        const box1 = await candidate.locator('> *').nth(0).boundingBox().catch(() => null);
                        const box2 = await candidate.locator('> *').nth(1).boundingBox().catch(() => null);

                        if (box1 && box2 && Math.abs(box1.y - box2.y) < 20 && Math.abs(box1.x - box2.x) > 20) {
                            rows = candidate;
                            rowCount = 1;
                            console.log(`[HorizontalScrollHelper] Fallback: Identified a row with ${childCount} items at index ${i}.`);
                            break;
                        }
                    }
                }
            }

            // 2️⃣ Capture Sequence (3 shots with 2s delay)
            console.log(`[HorizontalScrollHelper] Tracking ${rowCount} rows. Proceeding with 3 capture phases...`);

            // Phase 1
            const initialStates = rowCount > 0 ? await this.getPositions(rows) : null;
            if (initialStates) this.logPositions('Initial', initialStates);

            const buf1 = await widgetLocator.screenshot({ animations: 'disabled' }).catch(() => null);
            if (buf1) screenshots.push(buf1);

            await page.waitForTimeout(2000);

            // Phase 2
            const midStates = rowCount > 0 ? await this.getPositions(rows) : null;
            if (midStates) this.logPositions('Midway', midStates);

            const buf2 = await widgetLocator.screenshot({ animations: 'disabled' }).catch(() => null);
            if (buf2) screenshots.push(buf2);

            await page.waitForTimeout(2000);

            // Phase 3
            const finalStates = rowCount > 0 ? await this.getPositions(rows) : null;
            if (finalStates) this.logPositions('Final', finalStates);

            const buf3 = await widgetLocator.screenshot({ animations: 'disabled' }).catch(() => null);
            if (buf3) screenshots.push(buf3);

            // 3️⃣ Analysis Logic
            if (rowCount === 0) {
                return {
                    result: { status: 'UNKNOWN', message: 'No rows identified for programmatic tracking.' },
                    screenshots: screenshots
                };
            }

            const crossScrollingEnabled = config.horizontal_marquee_direction === 'alter' || config.allow_cross_scrolling_animation === '1';
            const rowResults = [];

            for (let i = 0; i < rowCount; i++) {
                const initial = initialStates[i];
                const final = finalStates[i];
                if (!initial || !final) continue;

                let totalShift = 0;
                let count = 0;
                for (const id in initial) {
                    if (final[id]) {
                        totalShift += (final[id].x - initial[id].x);
                        count++;
                    }
                }

                const avgShift = count > 0 ? totalShift / count : 0;
                const direction = avgShift > 1 ? 'RIGHT' : (avgShift < -1 ? 'LEFT' : 'STATIONARY');

                rowResults.push({ rowIndex: i, avgShift: avgShift, direction: direction });
                console.log(`[HorizontalScrollHelper] Row ${i}: Shift=${avgShift.toFixed(2)} -> ${direction}`);
            }

            let resultStatus = 'PASS';
            let message = '';

            if (rowCount >= 2) {
                const dir1 = rowResults[0].direction;
                const dir2 = rowResults[1].direction;
                const areOpposite = (dir1 === 'LEFT' && dir2 === 'RIGHT') || (dir1 === 'RIGHT' && dir2 === 'LEFT');

                if (crossScrollingEnabled) {
                    message = areOpposite ? 'Opposite row movement verified.' : `Failed: Rows moving in ${dir1 === dir2 ? 'SAME' : 'INCORRECT'} direction.`;
                    if (!areOpposite) resultStatus = 'FAIL';
                } else {
                    const areSame = (dir1 === dir2) && dir1 !== 'STATIONARY';
                    message = areSame ? 'Parallel row movement verified.' : 'Movement direction discrepancy detected.';
                    if (areOpposite) resultStatus = 'FAIL';
                }
            } else {
                const row = rowResults[0];
                if (row && row.direction === 'STATIONARY') {
                    resultStatus = 'FAIL';
                    message = 'No horizontal movement detected.';
                } else {
                    message = `Movement detected: ${row ? row.direction : 'UNKNOWN'}`;
                }
            }

            return { result: { status: resultStatus, message, details: rowResults }, screenshots };

        } catch (e) {
            console.warn(`[HorizontalScrollHelper] ERROR: ${e.message}`);
            return { result: { status: 'ERROR', message: e.message }, screenshots };
        }
    }

    /**
     * Helper to log positions for debugging
     */
    static logPositions(label, states) {
        states.forEach((row, i) => {
            const xPositions = Object.values(row).map(p => Math.round(p.x)).join(', ');
            console.log(`[HorizontalScrollHelper] ${label} positions (Row ${i}): [${xPositions}]`);
        });
    }

    /**
     * Gets horizontal positions of children in each row.
     */
    static async getPositions(rowsLocator) {
        const rowCount = await rowsLocator.count();
        const positions = [];
        for (let i = 0; i < rowCount; i++) {
            const row = rowsLocator.nth(i);
            const children = row.locator('> *');
            const childCount = await children.count();
            const rowMap = {};
            for (let j = 0; j < Math.min(5, childCount); j++) {
                const box = await children.nth(j).boundingBox();
                if (box) rowMap[j] = { x: box.x };
            }
            positions.push(rowMap);
        }
        return positions;
    }
}

module.exports = HorizontalScrollHelper;
