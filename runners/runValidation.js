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
    'FLOATING_TOAST': 'floatingCardsFeature',
    'AVATAR_CAROUSEL': 'avatarCarouselFeature',
    'CROSS_SLIDER': 'crossSliderFeature',
    'COMPANY_LOGO_SLIDER': 'companyLogoSliderFeature',
    'AVATAR_BLOCK': 'avatarBlockFeature'
};

/**
 * Main Orchestrator for AI Visual Validation.
 */
async function run() {
    console.log('\n--- Starting Local AI Visual Validation Orchestrator ---');

    try {
        // --- CLI ARGUMENT PARSING ---
        const args = process.argv.slice(2);
        const urlArg = args.find(a => a.startsWith('--url='))?.split('=')[1] || (args[args.indexOf('--url') + 1]);
        const typeArg = args.find(a => a.startsWith('--type='))?.split('=')[1] ||
            args.find(a => a.startsWith('--widget='))?.split('=')[1] ||
            (args[args.indexOf('--type') + 1]) ||
            (args[args.indexOf('--widget') + 1]);
        const widthArg = args.find(a => a.startsWith('--width='))?.split('=')[1] || (args[args.indexOf('--width') + 1]);
        const heightArg = args.find(a => a.startsWith('--height='))?.split('=')[1] || (args[args.indexOf('--height') + 1]);

        this.targetWidth = widthArg ? parseInt(widthArg) : 1920;
        this.targetHeight = heightArg ? parseInt(heightArg) : 1080;

        if (urlArg) {
            console.log(`[Main] Targeting single URL via CLI: ${urlArg}`);
            testData = [{
                url: urlArg,
                type: typeArg || 'Unknown',
                configuration: {} // Default empty config
            }];
        } else {
            console.log('[Main] Loading local test data from testData/testUrls.json...');
            const localPath = path.join(process.cwd(), 'testData', 'testUrls.json');

            if (fs.existsSync(localPath)) {
                try {
                    const localContent = fs.readFileSync(localPath, 'utf8').trim();
                    if (localContent) {
                        const raw = JSON.parse(localContent);
                        testData = Array.isArray(raw) ? raw : (raw.data || []);
                    } else {
                        testData = [];
                    }
                } catch (e) {
                    console.error(`[Main] Failed to parse local testUrls.json: ${e.message}`);
                    testData = [];
                }
            } else {
                throw new Error('testData/testUrls.json not found. Please create it for local testing.');
            }
        }

        // Filter and clean
        testData = testData.filter(item => (item.customer_url || item.url));

    } catch (e) {
        console.error(`[Main] Local Config Error: ${e.message}`);
        process.exit(1);
    }

    console.log(`[Main] Found ${testData.length} records in local testUrls.json.`);

    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'false' ? false : true, // Default to headless for consistency
        channel: 'chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-web-security'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const reportHelper = new ReportHelper();
    const results = [];
    const targetWidth = this.targetWidth || 1920;
    const targetHeight = this.targetHeight || 1080;

    for (let i = 0; i < testData.length; i++) {
        const entry = testData[i];
        const url = entry.customer_url || entry.url;
        const widgetUUID = entry.unique_widget_id;
        const typeId = entry.widget_type || entry.type;
        const typeName = WidgetDetector.identify({ type: typeId });
        const configuration = entry.configuration || entry.configurations;

        console.log(`\n[${i + 1}/${testData.length}] Processing: ${url}`);

        // --- PREVALIDATION: URL Reachability Check ---
        console.log(`   > [Prevalidation] Checking reachability for: ${url}`);
        const reachability = await PlaywrightHelper.checkReachability(url, 3, widgetUUID);

        if (reachability.status === 'EMPTY_WIDGET') {
            console.log(`   > [Prevalidation] 🛑 Skipped (Empty State Fail): The widget has zero active feeds/reviews.`);
            results.push({
                url: url,
                widgetId: widgetUUID,
                widgetType: typeName,
                status: 'FAIL',
                error: 'Empty State: The widget contains zero active feeds/reviews',
                timestamp: new Date().toISOString(),
                aiAnalysis: {
                    overall_status: 'FAIL',
                    analysis_message: `Prevalidation Failure: The widget contains zero active reviews/feeds (Empty State).`,
                    feature_results: [
                        {
                            feature: "Widget Type Identification",
                            ui_status: typeName,
                            config_status: typeName,
                            issue: "Widget confirmed empty during prevalidation",
                            status: "PASS"
                        },
                        {
                            feature: "Show Review Date",
                            ui_status: "Absent",
                            config_status: "Visible",
                            issue: "Empty State: The widget contains zero review items.",
                            remarks: "Feature is absent because the widget contains zero reviews.",
                            status: "FAIL"
                        },
                        {
                            feature: "Show Review Ratings",
                            ui_status: "Absent",
                            config_status: "Visible",
                            issue: "Empty State: The widget contains zero review items.",
                            remarks: "Feature is absent because the widget contains zero reviews.",
                            status: "FAIL"
                        },
                        {
                            feature: "Read More",
                            ui_status: "Absent",
                            config_status: "Visible",
                            issue: "Empty State: The widget contains zero review items.",
                            remarks: "Feature is absent because the widget contains zero reviews.",
                            status: "FAIL"
                        },
                        {
                            feature: "Show Social Platform Icon",
                            ui_status: "Absent",
                            config_status: "Visible",
                            issue: "Empty State: The widget contains zero review items.",
                            remarks: "Feature is absent because the widget contains zero reviews.",
                            status: "FAIL"
                        },
                        {
                            feature: "Feedspace Branding",
                            ui_status: "Visible",
                            config_status: "Visible",
                            issue: "No visual defects detected",
                            remarks: "Feedspace branding is present on the widget embed by default.",
                            status: "PASS"
                        }
                    ],
                    aesthetic_results: [
                        { category: "A. LAYOUT & SPACING", issue: "Empty State: No review cards are visible or rendered.", severity: "CRITICAL", status: "FAIL" },
                        { category: "B. ELEMENT CONTAINMENT", issue: "No visual defects detected (Empty State Pass)", severity: "N/A", status: "PASS" },
                        { category: "C. CONTENT & TEXT RENDERING", issue: "Empty State: No review cards are visible or rendered.", severity: "CRITICAL", status: "FAIL" },
                        { category: "D. AVATAR RENDERING", issue: "Empty State: No review cards are visible or rendered.", severity: "CRITICAL", status: "FAIL" },
                        { category: "E. MEDIA & IMAGES", issue: "Empty State: No review cards are visible or rendered.", severity: "CRITICAL", status: "FAIL" },
                        { category: "F. THEME & COLOR VISIBILITY", issue: "No visual defects detected (Empty State Pass)", severity: "N/A", status: "PASS" },
                        { category: "G. POPUPS & MODALS", issue: "Empty State: No review cards are visible or rendered.", severity: "CRITICAL", status: "FAIL" }
                    ]
                }
            });
            const partialReportPath = path.join(process.cwd(), 'reports', 'current_progress.json');
            fs.writeFileSync(partialReportPath, JSON.stringify({ runs: results }, null, 2));
            continue; // Skip Playwright execution loop
        }

        if (reachability.status !== 'REACHABLE') {
            console.error(`   > [Prevalidation] 🛑 Skipped: URL is ${reachability.status}. Reason: ${reachability.message}`);
            results.push({
                url: url,
                widgetId: widgetUUID,
                widgetType: typeName,
                status: reachability.status,
                error: reachability.message,
                timestamp: new Date().toISOString(),
                aiAnalysis: {
                    overall_status: 'FAIL',
                    analysis_message: `Prevalidation Failure: The URL could not be reached or accessed. Status: ${reachability.status}, Error Code: ${reachability.error_code || 'N/A'}, Message: ${reachability.message}`,
                    feature_results: []
                }
            });

            // Incremental Progress Report
            const partialReportPath = path.join(process.cwd(), 'reports', 'current_progress.json');
            fs.writeFileSync(partialReportPath, JSON.stringify({ runs: results }, null, 2));
            continue; // Skip Playwright execution loop
        }
        console.log(`   > [Prevalidation] ✅ URL is reachable. Initiating validation.`);

        const maxUrlAttempts = 3;
        let urlAttempt = 0;
        let success = false;

        while (urlAttempt < maxUrlAttempts && !success) {
            urlAttempt++;

            const context = await browser.newContext({
                viewport: { width: targetWidth, height: targetHeight },
                deviceScaleFactor: 2,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                locale: 'en-US',
                timezoneId: 'Asia/Dubai',
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            // Add stealth initialization script to bypass bot checks (navigator.webdriver, chrome objects, languages)
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            });

            const page = await context.newPage();
            const helper = new PlaywrightHelper(page);
            helper.expectedType = typeName;

            try {
                if (urlAttempt > 1) {
                    console.log(`   > [Retry ${urlAttempt}/${maxUrlAttempts}] Restarting validation for: ${url}`);
                }

                // 1. Identify Widget Type (already normalized)
                console.log(`   > Type Identified: ${typeName} (ID: ${typeId})`);

                // 2. Map to Config File
                const configFileName = WIDGET_CONFIG_MAP[typeName] || typeName.toLowerCase();
                const configPath = path.join(process.cwd(), 'Configs', `${configFileName}.json`);

                let staticFeatures = null;
                if (fs.existsSync(configPath)) {
                    try {
                        const configContent = fs.readFileSync(configPath, 'utf8').trim();
                        if (configContent) {
                            const parsed = JSON.parse(configContent);
                            staticFeatures = parsed.features || parsed;
                            console.log(`[Main] 📂 Local Config Loaded: ${configFileName}.json (${Array.isArray(staticFeatures) ? staticFeatures.length : 'N/A'} features)`);
                        }
                    } catch (configErr) {
                        console.error(`[Main] Failed to parse config ${configFileName}.json: ${configErr.message}`);
                    }
                } else {
                    console.warn(`[Main] ⚠️  Warning: No local feature config found at ${configPath}. AI will auto-detect features.`);
                }

                // 3. Initialize & Navigate (Handling Hiding, Scrolling, etc.)
                await helper.init(url, typeId, configuration, widgetUUID);

                // 4. Run AI Analysis
                const validationResult = await helper.validateWithAI(staticFeatures);

                const record = {
                    url: url,
                    widgetId: widgetUUID,
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
                    const isFalseInvocation = error.message.includes('404') || 
                                              error.message.includes('403') || 
                                              error.message.includes('401') ||
                                              error.message.includes('not found') || 
                                              error.message.includes('Access denied');
                    results.push({
                        url: url,
                        widgetType: typeName,
                        status: isFalseInvocation ? 'FALSE_INVOCATION' : 'ERROR',
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
