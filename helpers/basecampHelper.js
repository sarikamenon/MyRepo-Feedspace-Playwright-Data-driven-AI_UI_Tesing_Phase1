const https = require("https");

class BasecampHelper {
    constructor() {
        this.token = (process.env.BASECAMP_TOKEN || "").replace(/[\n\r]/g, "").trim();
        this.accountId = (process.env.BASECAMP_ACCOUNT_ID || "").trim();
        this.projectId = (process.env.BASECAMP_PROJECT_ID || "").trim();
        this.chatId = (process.env.BASECAMP_CHAT_ID || "").trim();
    }

    async sendReport(summary) {
        if (!this.token || !this.accountId || !this.projectId || !this.chatId) {
            console.warn("[BasecampHelper] Missing Basecamp configuration (Token, AccountID, ProjectID, or ChatID).");
            return;
        }

        const stats = summary.summary;
        const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "Local Run";

        let runDetails = "";
        summary.runs.forEach(run => {
            const statusEmoji = run.status === "PASS" ? "✅" : (run.status === "FAIL" ? "❌" : "⚠️");
            runDetails += `\n---\n`;
            runDetails += `website_url: "${run.url}"\n`;
            runDetails += `Widget type: "${run.widgetType}"\n`;
            runDetails += `Status: ${statusEmoji} ${run.status}\n`;

            if (run.aiAnalysis && run.aiAnalysis.feature_results) {
                runDetails += `\nVerification Results:\n`;
                run.aiAnalysis.feature_results.forEach(f => {
                    const fEmoji = f.status === "PASS" ? "✅" : (f.status === "FAIL" ? "❌" : "⚠️");
                    const uiStatus = f.ui_status || f.actual || 'N/A';
                    const configStatus = f.config_status || f.expected || 'N/A';

                    // Show comparison in result line
                    runDetails += `- ${f.feature}: ${fEmoji} ${f.status} (UI: ${uiStatus}, Config: ${configStatus})\n`;
                });
            } else if (run.error) {
                runDetails += `\nError: ${run.error}\n`;
            }
        });

        const content = `
Feedspace AI Visual Validation Report

Total widgets tested: ${stats.total}
Passed: ✅ ${stats.passed}
Failed: ❌ ${stats.failed}
Errors: ⚠️ ${stats.errors}
${runDetails}

---
GitHub Run URL:
${runUrl}
`.trim();

        const data = JSON.stringify({ content });

        const options = {
            hostname: "3.basecampapi.com",
            path: `/${this.accountId}/buckets/${this.projectId}/chats/${this.chatId}/lines.json`,
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
                "User-Agent": "Feedspace QA Bot (sarika.menon@techuplabs.com)"
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = "";

                res.on("data", chunk => body += chunk);

                res.on("end", () => {
                    console.log("Basecamp Status:", res.statusCode);
                    console.log("Basecamp Response:", body);

                    resolve(res.statusCode >= 200 && res.statusCode < 300);
                });
            });

            req.on("error", reject);
            req.write(data);
            req.end();
        });
    }
}

module.exports = BasecampHelper;