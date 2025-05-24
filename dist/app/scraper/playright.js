import { chromium } from "playwright";
// const INV_BASE = "https://yewtu.be/api/v1";
// async function fetchAudioStreams(videoId) {
//   const res = await axios.get(`${INV_BASE}/videos/${videoId}`);
//   const { adaptiveFormats } = await res.data;
//   return adaptiveFormats.filter((f) => f.mimeType.startsWith("audio/"));
// }
// console.log(await fetchAudioStreams("mZQH8CPQ-wo"));
// Private state
let browserInstance = null;
let restartTimer = null;
const startBrowser = async () => {
    try {
        browserInstance = await chromium.launch({
            headless: process.env.ENVIRONMENT === "development" ? false : true,
            // headless: true,
        });
        console.log("Browser started successfully");
    }
    catch (error) {
        browserInstance = null;
        console.error("Failed to start browser:", error);
        throw error;
    }
};
/**
 * Close the current browser instance if it exists
 */
const closeBrowser = async () => {
    try {
        if (browserInstance) {
            await browserInstance.close();
            browserInstance = null;
            console.log("Browser closed successfully");
        }
    }
    catch (error) {
        console.error("Error closing browser:", error);
        browserInstance = null;
    }
};
/**
 * Restart the browser instance
 */
const restartBrowser = async () => {
    try {
        await closeBrowser();
        await startBrowser();
    }
    catch (error) {
        console.error("Error restarting browser:", error);
    }
};
/**
 * Get the current browser instance or start a new one if none exists
 */
const getBrowser = async () => {
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
const enablePeriodicRestart = (intervalMs = 24 * 60 * 60 * 1000) => {
    // Clear any existing timer
    if (restartTimer) {
        clearInterval(restartTimer);
    }
    restartTimer = setInterval(async () => {
        console.log("Scheduled browser restart");
        await restartBrowser();
    }, intervalMs);
    console.log(`Browser will restart every ${intervalMs / (60 * 60 * 1000)} hours`);
};
/**
 * Stop periodic browser restarts
 */
const disablePeriodicRestart = () => {
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
export { getBrowser, closeBrowser, restartBrowser, enablePeriodicRestart, disablePeriodicRestart, chromium, };
