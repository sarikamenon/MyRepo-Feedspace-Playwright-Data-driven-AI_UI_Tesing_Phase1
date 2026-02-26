/**
 * VerticalScrollHelper.js
 * Programmatically verifies vertical scroll movement and column directions.
 */
class VerticalScrollHelper {
    /**
     * Verifies vertical scroll movement and column directions.
     * 
     * @param {import('playwright').Page|import('playwright').Frame} context - Playwright context
     * @param {import('playwright').Locator} widgetLocator - Locator for the marquee widget
     * @param {Object} config - Widget configuration (includes allow_cross_scrolling_animation)
     * @returns {Promise<Object>} - Verification results
     */
    static async interact(context, widgetLocator, config = {}) {
        console.log('[VerticalScrollHelper] Starting vertical movement verification & capture...');
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

            // 1️⃣ Identify Columns - try common classes or containers with vertical flow
            let columns = widgetLocator.locator('.feedspace-elements-wrapper, .marquee-column, [class*="vertical_scroll"], [class*="elements-wrapper"]').filter({ visible: true });
            let columnCount = await columns.count();

            if (columnCount === 0) {
                console.log('[VerticalScrollHelper] Primary column selectors failed. Searching for containers with >3 children...');
                const potentialCols = widgetLocator.locator('div, section, ul').filter({ has: context.locator('> *') });
                const pcCount = await potentialCols.count();
                for (let i = 0; i < pcCount; i++) {
                    const childCount = await potentialCols.nth(i).locator('> *').count();
                    if (childCount > 3) {
                        columns = potentialCols.nth(i);
                        columnCount = 1;
                        console.log(`[VerticalScrollHelper] Fallback: Identified a column with ${childCount} items.`);
                        break;
                    }
                }
            }

            // 2️⃣ Capture Sequence (3 shots with 2s delay)
            console.log(`[VerticalScrollHelper] Tracking ${columnCount} columns. Proceeding with 3 capture phases...`);

            // Phase 1
            const initialStates = columnCount > 0 ? await this.getPositions(columns) : null;
            if (initialStates) this.logPositions('Initial', initialStates);

            const buf1 = await widgetLocator.screenshot({ animations: 'allow' }).catch(() => null);
            if (buf1) screenshots.push(buf1);

            await page.waitForTimeout(2000);

            // Phase 2
            const midStates = columnCount > 0 ? await this.getPositions(columns) : null;
            if (midStates) this.logPositions('Midway', midStates);

            const buf2 = await widgetLocator.screenshot({ animations: 'allow' }).catch(() => null);
            if (buf2) screenshots.push(buf2);

            await page.waitForTimeout(2000);

            // Phase 3
            const finalStates = columnCount > 0 ? await this.getPositions(columns) : null;
            if (finalStates) this.logPositions('Final', finalStates);

            const buf3 = await widgetLocator.screenshot({ animations: 'allow' }).catch(() => null);
            if (buf3) screenshots.push(buf3);

            // 3️⃣ Analysis Logic
            if (columnCount === 0) {
                return {
                    result: { status: 'UNKNOWN', message: 'No columns identified for programmatic tracking.' },
                    screenshots: screenshots
                };
            }

            const crossScrollingEnabled = config.marquee_direction === 'alter' || config.allow_cross_scrolling_animation === '1';
            const colResults = [];

            for (let i = 0; i < columnCount; i++) {
                const initial = initialStates[i];
                const final = finalStates[i];
                if (!initial || !final) continue;

                let totalShift = 0;
                let count = 0;
                for (const id in initial) {
                    if (final[id]) {
                        totalShift += (final[id].y - initial[id].y);
                        count++;
                    }
                }

                const avgShift = count > 0 ? totalShift / count : 0;
                const direction = avgShift > 1 ? 'DOWN' : (avgShift < -1 ? 'UP' : 'STATIONARY');

                colResults.push({ colIndex: i, avgShift: avgShift, direction: direction });
                console.log(`[VerticalScrollHelper] Column ${i}: Shift=${avgShift.toFixed(2)} -> ${direction}`);
            }

            let resultStatus = 'PASS';
            let message = '';

            if (columnCount >= 2) {
                const dir1 = colResults[0].direction;
                const dir2 = colResults[1].direction;
                const areOpposite = (dir1 === 'UP' && dir2 === 'DOWN') || (dir1 === 'DOWN' && dir2 === 'UP');

                if (crossScrollingEnabled) {
                    message = areOpposite ? 'Opposite column movement verified (Cross-Scroll)' : `Failed: Columns moving in ${dir1 === dir2 ? 'SAME' : 'INCORRECT'} direction.`;
                    if (!areOpposite) resultStatus = 'FAIL';
                } else {
                    const areSame = (dir1 === dir2) && dir1 !== 'STATIONARY';
                    message = areSame ? 'Parallel column movement verified.' : 'Movement direction discrepancy detected.';
                    if (areOpposite) resultStatus = 'FAIL';
                }
            } else {
                const col = colResults[0];
                if (col && col.direction === 'STATIONARY') {
                    resultStatus = 'FAIL';
                    message = 'No vertical movement detected.';
                } else {
                    message = `Movement detected: ${col ? col.direction : 'UNKNOWN'}`;
                }
            }

            return { result: { status: resultStatus, message, details: colResults }, screenshots };

        } catch (e) {
            console.warn(`[VerticalScrollHelper] ERROR: ${e.message}`);
            return { result: { status: 'ERROR', message: e.message }, screenshots };
        }
    }

    /**
     * Helper to log positions for debugging
     */
    static logPositions(label, states) {
        states.forEach((col, i) => {
            const yPositions = Object.values(col).map(p => Math.round(p.y)).join(', ');
            console.log(`[VerticalScrollHelper] ${label} positions (Col ${i}): [${yPositions}]`);
        });
    }

    /**
     * Gets vertical positions of children in each column.
     */
    static async getPositions(columnsLocator) {
        const colCount = await columnsLocator.count();
        const positions = [];
        for (let i = 0; i < colCount; i++) {
            const col = columnsLocator.nth(i);
            const children = col.locator('> *');
            const childCount = await children.count();
            const colMap = {};
            for (let j = 0; j < Math.min(5, childCount); j++) {
                const box = await children.nth(j).boundingBox();
                if (box) colMap[j] = { y: box.y };
            }
            positions.push(colMap);
        }
        return positions;
    }
}

module.exports = VerticalScrollHelper;
