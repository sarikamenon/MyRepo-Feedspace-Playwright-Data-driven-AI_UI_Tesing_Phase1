class AvatarGroupHelper {
    static async interact(page, widgetLocator, captureCallback) {
        console.log('[AvatarGroupHelper] Starting refined interactive avatar clicking...');

        const screenshotBuffers = [];

        // 0️⃣ REQUIREMENT: Capture 'avatars-only' focused screenshot before interactions
        try {
            console.log('[AvatarGroupHelper] Capturing focused avatars-only screenshot...');
            await widgetLocator.scrollIntoViewIfNeeded({ timeout: 3000 });
            const avatarsOnlyBuffer = await widgetLocator.screenshot({ timeout: 5000 }).catch(() => null);
            if (avatarsOnlyBuffer) {
                screenshotBuffers.push(avatarsOnlyBuffer);
                console.log('[AvatarGroupHelper] Avatars-only screenshot added to buffer.');
            }
        } catch (e) {
            console.warn(`[AvatarGroupHelper] Failed to capture focused avatar shot: ${e.message}`);
        }

        // Broad selectors to capture all potential avatar elements
        const avatarSelectors = [
            '.fe-avatar-box',
            '.large-avatar-box',
            '.fe-avatar',
            '[class*="avatar-box"]',
            '[class*="avatar-item"]',
            '.feedspace-avatar',
            'div:has(.feedspace-initials)',
        ];

        // Find all avatars inside the widget
        const allCandidates = await widgetLocator.locator(avatarSelectors.join(', ')).all();
        console.log(`[AvatarGroupHelper] Found ${allCandidates.length} potential avatar elements total.`);

        // 1️⃣ Filter for VISIBLE and UNIQUE avatars
        const visibleAvatars = [];
        const seenFeedIds = new Set();

        for (const candidate of allCandidates) {
            try {
                if (await candidate.isVisible()) {
                    const feedId = await candidate.getAttribute('data-feed-id').catch(() => null);

                    if (feedId) {
                        if (!seenFeedIds.has(feedId)) {
                            seenFeedIds.add(feedId);
                            visibleAvatars.push(candidate);
                        }
                    } else {
                        // If no feedId, use a temporary unique identifier or just include if it seems distinct
                        // For now, if no feedId, we treat it as potentially duplicate if it's very close to another
                        visibleAvatars.push(candidate);
                    }
                }
            } catch (e) { }

            if (visibleAvatars.length >= 5) break;
        }

        console.log(`[AvatarGroupHelper] ${visibleAvatars.length} unique avatars are currently visible.`);

        // Pick specific indices: 1st (0) and 3rd (2) as per requirement
        const indicesToInteract = [];
        if (visibleAvatars.length > 0) indicesToInteract.push(0);
        if (visibleAvatars.length > 2) indicesToInteract.push(2);

        for (let i = 0; i < indicesToInteract.length; i++) {
            const index = indicesToInteract[i];
            const avatar = visibleAvatars[index];

            try {
                console.log(`[AvatarGroupHelper] Processing visible avatar index ${index} (${i + 1}/${indicesToInteract.length})...`);

                // 2️⃣ Reset State: Ensure previous popups are closed
                const reviewBox = page.locator('.fe-review-box, .fe-review-box-inner, [class*="review-box"], [class*="popup"], .fe-review-box-content');
                const closeBtn = page.locator('.fe-review-box-close, .close-btn, [class*="close"], .fe-modal-close').filter({ visible: true }).first();

                if (await reviewBox.first().isVisible()) {
                    console.log('[AvatarGroupHelper] Closing existing popup by clicking outside...');
                    // Click outside (top-left area usually safe)
                    await page.mouse.click(20, 20);
                    await page.waitForTimeout(500);

                    // Fallback to close button if still visible
                    if (await reviewBox.first().isVisible()) {
                        await closeBtn.click().catch(() => null);
                    }

                    await reviewBox.first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => null);
                    await page.waitForTimeout(800);
                }

                // 3️⃣ Scroll and Click
                try {
                    await avatar.scrollIntoViewIfNeeded({ timeout: 3000 });
                } catch (e) {
                    await avatar.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
                }
                await page.waitForTimeout(500);

                console.log(`[AvatarGroupHelper] Clicking visible avatar ${index + 1}...`);
                const img = avatar.locator('img').first();
                if (await img.count() && await img.isVisible()) {
                    await img.click({ force: true, timeout: 3000 });
                } else {
                    await avatar.click({ force: true, timeout: 3000 });
                }

                // 4️⃣ Wait for the popup and capture
                try {
                    await reviewBox.first().waitFor({ state: 'visible', timeout: 6000 });
                    console.log(`[AvatarGroupHelper] Review box revealed for avatar ${index + 1}.`);
                } catch (e) {
                    console.warn(`[AvatarGroupHelper] Popup did not appear for avatar ${index + 1}.`);
                }

                // Wait for content stabilization
                await page.waitForTimeout(1500);

                // Capture focused high-res screenshot
                console.log(`[AvatarGroupHelper] Capturing screenshot for review ${index + 1}`);
                const buffer = await captureCallback();
                if (buffer) screenshotBuffers.push(buffer);

                // 5️⃣ REQUIREMENT: Close the popup by clicking outside
                console.log('[AvatarGroupHelper] Cleaning up: Closing popup by clicking outside...');
                await page.mouse.click(20, 20);

                // Wait until it's fully hidden before continuing
                await reviewBox.first().waitFor({ state: 'hidden', timeout: 4000 }).catch(async () => {
                    console.log('[AvatarGroupHelper] Click outside failed to close popup, using close button...');
                    if (await closeBtn.isVisible()) {
                        await closeBtn.click().catch(() => null);
                        await reviewBox.first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => null);
                    }
                });

                await page.waitForTimeout(1000); // Breathe between interactions

            } catch (err) {
                console.warn(`[AvatarGroupHelper] Error during interaction ${index + 1}: ${err.message}`);
            }
        }

        console.log(`[AvatarGroupHelper] Interaction sequence complete. ${screenshotBuffers.length} shots captured.`);
        return screenshotBuffers;
    }
}

module.exports = AvatarGroupHelper;