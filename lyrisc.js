import axios from "axios";
import { chromium } from "playwright";

async function getLyricsScreenshot() {
  let context = null;

  try {
    const browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });

    await page.goto("https://www.musixmatch.com/lyrics/Eminem/Rap-God/", {
      waitUntil: "networkidle",
    });

    const h2Position = page.locator('text="Lyrics of Rap God by Eminem"');
    const parent = h2Position.locator("xpath=..");
    // parent.evaluate((el) => {
    //   console.log(el.className);
    // });

    await parent.screenshot({
      path: "screenshot.png",
      fullPage: true,
    });
    // const response = await
  } catch (error) {
    console.log(error);
  }
}

getLyricsScreenshot();
