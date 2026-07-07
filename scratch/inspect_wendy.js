const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        console.log("Navigating to page...");
        await page.goto('https://wendydolch.com/binge-the-series-event/', { waitUntil: 'networkidle' });
        console.log("Waiting for Feedspace widget container...");
        await page.waitForTimeout(5000); // Wait for widget to load

        // Find all button, a, span elements in the widget
        const elements = await page.evaluate(() => {
            const widget = document.querySelector('.feedspace-embed') || document.body;
            const context = widget.shadowRoot || widget;
            const items = Array.from(context.querySelectorAll('button, a, span'));
            return items.map(el => ({
                tagName: el.tagName,
                text: el.innerText || el.textContent,
                visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                display: window.getComputedStyle(el).display,
                visibility: window.getComputedStyle(el).visibility,
                className: el.className
            }));
        });

        console.log("Found interactive elements:");
        for (const item of elements) {
            if (/read/i.test(item.text)) {
                console.log(item);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
