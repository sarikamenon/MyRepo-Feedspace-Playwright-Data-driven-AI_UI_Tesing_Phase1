function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().toLowerCase().replace(/\/$/, '');
}

function deduplicate(allApiData) {
    const seenPairs = new Set();
    return allApiData.filter(entry => {
        const rawUrl = typeof entry === 'string' ? entry : (entry.customer_url || entry.url || '');
        const normUrl = normalizeUrl(rawUrl);
        const type = (entry.widget_type || entry.type || '').toLowerCase();
        const id = entry.unique_widget_id || entry.id || '';
        const key = `${normUrl}|${type}|${id}`;
        if (seenPairs.has(key)) return false;
        seenPairs.add(key);
        return true;
    });
}

const testPayload = [
    { url: "https://example.com/page1", type: "CAROUSEL_SLIDER", unique_widget_id: "WIDGET_A" },
    { url: "https://example.com/page1/", type: "CAROUSEL_SLIDER", unique_widget_id: "WIDGET_A" }, // Duplicate (ID match)
    { url: "https://example.com/page1", type: "CAROUSEL_SLIDER", unique_widget_id: "WIDGET_B" }, // Unique (Different ID)
    { url: "https://example.com/page1", type: "MASONRY", unique_widget_id: "WIDGET_A" },         // Unique (Different Type)
    { url: "https://example.com/page2", type: "CAROUSEL_SLIDER", unique_widget_id: "WIDGET_A" }  // Unique (Different URL)
];

console.log("Original Length:", testPayload.length);
const deduplicated = deduplicate(testPayload);
console.log("Deduplicated Length:", deduplicated.length);
console.log("Results:");
deduplicated.forEach(d => console.log(` - ${d.url} | ${d.type} | ${d.unique_widget_id}`));

if (deduplicated.length === 4) {
    console.log("\n✅ SUCCESS: ID-aware deduplication working (URL+Type+ID unique pairs).");
} else {
    console.log("\n❌ FAILURE: Deduplication logic incorrect.");
    process.exit(1);
}
