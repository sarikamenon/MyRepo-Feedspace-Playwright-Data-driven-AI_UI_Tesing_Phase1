const { chromium } = require('@playwright/test');
const PlaywrightHelper = require('../helpers/playwrightHelper');
const ReportHelper = require('../helpers/reportHelper');
const BasecampHelper = require('../helpers/basecampHelper');
const { WidgetDetector } = require('../helpers/widgetDetector');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

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
                    // Handle wrapped response { success: true, data: [...] }
                    const dataArray = Array.isArray(json) ? json : (json.data || []);
                    resolve(dataArray);
                } catch (e) {
                    reject(new Error('Failed to parse API response'));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Mapping of Widget Types to their specific Feature Configuration files.
 */
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
 * Main Orchestrator for AI Visual Validation.
 */
async function run() {
    console.log('\n--- Starting Local AI Visual Validation Orchestrator ---');

    let testData;
    try {
        console.log('[Main] Loading local test data from testData/testUrls.json...');
        const localPath = path.join(process.cwd(), 'testData', 'testUrls.json');

        if (fs.existsSync(localPath)) {
            const raw = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            testData = Array.isArray(raw) ? raw : (raw.data || []);
        } else {
            throw new Error('testData/testUrls.json not found. Please create it for local testing.');
        }

        // Filter and clean
        testData = testData.filter(item => (item.customer_url || item.url) && (item.widget_type || item.type));

    } catch (e) {
        console.error(`[Main] Local Config Error: ${e.message}`);
        process.exit(1);
    }

    console.log(`[Main] Found ${testData.length} records in local testUrls.json.`);

    const browser = await chromium.launch({
        headless: !!process.env.CI,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    }); // Headless in CI, visible locally

    const reportHelper = new ReportHelper();
    const results = [];

    for (let i = 0; i < testData.length; i++) {
        const entry = testData[i];
        const url = entry.customer_url || entry.url;
        const typeId = entry.widget_type || entry.type;
        const configuration = entry.configuration || entry.configurations;

        console.log(`\n[${i + 1}/${testData.length}] Processing: ${url}`);

        const maxUrlAttempts = 3;
        let urlAttempt = 0;
        let success = false;

        while (urlAttempt < maxUrlAttempts && !success) {
            urlAttempt++;

            // Create a fresh context for each attempt to avoid state contamination or session crashes
            const context = await browser.newContext({
                viewport: { width: 1920, height: 1080 },
                deviceScaleFactor: 1,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                locale: 'en-US',
                timezoneId: 'Asia/Dubai', // Matches user GMT+4 context
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const page = await context.newPage();
            const helper = new PlaywrightHelper(page);

            try {
                if (urlAttempt > 1) {
                    console.log(`   > [Retry ${urlAttempt}/${maxUrlAttempts}] Restarting validation for: ${url}`);
                }

                // 1. Identify Widget Type
                const typeName = WidgetDetector.identify({ type: typeId });
                console.log(`   > Type Identified: ${typeName} (ID: ${typeId})`);

                // 2. Map to Config File
                const configFileName = WIDGET_CONFIG_MAP[typeName] || typeName.toLowerCase();
                const configPath = path.join(process.cwd(), 'Configs', `${configFileName}.json`);

                let staticFeatures = null;
                if (fs.existsSync(configPath)) {
                    const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    staticFeatures = configContent.features;
                    console.log(`   > Features Loaded: ${configFileName}.json (${staticFeatures.length} markers)`);
                } else {
                    console.warn(`   > Warning: No feature config found for ${typeName}. Using default AI vision.`);
                }

                // 3. Initialize & Navigate (Handling Hiding, Scrolling, etc.)
                await helper.init(url, typeId, configuration);

                // 4. Run AI Analysis
                const validationResult = await helper.validateWithAI(staticFeatures);

                const record = {
                    url: url,
                    ...validationResult,
                    status: validationResult.aiAnalysis.overall_status || validationResult.aiAnalysis.status || 'UNKNOWN',
                    timestamp: new Date().toISOString()
                };
                results.push(record);

                console.log(`   > Overall Status: ${record.status}`);

                // Incremental Progress Report
                const partialReportPath = path.join(process.cwd(), 'reports', 'current_progress.json');
                fs.writeFileSync(partialReportPath, JSON.stringify({ runs: results }, null, 2));

                success = true; // Mark as success to exit retry loop
            } catch (error) {
                console.error(`   > Error on attempt ${urlAttempt}: ${error.message}`);

                if (urlAttempt >= maxUrlAttempts) {
                    results.push({
                        url: url,
                        widgetType: typeId,
                        status: 'ERROR',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.log(`   > Retrying ${url} due to failure...`);
                    await new Promise(r => setTimeout(r, 5000)); // Wait before retry
                }
            } finally {
                await context.close();
            }
        }

        // Pause between URLs to respect API rate limits
        if (i < testData.length - 1) await new Promise(r => setTimeout(r, 10000));
    }

    // --- Final Reporting ---
    console.log('\n--- Validation Sequence Complete. Generating Reports... ---');
    const consolidatedReport = {
        summary: {
            total: results.length,
            passed: results.filter(r => r.status === 'PASS').length,
            failed: results.filter(r => r.status === 'FAIL').length,
            errors: results.filter(r => r.status === 'ERROR').length
        },
        runs: results
    };

    const reportPath = await reportHelper.saveReport(consolidatedReport);
    console.log(`[Main] SUCCESS: Dashboard available at: ${reportPath}`);

    // --- Basecamp Notification ---
    const basecampHelper = new BasecampHelper();
    await basecampHelper.sendReport(consolidatedReport);

    await browser.close();
}

// Global Error Handler
run().catch(err => {
    console.error('[Main] Orchestrator Failed:', err);
    process.exit(1);
});
