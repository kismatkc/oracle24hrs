// app/music/controllers/scrape-lyrics.ts
import express from "express";
import { getBrowser } from "../lib/playright.js";
import axios from "axios";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
const router = express.Router();
const globalTimeout = 1000 * 15;
const mask = (val) => {
    if (!val)
        return "(empty)";
    if (val.length <= 8)
        return "*".repeat(val.length);
    return `${val.slice(0, 4)}****${val.slice(-4)}`;
};
const preview = (s, max = 160) => s.length > max ? s.slice(0, max) + "…" : s;
const logDivider = (label) => console.log(`\n──────── ${label} ────────`);
/**
 * Try to fetch lyrics from LRCLIB API first (fast, ~200ms)
 * Returns synced lyrics with timestamps if available
 */
async function tryLrcLib(trackName, artistName, duration) {
    try {
        const params = new URLSearchParams();
        params.set("track_name", trackName);
        if (artistName)
            params.set("artist_name", artistName);
        if (duration && duration > 0)
            params.set("duration", String(Math.round(duration)));
        const url = `https://lrclib.net/api/get?${params.toString()}`;
        console.log(`[LRCLIB] Checking: ${url}`);
        const response = await axios.get(url, {
            timeout: 3000, // 3 second timeout - fail fast
            headers: {
                "User-Agent": "MusicApp/1.0 (https://github.com/music-app)",
            },
        });
        const data = response.data;
        // Check if we got valid lyrics
        if (data.syncedLyrics) {
            console.log(`[LRCLIB] ✅ Found SYNCED lyrics for "${trackName}"`);
            return { found: true, synced: data.syncedLyrics, plain: data.plainLyrics };
        }
        if (data.plainLyrics) {
            console.log(`[LRCLIB] ✅ Found PLAIN lyrics for "${trackName}" (no sync data)`);
            return { found: true, plain: data.plainLyrics };
        }
        console.log(`[LRCLIB] ❌ No lyrics found for "${trackName}"`);
        return { found: false };
    }
    catch (error) {
        // Don't log full errors for 404s - they're expected
        if (error.response?.status === 404) {
            console.log(`[LRCLIB] ❌ Not found: "${trackName}"`);
        }
        else {
            console.log(`[LRCLIB] ⚠️ API error:`, error.message || error);
        }
        return { found: false };
    }
}
/**
 * Parse synced lyrics format "[mm:ss.xx] text" into plain text lines
 */
