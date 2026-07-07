const https = require('https');

async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    const uuids = [
        "601aca58-fa47-4b49-a10c-1fcb6e7e4683",
        "9da56c8c-eae5-415e-8fa9-82b2b19afc11"
    ];

    for (const uuid of uuids) {
        try {
            const url = `https://api.feedspace.io/v3/embed/${uuid}`;
            const json = await fetchJSON(url);
            console.log(`\n=== Widget UUID: ${uuid} ===`);
            console.log(`Type ID: ${json.type || json.widget_type_id}`);
            console.log(`Builder JS: ${json.builder_js}`);
            console.log(`Feeds count: ${json.widget_data?.feeds?.length}`);
            console.log(`Customization is_show_ratings: ${json.widget_customization?.is_show_ratings}`);
        } catch (e) {
            console.error(`Failed to fetch ${uuid}:`, e.message);
        }
    }
}

run().catch(console.error);
