import { chromium } from "playwright-extra";

import express, { Request, Response } from "express";

const router = express.Router();

import StealthPlugin from "puppeteer-extra-plugin-stealth";

// register the Playwright Stealth plugin
chromium.use(StealthPlugin());

async function getYoutubeCookies(req: Request, res: Response) {
  let context = null;
  let cookieString = null;

  try {
    const browser = await chromium.launch({
      headless: false,
    });
    context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(
      "https://accounts.google.com/signin/v2/identifier?service=youtube"
    );
    await page.fill("#identifierId", "prabimacharya00@gmail.com");
    await page.click("#identifierNext");
    await page.fill('input[type="password"]', "@Kathmandu59");
    await page.click("#passwordNext");
    await page.waitForNavigation();
    const isNotButtonPresent = await page
      .locator(":has-text(/not now/i)")
      .count();
    console.log("Button not present:", isNotButtonPresent);
    const isCancelButtonPresent = await page
      .locator(":has-text(/cancel/i)")
      .count();
    console.log("Cancel button present:", isCancelButtonPresent);

    const isSkipButtonPresent = await page
      .locator(":has-text(/skip/i)")
      .count();
    console.log("Skip button present:", isSkipButtonPresent);

    const cookies = await context.cookies();
    cookieString = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    await page.close();

    res.json({
      data: cookieString,
    });
  } catch (error) {
    res.status(200).json({ error });
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.error("Error closing browser:", error);
      }
    }
  }
}

router.get("/get-youtube-cookie", getYoutubeCookies);
export default router;
