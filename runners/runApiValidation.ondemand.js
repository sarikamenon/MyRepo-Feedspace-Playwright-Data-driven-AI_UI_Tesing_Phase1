const { chromium } = require('@playwright/test');
const PlaywrightHelper = require('../helpers/playwrightHelper');
const ReportHelper = require('../helpers/reportHelper');
const BasecampHelper = require('../helpers/basecampHelper');
const { WidgetDetector } = require('../helpers/widgetDetector');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Normalizes a URL for consistent comparison.
 */
function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().toLowerCase().replace(/\/$/, '');
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
    'COMPANY_LOGO_SLIDER': 'companyLogoSliderFeature',
    'AVATAR_BLOCK': 'avatarBlockFeature'
};

/**
 * On-Demand Orchestrator — reads ONLY from client_payload sent via repository_dispatch.
 * Triggered by dev team whenever a customer embeds a widget.
 */
async function run() {
    console.log('\n--- Starting ON-DEMAND Visual Validation ---');

    let allApiData = [];

    // ✅ Read ONLY from client_payload — no API call
    let widgetData = null;
    if (process.env.WIDGET_DATA) {
        try {
            widgetData = JSON.parse(process.env.WIDGET_DATA);
        } catch (e) {
            console.error('[OnDemand] Failed to parse WIDGET_DATA env variable.');
        }
    }

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
    const targetHeight = dataRoot.height ? parseInt(dataRoot.height) : 1080;
    console.log(`[OnDemand] Target Viewport: ${targetWidth}x${targetHeight}`);

    // Process all incoming URLs without filtering against previously run URLs
    const newUrls = allApiData;

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
            continue; // Skip standard loop
        }
        console.log(`   > [Prevalidation] ✅ URL is reachable. Initiating validation.`);

        let success = false;
        let attempt = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempt < maxAttempts && !success) {
            attempt++;
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
            const page = await context.newPage();
            const helper = new PlaywrightHelper(page);
            helper.expectedType = typeName;

            try {
                if (attempt > 1) console.log(`   > Attempt ${attempt}/${maxAttempts}...`);

                const configFileName = WIDGET_CONFIG_MAP[typeName] || typeName.toLowerCase();
                const configPath = path.join(process.cwd(), 'Configs', `${configFileName}.json`);

                let staticFeatures = null;
                if (fs.existsSync(configPath)) {
                    try {
                        const configContent = fs.readFileSync(configPath, 'utf8').trim();
                        if (configContent) {
                            const parsed = JSON.parse(configContent);
                            staticFeatures = parsed.features || parsed;
                        }
                    } catch (configErr) {
                        console.error(`[OnDemand] Failed to parse config ${configFileName}.json: ${configErr.message}`);
                    }
                }

                await helper.init(url, typeId, configuration, widgetUUID);
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

                // Incremental Progress Report (Added for parity with runValidation.js)
                const partialReportPath = path.join(process.cwd(), 'reports', 'current_progress.json');
                fs.writeFileSync(partialReportPath, JSON.stringify({ runs: results }, null, 2));

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