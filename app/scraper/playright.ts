import { chromium, Browser } from "playwright";

// Private state
let browserInstance: Browser | null = null;
let restartTimer: NodeJS.Timeout | null = null;

const startBrowser = async (): Promise<void> => {
  try {
    browserInstance = await chromium.launch({
      headless: process.env.ENVIRONMENT === "development" ? false : true,
      // headless: true,
    });
    console.log("Browser started successfully");
  } catch (error) {
    browserInstance = null;
    console.error("Failed to start browser:", error);
    throw error;
  }
};

/**
 * Close the current browser instance if it exists
 */
const closeBrowser = async (): Promise<void> => {
  try {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
      console.log("Browser closed successfully");
    }
  } catch (error) {
    console.error("Error closing browser:", error);
    browserInstance = null;
  }
};

/**
 * Restart the browser instance
 */
const restartBrowser = async (): Promise<void> => {
  try {
    await closeBrowser();
    await startBrowser();
  } catch (error) {
    console.error("Error restarting browser:", error);
  }
};

/**
 * Get the current browser instance or start a new one if none exists
 */
const getBrowser = async (): Promise<Browser> => {
  if (!browserInstance) {
    await startBrowser();
  }

  if (!browserInstance) {
    throw new Error("Failed to initialize browser");
  }

  return browserInstance;
};

/**
 * Configure periodic restart of the browser
 */
const enablePeriodicRestart = (
  intervalMs: number = 24 * 60 * 60 * 1000
): void => {
  // Clear any existing timer
  if (restartTimer) {
    clearInterval(restartTimer);
  }

  restartTimer = setInterval(async () => {
    console.log("Scheduled browser restart");
    await restartBrowser();
  }, intervalMs);

  console.log(
    `Browser will restart every ${intervalMs / (60 * 60 * 1000)} hours`
  );
};

/**
 * Stop periodic browser restarts
 */
const disablePeriodicRestart = (): void => {
  if (restartTimer) {
    clearInterval(restartTimer);
    restartTimer = null;
    console.log("Stopped periodic browser restarts");
  }
};

// Initialize the browser
startBrowser().catch((error) => {
  console.error("Initial browser startup failed:", error);
});

// Enable periodic restarts by default (every 24 hours)
enablePeriodicRestart();

// Export the public API
export {
  getBrowser,
  closeBrowser,
  restartBrowser,
  enablePeriodicRestart,
  disablePeriodicRestart,
  chromium,
};
