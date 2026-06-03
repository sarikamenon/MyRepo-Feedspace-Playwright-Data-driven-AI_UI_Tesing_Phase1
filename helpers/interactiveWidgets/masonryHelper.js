const { WidgetDetector } = require('../widgetDetector');

class MasonryHelper {
    /**
     * Masonry Interaction Delegate:
     * Takes 4 full-length screenshots to avoid clipping, clicking 'Load More' 
     * or scrolling between shots to capture different reviews.
     */
    static async interact(context, locator, config, geometricWarnings) {
        console.log("[MasonryHelper] Generating targeted screenshots for Masonry...");
        const shots = [];
        const page = context.page ? context.page() : context;

        const loadMoreSelectors = [
            '.feedspace-load-more', 
            'button:has-text("Load More")', 
            'button:has-text("Load more")', 
            '[class*="load-more"]'
        ];

        // 1. Backend-Driven Targeted Capture
        let targetedFeedName = null;
        if (config) {
            const rawFeeds = config.widget_data?.feeds_data || config.feeds_data || config.data?.feeds_data || [];
            const ratedFeed = rawFeeds.find(f => {
                const r = (f.rating_type === 'star')
                    ? ((f.response !== null && f.response !== undefined && f.response !== '') ? Number(f.response) : 0)
                    : ((f.rating !== null && f.rating !== undefined) ? Number(f.rating) : 0);
                return r && r > 0;
            });
            if (ratedFeed) {
                targetedFeedName = ratedFeed.app_user_name || ratedFeed.user_name || ratedFeed.name;
                console.log(`[MasonryHelper] Backend Targeting: Actively looking for card '${targetedFeedName}' with known ratings.`);
            }
        }

        // Reset scroll to the top of the widget
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
        await locator.scrollIntoViewIfNeeded().catch(() => null);
        await page.waitForTimeout(500);

        let targetFound = false;

        for (let i = 0; i < 4; i++) {
            console.log(`[MasonryHelper] Capture Phase ${i + 1}/4`);
            
            await page.waitForTimeout(1000);

            // Attempt to snap to the target card if we haven't already
            if (targetedFeedName && !targetFound) {
                const targetCard = page.locator(`text="${targetedFeedName}"`).first();
                if (await targetCard.isVisible().catch(() => false)) {
                    console.log(`[MasonryHelper] Found targeted card '${targetedFeedName}'. Scrolling into view.`);
                    await targetCard.scrollIntoViewIfNeeded().catch(() => null);
                    await page.waitForTimeout(500);
                    targetFound = true; // Found and snapped to it
                }
            }

            let buf;
            if (i === 3) {
                // Final shot is full-length to provide overall context without clipping
                console.log(`[MasonryHelper] Taking Full-Length Screenshot (JPEG optimized)`);
                buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 50, scale: 'css', animations: 'disabled' }).catch((e) => { console.log('Screenshot error:', e.message); return null; });
            } else {
                // Normal shots (Viewport only) to ensure high-resolution capture of different reviews
                console.log(`[MasonryHelper] Taking Viewport Screenshot (JPEG optimized)`);
                buf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 50, scale: 'css', animations: 'disabled' }).catch((e) => { console.log('Screenshot error:', e.message); return null; });
            }
            if (buf) shots.push(buf);

            // Attempt to load more reviews to capture different ratings
            let clicked = false;
            for (const sel of loadMoreSelectors) {
                const btn = page.locator(sel).filter({ visible: true }).first();
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click({ force: true }).catch(() => null);
                    clicked = true;
                    console.log(`[MasonryHelper] Clicked Load More button (${sel})`);
                    break;
                }
            }

            // If no Load More button, try scrolling down to trigger infinite scroll
            if (!clicked) {
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            }
            
            await page.waitForTimeout(2000); // Wait for new content to render
        }

        return shots;
    }
}

module.exports = MasonryHelper;
