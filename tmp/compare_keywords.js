
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('reports/current_progress.json', 'utf8'));
const keywordRuns = data.runs.filter(r => r.url.includes('keywords.am'));

console.log(`Found ${keywordRuns.length} runs for keywords.am`);

keywordRuns.slice(-2).forEach((run, i) => {
    console.log(`\n--- RUN ${i + 1} (${run.timestamp}) ---`);
    console.log(`Status: ${run.status}`);
    console.log(`Summary Status: ${run.summary_results?.overall_status}`);
    
    run.aesthetic_results?.forEach(res => {
        if (res.status === 'FAIL') {
            console.log(`FAIL Category: ${res.category}`);
            console.log(`Issue: ${res.issue}`);
        }
    });
    
    console.log('--- REASONING SNIPPET ---');
    console.log(run.aiAnalysis?.substring(0, 500));
});
