const BasecampHelper = require('../helpers/basecampHelper');
const fs = require('fs');
const path = require('path');

// Mock Environment
process.env.BASECAMP_TOKEN = "mock_token";
process.env.BASECAMP_ACCOUNT_ID = "mock_acc";
process.env.BASECAMP_PROJECT_ID = "mock_proj";
process.env.BASECAMP_CHAT_ID = "mock_chat";

async function test() {
    const helper = new BasecampHelper();
    
    // Mock sample report with errors
    const errorReport = {
        summary: { total: 3, passed: 0, failed: 2, errors: 1 },
        runs: [
            {
                url: "https://example.com/404",
                widgetType: "AVATAR_GROUP",
                status: "ERROR",
                error: "The requested page could not be found (404 Error)."
            },
            {
                url: "https://example.com/401",
                widgetType: "CROSS_SLIDER",
                status: "ERROR",
                error: "Access denied or authorization required to view this page (401 Error)."
            },
            {
                url: "https://example.com/bad-json",
                widgetType: "Validation Error",
                status: "FAIL",
                aiAnalysis: {
                    overall_status: "FAIL",
                    feature_results: [
                        { feature: "Validation Integrity", status: "FAIL", issue: "The data payload from this page was invalid or incomplete (JSON Error)." }
                    ]
                }
            }
        ]
    };

    // We override the https request to capture the content
    const https = require('https');
    const originalRequest = https.request;
    
    let capturedContent = "";
    
    https.request = (options, callback) => {
        const mockRes = {
            statusCode: 201,
            on: (event, cb) => {
                if (event === 'data') cb('{}');
                if (event === 'end') cb();
            }
        };
        
        return {
            on: () => {},
            write: (data) => {
                capturedContent = JSON.parse(data).content;
            },
            end: () => {
                callback(mockRes);
            }
        };
    };

    console.log("--- GENERATING REPORT ---");
    await helper.sendReport(errorReport);
    
    fs.writeFileSync('tmp/captured_output.txt', capturedContent);
    console.log("Captured content saved to tmp/captured_output.txt");
    
    // Restore original request
    https.request = originalRequest;
}

test().catch(console.error);
