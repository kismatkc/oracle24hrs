// app/music/lib/playright.ts
import { chromium } from "playwright";
let browser = null;
export async function getBrowser() {
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
    }
    return browser;
}
export async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}
