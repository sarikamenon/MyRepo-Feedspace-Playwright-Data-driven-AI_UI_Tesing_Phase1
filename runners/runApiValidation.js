const { chromium } = require('@playwright/test');
const PlaywrightHelper = require('../helpers/playwrightHelper');
const ReportHelper = require('../helpers/reportHelper');
const BasecampHelper = require('../helpers/basecampHelper');
const { WidgetDetector } = require('../helpers/widgetDetector');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const PROCESSED_URLS_FILE = path.join(process.cwd(), 'testData', 'processed_urls.json');

/**
 * Loads processed URLs from file.
 */
function loadProcessedUrls() {
    if (fs.existsSync(PROCESSED_URLS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PROCESSED_URLS_FILE, 'utf8'));
        } catch (e) {
            console.error('[Main] Failed to load processed_urls.json, starting fresh.');
            return [];
        }
    }
    return [];
}

/**
 * Saves processed URLs to file.
 */
function saveProcessedUrl(url) {
    let processed = loadProcessedUrls();
    if (!processed.includes(url)) {
        processed.push(url);
        fs.writeFileSync(PROCESSED_URLS_FILE, JSON.stringify(processed, null, 2));
    }
}

/**
 * Resets processed URLs file.
 */
function resetProcessedUrls() {
    console.log('[Main] All URLs processed. Resetting rotation...');
    fs.writeFileSync(PROCESSED_URLS_FILE, JSON.stringify([], null, 2));
}

/**
 * Fetches the latest test data from the Feedspace API.
 */
async function fetchConfig() {
    const API_URL = 'https://api.feedspace.io/v3/embed-widget-urls';
    console.log(`[Main] Fetching live test data from ${API_URL}...`);

    return new Promise((resolve, reject) => {
        https.get(API_URL, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const dataArray = Array.isArray(json) ? json : (json.data || []);
                    resolve(dataArray);
                } catch (e) {
                    reject(new Error('Failed to parse API response'));
                }
            });
        }).on('error', reject);
    });
}

const WIDGET_CONFIG_MAP = {
    'CAROUSEL_SLIDER': 'carouselslider',
    'MASONRY': 'masonryFeature',
    'MARQUEE_STRIPE': 'stripSliderFeature',
    'AVATAR_GROUP': 'avatarGroupFeature',
    'SINGLE_SLIDER': 'avatarSliderFeature',
    'MARQUEE_UPDOWN': 'verticalScrollFeature',
    'MARQUEE_LEFTRIGHT': 'horizontalScrollFeature',
    'FLOATING_TOAST': 'floatingCardsFeature'
};

/**
 * Orchestrator for Daily API-Driven Visual Validation with Rotation.
 */
async function run() {
    const MAX_DAILY_BATCH = parseInt(process.env.DAILY_BATCH_SIZE || '15');
    console.log('\n--- Starting Daily API Visual Validation (Rotating Batch of 15) ---');

    let allApiData;
    try {
        allApiData = await fetchConfig();
        console.log(`[Main] API returned ${allApiData.length} total records.`);
    } catch (e) {
        console.error(`[Main] API Error: ${e.message}`);
        process.exit(1);
    }

    // URL Rotation Logic
    let processed = loadProcessedUrls();
    let pending = allApiData.filter(entry => {
        const url = entry.customer_url || entry.url;
        return !processed.includes(url);
    });

    if (pending.length === 0) {
        resetProcessedUrls();
        pending = allApiData;
    }

    const dailyBatch = pending.slice(0, MAX_DAILY_BATCH);
    console.log(`[Main] Batch Selected: ${dailyBatch.length} new URLs to process today.`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const reportHelper = new ReportHelper();
    const results = [];
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    for (let i = 0; i < dailyBatch.length; i++) {
        const entry = dailyBatch[i];
        const url = entry.customer_url || entry.url;
        const typeId = entry.widget_type || entry.type;
        const configuration = entry.configuration || entry.configurations;

        console.log(`\n[${i + 1}/${dailyBatch.length}] Processing: ${url}`);

        let success = false;
        let attempt = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempt < maxAttempts && !success) {
            attempt++;
            const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
            const page = await context.newPage();
            const helper = new PlaywrightHelper(page);

            try {
                if (attempt > 1) console.log(`   > Attempt ${attempt}/${maxAttempts}...`);

                const typeName = WidgetDetector.identify({ type: typeId });
                const configFileName = WIDGET_CONFIG_MAP[typeName] || typeName.toLowerCase();
                const configPath = path.join(process.cwd(), 'Configs', `${configFileName}.json`);

                let staticFeatures = null;
                if (fs.existsSync(configPath)) {
                    staticFeatures = JSON.parse(fs.readFileSync(configPath, 'utf8')).features;
                }

                await helper.init(url, typeId, configuration);
                const validationResult = await helper.validateWithAI(staticFeatures);

                const record = {
                    url: url,
                    widgetType: typeName,
                    ...validationResult,
                    status: validationResult.aiAnalysis.overall_status || 'UNKNOWN',
                    timestamp: new Date().toISOString()
                };
                results.push(record);
                saveProcessedUrl(url); // Mark as processed
                success = true;
                console.log(`   > Status: ${record.status}`);
            } catch (error) {
                lastError = error.message;
                console.error(`   > Attempt ${attempt} failed: ${error.message}`);
                if (attempt >= maxAttempts) {
                    const record = {
                        url, widgetType: typeId, status: 'ERROR', error: lastError, timestamp: new Date().toISOString(), aiAnalysis: { message: 'Failed after 3 attempts: ' + lastError }
                    };
                    results.push(record);
                }
            } finally {
                await context.close();
            }
        }

        // 10s cooldown to respect API limits
        if (i < dailyBatch.length - 1) await new Promise(r => setTimeout(r, 10000));
    }

    // --- Final Reporting ---
    const finalReport = {
        summary: {
            total: results.length,
            passed: results.filter(r => r.status === 'PASS').length,
            failed: results.filter(r => r.status === 'FAIL').length,
            errors: results.filter(r => r.status === 'ERROR').length
        },
        runs: results
    };

    const reportPath = await reportHelper.saveReport(finalReport);
    console.log(`\n[Main] Bulk Validation Complete. Detailed report available at: ${reportPath}`);

    const basecampHelper = new BasecampHelper();
    await basecampHelper.sendReport(finalReport).catch(e => console.warn(`[Main] Notification failed: ${e.message}`));

    await browser.close();
}

run().catch(err => {
    console.error('[Main] Bulk Pipeline Failed:', err);
    process.exit(1);
});
