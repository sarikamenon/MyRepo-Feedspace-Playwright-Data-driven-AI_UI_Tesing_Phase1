const { chromium } = require('@playwright/test');
const PlaywrightHelper = require('../helpers/playwrightHelper');
const ReportHelper = require('../helpers/reportHelper');
const BasecampHelper = require('../helpers/basecampHelper');
const { WidgetDetector } = require('../helpers/widgetDetector');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PROCESSED_URLS_FILE = path.join(process.cwd(), 'testData', 'processed_urls_ondemand.json');

/**
 * Loads processed URLs from file.
 */
function loadProcessedUrls() {
    if (fs.existsSync(PROCESSED_URLS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PROCESSED_URLS_FILE, 'utf8'));
        } catch (e) {
            console.error('[OnDemand] Failed to load processed_urls_ondemand.json, starting fresh.');
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
 * On-Demand Orchestrator — reads ONLY from client_payload sent via repository_dispatch.
 * Triggered by dev team whenever a customer embeds a widget.
 */
async function run() {
    console.log('\n--- Starting ON-DEMAND Visual Validation ---');

    let allApiData = [];

    // ✅ Read ONLY from client_payload — no API call
    const widgetData = process.env.WIDGET_DATA ? JSON.parse(process.env.WIDGET_DATA) : null;

    if (!widgetData) {
        console.log('[OnDemand] No payload data received. Exiting.');
        process.exit(0);
    }

    console.log('[OnDemand] Received Payload:', JSON.stringify(widgetData, null, 2));

    // Support both direct payload and nested 'data' payload
    const dataRoot = widgetData.data || widgetData;

    if (dataRoot.url) {
        // Single URL sent in payload
        console.log(`[OnDemand] Using single URL from dispatch payload.`);
        allApiData = [{
            url: dataRoot.url,
            type: dataRoot.type || dataRoot.widget_type,
            configurations: dataRoot.configurations || dataRoot.configuration
        }];
    } else if (dataRoot.urls && dataRoot.urls.length > 0) {
        // Multiple URLs sent in payload
        console.log(`[OnDemand] Using ${dataRoot.urls.length} URL(s) from dispatch payload.`);
        allApiData = dataRoot.urls;
    } else {
        console.log('[OnDemand] Invalid payload structure. Exiting.');
        process.exit(0);
    }

    console.log(`[OnDemand] ${allApiData.length} URL(s) to process.`);

    // For On-Demand, we usually want to run even if previously processed (e.g. config changed)
    // But we still track it for history.
    const newUrls = allApiData;

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const reportHelper = new ReportHelper();
    const results = [];
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    for (let i = 0; i < newUrls.length; i++) {
        const entry = newUrls[i];
        const url = entry.customer_url || entry.url;
        const typeId = entry.widget_type || entry.type;
        const configuration = entry.configuration || entry.configurations;

        console.log(`\n[${i + 1}/${newUrls.length}] Processing: ${url}`);

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
                saveProcessedUrl(url);
                success = true;
                console.log(`   > Status: ${record.status}`);

            } catch (error) {
                lastError = error.message;
                console.error(`   > Attempt ${attempt} failed: ${error.message}`);
                if (attempt >= maxAttempts) {
                    results.push({
                        url,
                        widgetType: typeId,
                        status: 'ERROR',
                        error: lastError,
                        timestamp: new Date().toISOString(),
                        aiAnalysis: { message: 'Failed after 3 attempts: ' + lastError }
                    });
                }
            } finally {
                await context.close();
            }
        }

        // 10s cooldown between URLs to respect API limits
        if (i < newUrls.length - 1) await new Promise(r => setTimeout(r, 10000));
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
    console.log(`\n[OnDemand] Validation Complete. Report: ${reportPath}`);

    const basecampHelper = new BasecampHelper();
    await basecampHelper.sendReport(finalReport)
        .catch(e => console.warn(`[OnDemand] Notification failed: ${e.message}`));

    await browser.close();
}

run().catch(err => {
    console.error('[OnDemand] Pipeline Failed:', err);
    process.exit(1);
});