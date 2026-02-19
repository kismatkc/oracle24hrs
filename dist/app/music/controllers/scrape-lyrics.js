// app/music/controllers/scrape-lyrics.ts
// Lyrics controller — Hybrid waterfall:
//   1. LRCLIB  (fast, ~200ms, synced or plain)
//   2. Genius  (API search → scrape song page, ~1-2s)
//   3. Google  (return top-10 URLs to frontend; frontend chooses cheerio/playwright)
//   /scrape-lyrics/extract — scrape a single URL with cheerio OR playwright
import express from "express";
import { getBrowser } from "../lib/playright.js";
import axios from "axios";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import * as cheerio from "cheerio";
const router = express.Router();
const logDivider = (label) => console.log(`\n──────── ${label} ────────`);
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
            timeout: 3000,
            headers: {
                "User-Agent": "MusicApp/1.0 (https://github.com/music-app)",
            },
        });
        const data = response.data;
        if (data.syncedLyrics) {
            console.log(`[LRCLIB] ✅ Found SYNCED lyrics for "${trackName}"`);
            return {
                found: true,
                synced: data.syncedLyrics,
                plain: data.plainLyrics,
            };
        }
        if (data.plainLyrics) {
            console.log(`[LRCLIB] ✅ Found PLAIN lyrics for "${trackName}"`);
            return { found: true, plain: data.plainLyrics };
        }
        console.log(`[LRCLIB] ❌ No lyrics found for "${trackName}"`);
        return { found: false };
    }
    catch (error) {
        if (error.response?.status === 404) {
            console.log(`[LRCLIB] ❌ Not found: "${trackName}"`);
        }
        else {
            console.log(`[LRCLIB] ⚠️ API error:`, error.message || error);
        }
        return { found: false };
    }
}
function parseSyncedToPlainLines(syncedLyrics) {
    return syncedLyrics
        .split("\n")
        .map((line) => line.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, "").trim())
        .filter((line) => line.length > 0 || line === "");
}
async function tryGenius(trackName, artistName) {
    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) {
        console.log("[Genius] ⚠️ No GENIUS_ACCESS_TOKEN env, skipping");
        return { found: false };
    }
    try {
        const query = artistName ? `${trackName} ${artistName}` : trackName;
        console.log(`[Genius] Searching: "${query}"`);
        const searchRes = await axios.get("https://api.genius.com/search", {
            params: { q: query },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
        });
        const hits = searchRes.data?.response?.hits || [];
        const songHit = hits.find((h) => h.type === "song" && h.result.lyrics_state === "complete");
        if (!songHit) {
            console.log(`[Genius] ❌ No complete lyrics result for "${query}"`);
            return { found: false };
        }
        const songUrl = songHit.result.url;
        console.log(`[Genius] Found: "${songHit.result.full_title}" → ${songUrl}`);
        // Genius aggressively blocks plain HTTP scrapers (403).
        // Try cheerio first, fall back to Playwright for the Genius page.
        let lyrics = await scrapeUrlWithCheerio(songUrl);
        if (lyrics.length === 0) {
            console.log("[Genius] Cheerio failed/403 — trying Playwright for Genius page");
            lyrics = await scrapeUrlWithPlaywright(songUrl);
        }
        if (lyrics.length > 0) {
            console.log(`[Genius] ✅ Scraped ${lyrics.length} lines`);
            return { found: true, lyrics };
        }
        console.log("[Genius] ❌ Page scraped but no lyrics extracted");
        return { found: false };
    }
    catch (error) {
        console.log(`[Genius] ⚠️ Error:`, error.message || error);
        return { found: false };
    }
}
// ============================================================
// HTML extraction helpers (shared between Cheerio & Playwright)
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
// ============================================================
// Cheerio Scraper — HTTP fetch + cheerio/JSDOM (no browser)
// ============================================================
async function scrapeUrlWithCheerio(url) {
    try {
        console.log(`[Cheerio] Fetching: ${url}`);
        const { data: html } = await axios.get(url, {
            timeout: 10000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });
        const $ = cheerio.load(html);
        // Genius
        const geniusContainers = $("[data-lyrics-container]");
        if (geniusContainers.length) {
            const rawHtml = geniusContainers
                .map((_, el) => $(el).html())
                .get()
                .join("<br/>");
            const lines = extractLyricsFromHtml(rawHtml);
            if (lines.length) {
                console.log(`[Cheerio] ✅ Genius selector (${lines.length} lines)`);
                return lines;
            }
        }
        // AZLyrics
        const azColumn = $(".col-xs-12.col-lg-8.text-center");
        if (azColumn.length) {
            const guess = azColumn.find("div").filter(function () {
                return !$(this).attr("class") && !$(this).attr("id");
            });
            if (guess.length) {
                const lines = extractLyricsFromHtml(guess.first().html() || "");
                if (lines.length) {
                    console.log(`[Cheerio] ✅ AZLyrics selector (${lines.length} lines)`);
                    return lines;
                }
            }
        }
        // Generic .lyric-body / .lyrics-body
        const lyricsBody = $(".lyric-body, .lyrics-body");
        if (lyricsBody.length) {
            const lines = extractLyricsFromHtml(lyricsBody.first().html() || "");
            if (lines.length) {
                console.log(`[Cheerio] ✅ lyrics-body selector (${lines.length} lines)`);
                return lines;
            }
        }
        // Readability fallback
        try {
            const dom = new JSDOM(html, { url });
            const doc = dom.window.document;
            if (isProbablyReaderable(doc)) {
                const reader = new Readability(doc);
                const article = reader.parse();
                if (article) {
                    const lines = extractLyricsFromReadability(article);
                    if (lines.length) {
                        console.log(`[Cheerio] ✅ Readability (${lines.length} lines)`);
                        return lines;
                    }
                }
            }
        }
        catch { }
        // Dense-block heuristic
        const blockTags = ["div", "section", "article", "main", "p", "td"];
        let bestScore = 0;
        let bestHtml = "";
        for (const tag of blockTags) {
            $(tag).each((_, el) => {
                const text = $(el).text().trim();
                if (!text)
                    return;
                const brs = $(el).find("br").length;
                const textLines = text
                    .split(/\n+/)
                    .map((x) => x.trim())
                    .filter(Boolean);
                const shortLines = textLines.filter((l) => l.length <= 120).length;
                const score = brs * 3 + shortLines + Math.min(text.length / 50, 40);
                if (score > bestScore) {
                    bestScore = score;
                    bestHtml = $(el).html() || "";
                }
            });
        }
        if (bestHtml) {
            const lines = extractLyricsFromHtml(bestHtml);
            if (lines.length) {
                console.log(`[Cheerio] ✅ Dense-block heuristic (${lines.length} lines)`);
                return lines;
            }
        }
        console.log("[Cheerio] ❌ No lyrics extracted");
        return [];
    }
    catch (error) {
        console.log(`[Cheerio] ⚠️ Error:`, error.message);
        return [];
    }
}
// ============================================================
// Playwright Scraper — Full browser render
// ============================================================
async function scrapeUrlWithPlaywright(url) {
    let context = null;
    try {
        console.log(`[Playwright] Navigating: ${url}`);
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
            proxy: { server: "http://10.8.0.2:3128" },
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page
            .waitForLoadState("networkidle", { timeout: 12000 })
            .catch(() => { });
        const pageHtml = await page.content();
        let lyrics = [];
        // Readability
        try {
            const dom = new JSDOM(pageHtml, { url: page.url() });
            const doc = dom.window.document;
            if (isProbablyReaderable(doc)) {
                const reader = new Readability(doc);
                const article = reader.parse();
                if (article)
                    lyrics = extractLyricsFromReadability(article);
            }
        }
        catch { }
        // Dense-block (in-browser)
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
                    const textLines = text
                        .split(/\n+/)
                        .map((x) => x.trim())
                        .filter(Boolean);
                    const shortLines = textLines.filter((l) => l.length <= 120).length;
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
                catch { }
            }
        }
        // Site-aware (in-browser)
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
                catch { }
            }
        }
        console.log(`[Playwright] Result: ${lyrics.length} lines`);
        return lyrics;
    }
    catch (error) {
        console.log(`[Playwright] ⚠️ Error:`, error.message);
        return [];
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { }
        }
    }
}
async function getGoogleSearchResults(query, num = 10, artist) {
    try {
        const base = artist ? `${query} ${artist}` : query;
        console.log(`[Google] Searching: "${base}"`);
        const modifiedQuery = `${base} lyrics and chords`;
        const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
            params: {
                key: process.env.GOOGLE_NOBILLING_API_KEY_2,
                cx: process.env.SEARCHENGINE_ID_2,
                q: modifiedQuery,
                num,
                siteSearch: "youtube.com reddit.com spotify.com facebook.com instagram.com dailymotion.com wikipedia.org quora.com",
                siteSearchFilter: "e",
            },
            timeout: 10000,
        });
        const items = response.data.items || [];
        console.log(`[Google] Returned ${items.length} results`);
        const sorted = items.sort((a, b) => {
            const titleA = (a.title || "").toLowerCase();
            const titleB = (b.title || "").toLowerCase();
            const scoreA = (titleA.includes("lyrics") ? 2 : 0) +
                (titleA.includes("chord") ? 1 : 0);
            const scoreB = (titleB.includes("lyrics") ? 2 : 0) +
                (titleB.includes("chord") ? 1 : 0);
            return scoreB - scoreA;
        });
        return sorted.map((item) => ({
            title: item.title || "",
            link: item.link || "",
            snippet: item.snippet || "",
        }));
    }
    catch (error) {
        console.log("[Google] ⚠️ Search error:", error.response?.data || error.message);
        return [];
    }
}
// ============================================================
// MAIN ROUTE — GET /scrape-lyrics
// Runs ALL sources in parallel, returns combined results so the
// frontend can show tabs (LRCLIB | Genius | Cheerio | Playwright)
// ============================================================
async function scrapeLyrics(req, res) {
    const { songName, artist, duration } = req.query;
    logDivider("LYRICS REQUEST (ALL SOURCES)");
    console.log("scraper > songName:", songName);
    console.log("scraper > artist:", artist || "(not provided)");
    console.log("scraper > duration:", duration || "(not provided)");
    if (!songName || !songName.trim()) {
        res.status(400).json({ status: 400, message: "Missing: songName" });
        return;
    }
    const trimmedName = songName.trim();
    const trimmedArtist = artist?.trim();
    const parsedDuration = duration ? parseFloat(duration) : undefined;
    // ── Run ALL sources truly in parallel ─────────────────
    // LRCLIB, Genius, and Google→Cheerio+Playwright all fire at the same
    // time.  The Google chain waits for URLs internally, but the other
    // two sources are NOT blocked by it — zero waterfall.
    logDivider("PARALLEL: ALL SOURCES (LRCLIB + GENIUS + GOOGLE→SCRAPE)");
    // Google chain: search → scrape first URL with both Cheerio + Playwright
    async function googleChain() {
        const urls = await getGoogleSearchResults(trimmedName.toLowerCase(), 10, trimmedArtist);
        let cheerioFirst = {
            found: false,
            lyrics: [],
        };
        let playwrightFirst = {
            found: false,
            lyrics: [],
        };
        if (urls.length > 0) {
            const firstUrl = urls[0].link;
            console.log(`scraper > Google first URL: ${firstUrl}`);
            const [cLines, pLines] = await Promise.all([
                scrapeUrlWithCheerio(firstUrl).catch(() => []),
                scrapeUrlWithPlaywright(firstUrl).catch(() => []),
            ]);
            if (cLines.length > 0)
                cheerioFirst = { found: true, lyrics: cLines };
            if (pLines.length > 0)
                playwrightFirst = { found: true, lyrics: pLines };
        }
        return { urls, cheerioFirst, playwrightFirst };
    }
    const [lrcResult, geniusResult, googleData] = await Promise.all([
        tryLrcLib(trimmedName, trimmedArtist, parsedDuration),
        tryGenius(trimmedName, trimmedArtist),
        googleChain(),
    ]);
    const googleResults = googleData.urls;
    const cheerioFirst = googleData.cheerioFirst;
    const playwrightFirst = googleData.playwrightFirst;
    // Build LRCLIB response
    const lrclibData = {
        found: false,
        type: null,
        lyrics: [],
        syncedLyrics: null,
    };
    if (lrcResult.found && lrcResult.synced) {
        lrclibData.found = true;
        lrclibData.type = "synced";
        lrclibData.lyrics = parseSyncedToPlainLines(lrcResult.synced);
        lrclibData.syncedLyrics = lrcResult.synced;
    }
    else if (lrcResult.found && lrcResult.plain) {
        lrclibData.found = true;
        lrclibData.type = "plain";
        lrclibData.lyrics = lrcResult.plain.split("\n").map((l) => l.trim());
    }
    // Build Genius response
    const geniusData = {
        found: false,
        lyrics: [],
    };
    if (geniusResult.found && geniusResult.lyrics?.length) {
        geniusData.found = true;
        geniusData.lyrics = geniusResult.lyrics;
    }
    console.log(`\n── RESULTS SUMMARY ──`);
    console.log(`  LRCLIB:     ${lrclibData.found ? `✅ ${lrclibData.lyrics.length} lines (${lrclibData.type})` : "❌"}`);
    console.log(`  Genius:     ${geniusData.found ? `✅ ${geniusData.lyrics.length} lines` : "❌"}`);
    console.log(`  Google:     ${googleResults.length} URLs`);
    console.log(`  Cheerio#1:  ${cheerioFirst.found ? `✅ ${cheerioFirst.lyrics.length} lines` : "❌"}`);
    console.log(`  Playwright#1: ${playwrightFirst.found ? `✅ ${playwrightFirst.lyrics.length} lines` : "❌"}`);
    res.json({
        status: 200,
        lrclib: lrclibData,
        genius: geniusData,
        googleResults,
        cheerioFirst,
        playwrightFirst,
    });
}
// ============================================================
// EXTRACT ROUTE — GET /scrape-lyrics/extract?url=&method=cheerio|playwright
// ============================================================
async function extractFromUrl(req, res) {
    const url = req.query.url;
    const method = req.query.method || "cheerio";
    if (!url) {
        res.status(400).json({ status: 400, message: "Missing url", lyrics: [] });
        return;
    }
    logDivider(`EXTRACT (${method.toUpperCase()})`);
    console.log(`scraper > URL: ${url}`);
    try {
        const lyrics = method === "playwright"
            ? await scrapeUrlWithPlaywright(url)
            : await scrapeUrlWithCheerio(url);
        res.json({
            status: 200,
            message: lyrics.length ? "Lyrics found" : "No lyrics extracted",
            source: method,
            type: "plain",
            lyrics,
        });
    }
    catch (error) {
        console.error(`[Extract] Error:`, error.message);
        res.status(500).json({ status: 500, message: error.message, lyrics: [] });
    }
}
// ============================================================
// INDIVIDUAL SOURCE ROUTES — Each fires independently so the
// frontend can show results as they arrive (zero waterfall).
// ============================================================
async function lrclibRoute(req, res) {
    const { songName, artist, duration } = req.query;
    if (!songName?.trim()) {
        res.status(400).json({ status: 400, message: "Missing: songName" });
        return;
    }
    logDivider("LRCLIB (individual)");
    const result = await tryLrcLib(songName.trim(), artist?.trim(), duration ? parseFloat(duration) : undefined);
    const data = { found: false, type: null, lyrics: [], syncedLyrics: null };
    if (result.found && result.synced) {
        data.found = true;
        data.type = "synced";
        data.lyrics = parseSyncedToPlainLines(result.synced);
        data.syncedLyrics = result.synced;
    }
    else if (result.found && result.plain) {
        data.found = true;
        data.type = "plain";
        data.lyrics = result.plain.split("\n").map((l) => l.trim());
    }
    res.json({ status: 200, ...data });
}
async function geniusRoute(req, res) {
    const { songName, artist } = req.query;
    if (!songName?.trim()) {
        res.status(400).json({ status: 400, message: "Missing: songName" });
        return;
    }
    logDivider("GENIUS (individual)");
    const result = await tryGenius(songName.trim(), artist?.trim());
    res.json({
        status: 200,
        found: result.found,
        lyrics: result.lyrics || [],
    });
}
async function googleRoute(req, res) {
    const { songName, artist } = req.query;
    if (!songName?.trim()) {
        res.status(400).json({ status: 400, message: "Missing: songName" });
        return;
    }
    logDivider("GOOGLE URLS (individual)");
    const results = await getGoogleSearchResults(songName.trim().toLowerCase(), 10, artist?.trim());
    res.json({ status: 200, googleResults: results });
}
// ── Register routes ──────────────────────────────────────────
// More-specific paths FIRST so Express won't short-circuit.
router.get("/scrape-lyrics/lrclib", lrclibRoute);
router.get("/scrape-lyrics/genius", geniusRoute);
router.get("/scrape-lyrics/google", googleRoute);
router.get("/scrape-lyrics/extract", extractFromUrl);
router.get("/scrape-lyrics", scrapeLyrics);
export default router;
