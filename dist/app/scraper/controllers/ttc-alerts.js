import express from "express";
import { getBrowser } from "../playright.js";
const router = express.Router();
async function getTtcAlerts(req, res) {
    let context = null;
    try {
        const browser = await getBrowser();
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("https://www.ttc.ca/service-alerts", {
            waitUntil: "networkidle",
        });
        const news = await page.waitForSelector("#react-tabs-1 > ul", {
            state: "visible",
        });
        const alerts = await news?.evaluate((el) => {
            const liCollection = Array.from(el.querySelectorAll("li")).map((item) => item.textContent?.trim());
            return liCollection;
        });
        res.json({
            data: alerts || [],
        });
    }
    catch (error) {
        res.status(200).json({ error });
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch (error) {
                console.error("Error closing browser:", error);
            }
        }
    }
}
router.get("/scrape-news", getTtcAlerts);
export default router;
