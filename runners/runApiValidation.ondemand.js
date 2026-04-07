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
 * Normalizes a URL for consistent comparison.
 */
function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().toLowerCase().replace(/\/$/, '');
}

/**
 * Loads processed URLs from file.
 */
function loadProcessedUrls() {
    if (fs.existsSync(PROCESSED_URLS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PROCESSED_URLS_FILE, 'utf8'));
            return Array.isArray(data) ? data.map(normalizeUrl) : [];
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
    const normalized = normalizeUrl(url);
    if (!normalized) return;

    let processed = loadProcessedUrls();
    // We store the original URL but check against normalized versions
    const rawProcessed = fs.existsSync(PROCESSED_URLS_FILE) ? JSON.parse(fs.readFileSync(PROCESSED_URLS_FILE, 'utf8')) : [];

    if (!processed.includes(normalized)) {
        rawProcessed.push(url);
        fs.writeFileSync(PROCESSED_URLS_FILE, JSON.stringify(rawProcessed, null, 2));
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
    'FLOATING_TOAST': 'floatingCardsFeature',
    'AVATAR_CAROUSEL': 'avatarCarouselFeature',
    'CROSS_SLIDER': 'crossSliderFeature',
    'COMPANY_LOGO_SLIDER': 'companyLogoSliderFeature'
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
            unique_widget_id: dataRoot.unique_widget_id,
            configurations: dataRoot.configurations || dataRoot.configuration
        }];
    } else if (dataRoot.urls && dataRoot.urls.length > 0) {
        // Multiple URLs sent in payload
        console.log(`[OnDemand] Using ${dataRoot.urls.length} URL(s) from dispatch payload.`);
        allApiData = dataRoot.urls;
    } else {
        process.exit(0);
    }

    // Deduplicate by URL + WidgetType + WidgetID to prevent redundant validation for identical embeds
    const seenPairs = new Set();
    const uniqueApiData = allApiData.filter(entry => {
        const rawUrl = typeof entry === 'string' ? entry : (entry.customer_url || entry.url || '');
        const normUrl = normalizeUrl(rawUrl);
        const type = (entry.widget_type || entry.type || '').toLowerCase();
        const id = entry.unique_widget_id || entry.id || '';
        const key = `${normUrl}|${type}|${id}`;
        if (seenPairs.has(key)) return false;
        seenPairs.add(key);
        return true;
    });

    if (uniqueApiData.length < allApiData.length) {
        console.log(`[OnDemand] Deduplicated ${allApiData.length} entries down to ${uniqueApiData.length} unique tests.`);
    }
    allApiData = uniqueApiData;

    console.log(`[OnDemand] ${allApiData.length} URL(s) to process.`);
    
    // Dynamic Viewport Extraction (Default: 1920x700 as per runValidation.js)
    const targetWidth = dataRoot.width ? parseInt(dataRoot.width) : 1920;
    const targetHeight = dataRoot.height ? parseInt(dataRoot.height) : 700;
    console.log(`[OnDemand] Target Viewport: ${targetWidth}x${targetHeight}`);

    const processedUrls = loadProcessedUrls();
    const newUrls = allApiData.filter(entry => {
        const rawUrl = typeof entry === 'string' ? entry : (entry.customer_url || entry.url || '');
        const normalized = normalizeUrl(rawUrl);
        return normalized && !processedUrls.includes(normalized);
    });

    if (newUrls.length === 0) {
        console.log('[OnDemand] All incoming URLs have already been processed. Skipping execution.');
        process.exit(0);
    }

    console.log(`[OnDemand] ${newUrls.length} NEW URL(s) to process after filtering.`);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const reportHelper = new ReportHelper();
    const results = [];
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    for (let i = 0; i < newUrls.length; i++) {
        const entry = newUrls[i];
        const url = typeof entry === 'string' ? entry : (entry.customer_url || entry.url);
        const typeId = entry.widget_type || entry.type;
        const widgetUUID = entry.unique_widget_id;
        const typeName = WidgetDetector.identify({ type: typeId });
        const configuration = entry.configuration || entry.configurations;

        console.log(`\n[${i + 1}/${newUrls.length}] Processing: ${url}`);

        let success = false;
        let attempt = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempt < maxAttempts && !success) {
            attempt++;
            const context = await browser.newContext({ 
                viewport: { width: targetWidth, height: targetHeight },
                deviceScaleFactor: 2,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                locale: 'en-US',
                timezoneId: 'Asia/Dubai',
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            const page = await context.newPage();
            const helper = new PlaywrightHelper(page);
            helper.expectedType = typeName;

            try {
                if (attempt > 1) console.log(`   > Attempt ${attempt}/${maxAttempts}...`);

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
                    widgetId: widgetUUID,
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
                        widgetType: typeName,
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