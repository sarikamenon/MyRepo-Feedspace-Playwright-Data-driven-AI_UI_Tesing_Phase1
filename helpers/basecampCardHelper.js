const https = require("https");

/**
 * Creates Basecamp cards for card-worthy validation results and dedupes
 * repeat failures onto the existing card.
 *
 * Card-worthy: FAIL (configuration mismatch / UI issue / any other reason)
 *              and UNKNOWN. Empty-state FAILs and customer-side statuses
 *              (PASS, BLOCKED_URL, FALSE_INVOCATION, ACCESS_DENIED,
 *              NOT_FOUND, ERROR) never create cards.
 *
 * Reuses BASECAMP_TOKEN / BASECAMP_ACCOUNT_ID / BASECAMP_PROJECT_ID from
 * BasecampHelper. Column and assignee come from workflow env with defaults:
 * Engineering table -> Triage column, assigned to Amit Hazra.
 */
class BasecampCardHelper {
    constructor() {
        this.token = (process.env.BASECAMP_TOKEN || "").replace(/[\n\r]/g, "").trim();
        this.accountId = (process.env.BASECAMP_ACCOUNT_ID || "").trim();
        this.projectId = (process.env.BASECAMP_PROJECT_ID || "").trim();
        this.columnId = (process.env.BASECAMP_CARD_COLUMN_ID || "5478412224").trim();
        this.assigneeId = parseInt(process.env.BASECAMP_CARD_ASSIGNEE_ID || "45133799", 10);
    }

    isConfigured() {
        return Boolean(this.token && this.accountId && this.projectId && this.columnId);
    }

    /**
     * Decide card vs note-only. Returns a short label when the result
     * deserves a card, null otherwise.
     */
    classify(run) {
        const status = (run.status || "").toUpperCase();
        const reason = this.reasonOf(run).toLowerCase();
        if (status === "FAIL") {
            if (reason.includes("empty state")) return null;
            if (reason.includes("configuration mismatch")) return "configuration mismatch";
            if (reason.includes("ui issue")) return "UI issue";
            return "unclassified failure";
        }
        if (status === "UNKNOWN") return "checks could not be evaluated";
        return null;
    }

    reasonOf(run) {
        return run.reason || run.error || (run.aiAnalysis && run.aiAnalysis.summary) || "";
    }

    escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    request(method, path, payload) {
        const data = payload ? JSON.stringify(payload) : null;
        const options = {
            hostname: "3.basecampapi.com",
            path: `/${this.accountId}${path}`,
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json",
                "User-Agent": "Feedspace QA Bot (sarika.menon@techuplabs.com)"
            }
        };
        if (data) options.headers["Content-Length"] = Buffer.byteLength(data);

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = "";
                res.on("data", chunk => body += chunk);
                res.on("end", () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(body ? JSON.parse(body) : null);
                        } catch (e) {
                            resolve(null);
                        }
                    } else {
                        reject(new Error(`${method} ${path} -> ${res.statusCode}: ${body.slice(0, 200)}`));
                    }
                });
            });
            req.on("error", reject);
            if (data) req.write(data);
            req.end();
        });
    }

    /** Find an open card in the target column whose title or body mentions the URL. */
    async findOpenCard(url) {
        for (let page = 1; page <= 5; page++) {
            const cards = await this.request("GET",
                `/buckets/${this.projectId}/card_tables/lists/${this.columnId}/cards.json?page=${page}`);
            if (!Array.isArray(cards) || cards.length === 0) return null;
            const hit = cards.find(c =>
                (c.title || "").includes(url) || (c.content || "").includes(url));
            if (hit) return hit;
        }
        return null;
    }

    failedChecksOf(run) {
        if (run.error || !run.aiAnalysis || !Array.isArray(run.aiAnalysis.feature_results)) return [];
        return run.aiAnalysis.feature_results
            .filter(f => f.status !== "PASS")
            .map(f => {
                const uiStatus = f.ui_status || f.actual || "N/A";
                const configStatus = f.config_status || f.expected || "N/A";
                return `${f.feature}: ${f.status} (UI: ${uiStatus}, Config: ${configStatus})`;
            });
    }

    /**
     * Create a card (or comment on the existing open one) for a single run.
     * Never throws, so the campfire post always goes out.
     * Returns { action: "created"|"commented"|"none"|"error", cardUrl: string|null }.
     */
    async maybeCreateCard(run, runUrl) {
        try {
            if (!this.isConfigured()) return { action: "none", cardUrl: null };
            const label = this.classify(run);
            const url = String(run.url || "").trim();
            if (!label || !url) return { action: "none", cardUrl: null };

            const runLink = runUrl && runUrl.startsWith("http")
                ? ` <a href="${this.escapeHtml(runUrl)}">Run</a>` : "";

            const existing = await this.findOpenCard(url);
            if (existing) {
                await this.request("POST",
                    `/buckets/${this.projectId}/recordings/${existing.id}/comments.json`, {
                        content: `<p>Reported again by the visual validation bot: ` +
                            `<strong>${this.escapeHtml(run.status)}</strong> ` +
                            `(${this.escapeHtml(label)}).${runLink}</p>`
                    });
                console.log(`[BasecampCardHelper] Commented on existing card ${existing.id} for ${url}`);
                return { action: "commented", cardUrl: existing.app_url };
            }

            let host = url;
            try { host = new URL(url).host; } catch (e) { /* keep full url */ }

            const reason = this.reasonOf(run);
            const failedChecks = this.failedChecksOf(run);
            const checksHtml = failedChecks.length
                ? `<p><strong>Failed checks:</strong></p><ul>` +
                  failedChecks.map(c => `<li>${this.escapeHtml(c)}</li>`).join("") + `</ul>`
                : "";

            const card = await this.request("POST",
                `/buckets/${this.projectId}/card_tables/lists/${this.columnId}/cards.json`, {
                    title: `[Widget ${run.status}] ${run.widgetType} on ${host} – ${label}`,
                    content:
                        `<p><strong>Status:</strong> ${this.escapeHtml(run.status)} (${this.escapeHtml(label)})</p>` +
                        `<p><strong>Widget type:</strong> ${this.escapeHtml(run.widgetType)}</p>` +
                        `<p><strong>Page:</strong> <a href="${this.escapeHtml(url)}">${this.escapeHtml(url)}</a></p>` +
                        (reason ? `<p><strong>Reason:</strong> ${this.escapeHtml(reason)}</p>` : "") +
                        checksHtml +
                        (runUrl && runUrl.startsWith("http")
                            ? `<p><strong>GitHub run:</strong> <a href="${this.escapeHtml(runUrl)}">${this.escapeHtml(runUrl)}</a></p>`
                            : "") +
                        `<p><em>Auto-created by the AI Visual Validation pipeline.</em></p>`
                });

            await this.request("PUT",
                `/buckets/${this.projectId}/card_tables/cards/${card.id}.json`, {
                    title: card.title,
                    assignee_ids: [this.assigneeId]
                });

            console.log(`[BasecampCardHelper] Created card ${card.id} for ${url}`);
            return { action: "created", cardUrl: card.app_url };
        } catch (e) {
            console.warn(`[BasecampCardHelper] Card creation failed: ${e.message}`);
            return { action: "error", cardUrl: null };
        }
    }
}

module.exports = BasecampCardHelper;
