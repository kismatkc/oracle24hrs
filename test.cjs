const playwright = require("playwright");

(async () => {
  // Check if '--headed' flag is provided in the command line
  const headless = !process.argv.includes("--headed");

  // Launch Chromium with the headless option set dynamically
  const browser = await playwright.chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Example automation code (replace with your own)
  await page.goto("https://example.com");
  console.log("Page title:", await page.title());

  // Close the browser
  await browser.close();
})();