function parseSyncedToPlainLines(syncedLyrics) {
    return syncedLyrics
        .split("\n")
        .map((line) => {
        // Remove timestamp prefix like [00:12.40]
        return line.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, "").trim();
    })
        .filter((line) => line.length > 0 || line === ""); // Keep empty lines for verse breaks
}
// ============================================================
// Existing Google/Playwright Scraper (unchanged)
// ============================================================
const extractLyricsFromReadability = (jsonResponse) => {
    const { content: htmlContent } = jsonResponse ?? {};
    if (!htmlContent || typeof htmlContent !== "string") {
        throw new Error("Invalid JSON response: missing or invalid content field");
    }
    return extractLyricsFromHtml(htmlContent);
};
const extractLyricsFromHtml = (html) => {
    const dom = new JSDOM(html);
    const { document, Node } = dom.window;
    const rootNode = document.querySelector("#readability-page-1") ||
        document.body ||
        document.documentElement;
    if (!rootNode) {
        throw new Error("Could not find valid root node in HTML content");
    }
    const lines = [];
    let currentBuffer = "";
    const blockElements = new Set([
        "P",
        "DIV",
        "BLOCKQUOTE",
        "LI",
        "UL",
        "OL",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "SECTION",
        "ARTICLE",
        "HEADER",
        "FOOTER",
        "MAIN",
        "ASIDE",
        "NAV",
        "PRE",
    ]);
    const flushBuffer = () => {
        if (currentBuffer.trim()) {
            lines.push(currentBuffer.trim());
            currentBuffer = "";
        }
    };
    const traverseNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            currentBuffer += node.textContent || "";
        }
        else if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node;
            const tagName = element.tagName.toUpperCase();
            if (tagName === "BR") {
                flushBuffer();
            }
            else if (blockElements.has(tagName)) {
                flushBuffer();
                for (const child of element.childNodes) {
                    traverseNode(child);
                }
                flushBuffer();
                if (lines.length > 0 && lines[lines.length - 1] !== "") {
                    lines.push("");
                }
            }
            else {
                for (const child of element.childNodes) {
                    traverseNode(child);
                }
            }
        }
    };
    traverseNode(rootNode);
    flushBuffer();
    const cleanLines = lines.reduce((acc, line) => {
        const trimmedLine = line.trim();
        const lastLine = acc[acc.length - 1];
        if (trimmedLine === "") {
            if (lastLine && lastLine !== "")
                acc.push("");
        }
        else {
            acc.push(trimmedLine);
        }
        return acc;
    }, []);
    const refinedLines = cleanLines.reduce((acc, line) => {
        if (line === "") {
            let consecutiveEmptyCount = 0;
            for (let i = acc.length - 1; i >= 0; i--) {
                if (acc[i] === "")
                    consecutiveEmptyCount++;
                else
                    break;
            }
            if (consecutiveEmptyCount < 1)
                acc.push("");
        }
        else {
            acc.push(line);
        }
        return acc;
    }, []);
    return refinedLines;
};
async function getGoogleSearchFirstResult(query) {
    try {
        console.log(`scraper > Searching Google for: ${query}`);
        const modifiedQuery = `${query} lyrics and chords`;
        console.log(`scraper > Final query sent: "${modifiedQuery}"`);
        const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
            params: {
                key: process.env.GOOGLE_NOBILLING_API_KEY_2,
                cx: process.env.SEARCHENGINE_ID_2,
                q: modifiedQuery,
                num: 8,
                siteSearch: "youtube.com reddit.com spotify.com facebook.com instagram.com dailymotion.com wikipedia.org quora.com",
                siteSearchFilter: "e",
            },
            timeout: 10000,
        });
        const results = response.data.items || [];
        console.log(`scraper > Google returned ${results.length} results`);
        if (results.length === 0)
            return [];
        const sortedResults = results.sort((a, b) => {
            const titleA = (a.title || "").toLowerCase();
            const titleB = (b.title || "").toLowerCase();
            const hasLyricsA = titleA.includes("lyrics");
            const hasLyricsB = titleB.includes("lyrics");
            const hasChordsA = titleA.includes("chord");
            const hasChordsB = titleB.includes("chord");
            const scoreA = (hasLyricsA ? 2 : 0) + (hasChordsA ? 1 : 0);
            const scoreB = (hasLyricsB ? 2 : 0) + (hasChordsB ? 1 : 0);
            return scoreB - scoreA;
        });
        return sortedResults;
    }
    catch (error) {
        console.log("scraper > Error fetching Google search results:", error.response?.data || error.message);
        return [];
    }
}
// ============================================================
// Main Lyrics Handler - Hybrid Flow
// ============================================================
async function scrapeLyrics(req, res) {
    const { songName, artist, duration, linkIndex } = req.query;
    logDivider("LYRICS REQUEST");
    console.log("scraper > songName:", songName);
    console.log("scraper > artist:", artist || "(not provided)");
    console.log("scraper > duration:", duration || "(not provided)");
    console.log("scraper > linkIndex:", linkIndex || "0");
    if (!songName || !songName.trim()) {
        res.status(400).json({
            status: 400,
            message: "Missing required parameter: songName",
            source: "error",
            type: "plain",
            lyrics: [],
        });
        return;
    }
    const parsedDuration = duration ? parseFloat(duration) : undefined;
    const parsedLinkIndex = linkIndex ? parseInt(linkIndex, 10) : 0;
    // ─────────────────────────────────────────────────────────
    // STEP 1: Try LRCLIB API first (Fast Pass - ~200ms)
    // Only try LRCLIB on first request (linkIndex = 0)
    // When user clicks "Change lyrics", skip to Google scraper
    // ─────────────────────────────────────────────────────────
    if (parsedLinkIndex === 0) {
        logDivider("STEP 1: LRCLIB FAST PASS");
        const lrcResult = await tryLrcLib(songName.trim(), artist?.trim(), parsedDuration);
        if (lrcResult.found && lrcResult.synced) {
            // Return synced lyrics with timestamps
            console.log("[LRCLIB] Returning SYNCED lyrics - karaoke mode available!");
            res.json({
                status: 200,
                message: "Lyrics found",
                source: "lrclib",
                type: "synced",
                syncedLyrics: lrcResult.synced,
                lyrics: parseSyncedToPlainLines(lrcResult.synced), // Also provide plain for backward compat
            });
            return;
        }
        if (lrcResult.found && lrcResult.plain) {
            // Return plain lyrics from LRCLIB
            console.log("[LRCLIB] Returning PLAIN lyrics from LRCLIB");
            const lines = lrcResult.plain.split("\n").map((l) => l.trim());
            res.json({
                status: 200,
                message: "Lyrics found",
                source: "lrclib",
                type: "plain",
                lyrics: lines,
            });
            return;
        }
        console.log("[LRCLIB] No results, falling back to Google scraper...");
    }
    else {
        console.log(`[LRCLIB] Skipped (linkIndex=${parsedLinkIndex}, user wants alternative source)`);
    }
    // ─────────────────────────────────────────────────────────
    // STEP 2: Fall back to existing Google/Playwright scraper
    // This is the original code, preserved exactly
    // ─────────────────────────────────────────────────────────
    logDivider("STEP 2: GOOGLE/PLAYWRIGHT SCRAPER");
    let context = null;
    let responded = false;
    const safeRespond = (status, payload) => {
        if (responded)
            return;
        responded = true;
        try {
            // Add source/type fields for consistency
            const enhancedPayload = {
                ...payload,
                source: payload.source || "google",
                type: payload.type || "plain",
            };
            res.status(status).json(enhancedPayload);
        }
        catch (e) {
            console.error("scraper > Response send error:", e.message);
        }
    };
    const timeoutId = setTimeout(() => {
        console.warn("scraper > Timeout hit. Closing context and returning fallback.");
        if (context) {
            context.close().catch((e) => {
                console.warn("scraper > Error closing context on timeout:", e.message);
            });
        }
        safeRespond(200, { status: 200, message: "Lyrics not found", data: {}, lyrics: [] });
    }, globalTimeout);
    try {
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
            proxy: {
                server: "http://10.8.0.2:3128",
            },
        });
        const page = await context.newPage();
        logDivider("GOOGLE SEARCH");
        const results = await getGoogleSearchFirstResult(songName.toLowerCase());
        if (!results || results.length === 0) {
            throw new Error("No search results found for the song");
        }
        const idx = Number.isFinite(parsedLinkIndex) ? parsedLinkIndex : 0;
        const chosen = results[idx];
        if (!chosen) {
            throw new Error(`linkIndex ${linkIndex} is out of range (max ${results.length - 1})`);
        }
        const url = chosen.link;
        console.log("scraper > Chosen URL:", url);
        logDivider("NAVIGATE");
        const navResp = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
        });
        console.log("scraper > page.goto done. Final URL:", page.url());
        await page
            .waitForLoadState("networkidle", { timeout: 12000 })
            .catch(() => {
            console.log("scraper > networkidle wait skipped/timeout");
        });
        const title = await page.title();
        const pageHtml = await page.content();
        logDivider("READABILITY");
        let lyrics = [];
        let readabilityTried = false;
        let readabilityUseful = false;
        try {
            const dom = new JSDOM(pageHtml, { url: page.url() });
            const doc = dom.window.document;
            const probablyReadable = isProbablyReaderable(doc);
            console.log("scraper > isProbablyReaderable:", probablyReadable);
            readabilityTried = true;
            const reader = new Readability(doc);
            const result = reader.parse();
            if (result) {
                try {
                    lyrics = extractLyricsFromReadability(result);
                    readabilityUseful = lyrics.length > 0;
                }
                catch (e) {
                    console.log("scraper > extractLyricsFromReadability error:", e.message);
                }
            }
        }
        catch (e) {
            console.warn("scraper > Readability step threw:", e.message);
        }
        logDivider("FALLBACK #1 (DENSE BLOCK)");
        if (!lyrics.length) {
            const denseInner = await page.evaluate(() => {
                const blockTags = new Set([
                    "DIV",
                    "SECTION",
                    "ARTICLE",
                    "MAIN",
                    "P",
                    "TD",
                ]);
                let best = null;
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                while (walker.nextNode()) {
                    const el = walker.currentNode;
                    if (!blockTags.has(el.tagName))
                        continue;
                    const text = (el.textContent || "").trim();
                    if (!text)
                        continue;
                    const brs = el.querySelectorAll("br").length;
                    const lines = text
                        .split(/\n+/)
                        .map((x) => x.trim())
                        .filter(Boolean);
                    const shortLines = lines.filter((l) => l.length <= 120).length;
                    const score = brs * 3 + shortLines + Math.min(text.length / 50, 40);
                    if (!best || score > best.score)
                        best = { el, score };
                }
                return best?.el?.innerHTML || "";
            });
            if (denseInner) {
                try {
                    const lines = extractLyricsFromHtml(denseInner);
                    if (lines.length)
                        lyrics = lines;
                }
                catch (e) { }
            }
        }
        logDivider("FALLBACK #2 (SITE-AWARE)");
        if (!lyrics.length) {
            const siteHtml = await page.evaluate(() => {
                const geniusNodes = document.querySelectorAll("[data-lyrics-container]");
                if (geniusNodes.length) {
                    return Array.from(geniusNodes)
                        .map((n) => n.innerHTML)
                        .join("<br/>");
                }
                const lc = document.querySelector(".lyric-body, .lyrics-body");
                if (lc)
                    return lc.innerHTML;
                const azColumn = document.querySelector(".col-xs-12.col-lg-8.text-center");
                if (azColumn) {
                    const guess = Array.from(azColumn.querySelectorAll("div")).find((d) => !d.className && !d.id);
                    if (guess)
                        return guess.innerHTML;
                }
                return "";
            });
            if (siteHtml) {
                try {
                    const lines = extractLyricsFromHtml(siteHtml);
                    if (lines.length)
                        lyrics = lines;
                }
                catch (e) { }
            }
        }
        logDivider("RESULT");
        console.log("scraper > Total lines:", lyrics.length);
        clearTimeout(timeoutId);
        if (!lyrics.length) {
            safeRespond(200, {
                status: 200,
                message: "Lyrics not found",
                data: { url: page.url(), title },
                lyrics: [],
            });
            return;
        }
        safeRespond(200, {
            status: 200,
            message: "Lyrics found",
            lyrics,
        });
    }
    catch (error) {
        clearTimeout(timeoutId);
        console.error("scraper > Error in scrapeLyrics:", error?.message || error);
        safeRespond(500, {
            error: error?.message,
            stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
            lyrics: [],
        });
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch (error) {
                console.error("scraper > Error closing browser:", error?.message || error);
            }
        }
    }
}
router.get("/scrape-lyrics", scrapeLyrics);
export default router;
