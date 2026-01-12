// app/scraper/controllers/scrape-lyrisc.ts
import express from "express";
import { getBrowser } from "../playright.js";
import axios from "axios";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
const router = express.Router();
/** 15 seconds hard guard */
const globalTimeout = 1000 * 15;
/* ───────────────────────────── Utilities / Debug ───────────────────────────── */
const mask = (val) => {
    if (!val)
        return "(empty)";
    if (val.length <= 8)
        return "*".repeat(val.length);
    return `${val.slice(0, 4)}****${val.slice(-4)}`;
};
const preview = (s, max = 160) => s.length > max ? s.slice(0, max) + "…" : s;
const logDivider = (label) => console.log(`\n──────── ${label} ────────`);
/* ───────────────────────────── Lyric extraction ───────────────────────────── */
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
    // collapse consecutive blanks to max 1
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
/* ───────────────────────────── Google Search ───────────────────────────── */
async function getGoogleSearchFirstResult(query) {
    try {
        console.log(`scraper > Searching Google for: ${query}`);
        console.log(`scraper > Using API Key: ${mask(process.env.GOOGLE_NOBILLING_API_KEY)}`);
        const modifiedQuery = `${query} lyrics and chords`;
        console.log(`scraper > Final query sent: "${modifiedQuery}"`);
        console.log(`scraper > Using GOOGLE_NOBILLING_API_KEY_2: ${mask(process.env.GOOGLE_NOBILLING_API_KEY_2)}`);
        console.log(`scraper > Using SEARCHENGINE_ID_2: ${process.env.SEARCHENGINE_ID_2 || "(empty)"}`);
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
        results.slice(0, 8).forEach((r, i) => console.log(`scraper > [${i}] ${preview(r.title || "")} :: ${preview(r.link || "", 120)}`));
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
        console.log("scraper > Sorted by (lyrics/chords) score.");
        return sortedResults;
    }
    catch (error) {
        console.log("scraper > Error fetching Google search results:", error.response?.data || error.message);
        return [];
    }
}
/* ───────────────────────────── Route ───────────────────────────── */
async function scrapeLyrisc(req, res) {
    let context = null;
    let responded = false;
    const safeRespond = (status, payload) => {
        if (responded)
            return;
        responded = true;
        try {
            res.status(status).json(payload);
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
        safeRespond(200, { status: 200, message: "Lyrics not found", data: {} });
    }, globalTimeout);
    try {
        const { songName, linkIndex } = req.query;
        logDivider("REQUEST");
        console.log("scraper > songName:", songName);
        console.log("scraper > linkIndex (raw):", linkIndex);
        if (!songName || !songName.trim()) {
            throw new Error("Missing required parameter: songName");
        }
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
            proxy: {
                server: 'http://10.8.0.2:3128'
            }
        });
        const page = await context.newPage();
        // Fetch search results
        logDivider("GOOGLE SEARCH");
        const results = await getGoogleSearchFirstResult(songName.toLowerCase());
        if (!results || results.length === 0) {
            throw new Error("No search results found for the song");
        }
        const idx = Number.isFinite(Number(linkIndex)) ? Number(linkIndex) : 0;
        const chosen = results[idx];
        if (!chosen) {
            throw new Error(`linkIndex ${linkIndex} is out of range (max ${results.length - 1})`);
        }
        const url = chosen.link;
        console.log("scraper > Chosen URL:", url);
        console.log("scraper > Chosen Title:", chosen.title);
        logDivider("NAVIGATE");
        const navResp = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
        });
        console.log("scraper > page.goto done. Final URL:", page.url());
        console.log("scraper > HTTP status:", navResp?.status());
        // Let dynamic content load more fully
        await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {
            console.log("scraper > networkidle wait skipped/timeout");
        });
        const title = await page.title();
        console.log("scraper > Page title:", title);
        // Snapshot the HTML
        const pageHtml = await page.content();
        console.log("scraper > HTML length:", pageHtml.length);
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
                console.log("scraper > Readability parse OK. content length:", result.content?.length || 0);
                try {
                    lyrics = extractLyricsFromReadability(result);
                    readabilityUseful = lyrics.length > 0;
                    console.log("scraper > Lines from Readability:", lyrics.length);
                }
                catch (e) {
                    console.log("scraper > extractLyricsFromReadability error:", e.message);
                }
            }
            else {
                console.warn("scraper > Readability returned null (no article-like content).");
            }
        }
        catch (e) {
            console.warn("scraper > Readability step threw:", e.message);
        }
        logDivider("FALLBACK #1 (DENSE BLOCK)");
        if (!lyrics.length) {
            const denseInner = await page.evaluate(() => {
                const blockTags = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "P", "TD"]);
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
                    const lines = text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
                    const shortLines = lines.filter((l) => l.length <= 120).length;
                    const score = brs * 3 + shortLines + Math.min(text.length / 50, 40);
                    if (!best || score > best.score)
                        best = { el, score };
                }
                return best?.el?.innerHTML || "";
            });
            console.log("scraper > Dense block HTML length:", denseInner?.length || 0);
            if (denseInner) {
                try {
                    const lines = extractLyricsFromHtml(denseInner);
                    console.log("scraper > Dense block lines:", lines.length);
                    if (lines.length)
                        lyrics = lines;
                }
                catch (e) {
                    console.log("scraper > Dense block extraction error:", e.message);
                }
            }
            else {
                console.log("scraper > No dense block candidate found.");
            }
        }
        logDivider("FALLBACK #2 (SITE-AWARE)");
        if (!lyrics.length) {
            const siteHtml = await page.evaluate(() => {
                const geniusNodes = document.querySelectorAll('[data-lyrics-container]');
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
            console.log("scraper > Site-aware HTML length:", siteHtml?.length || 0);
            if (siteHtml) {
                try {
                    const lines = extractLyricsFromHtml(siteHtml);
                    console.log("scraper > Site-aware lines:", lines.length);
                    if (lines.length)
                        lyrics = lines;
                }
                catch (e) {
                    console.log("scraper > Site-aware extraction error:", e.message);
                }
            }
            else {
                console.log("scraper > No site-aware content matched.");
            }
        }
        logDivider("RESULT");
        console.log("scraper > Used Readability:", readabilityTried, "Useful:", readabilityUseful);
        console.log("scraper > Final URL:", page.url());
        console.log("scraper > Total lines:", lyrics.length);
        console.log("scraper > Preview:", preview(lyrics.join(" | "), 300));
        clearTimeout(timeoutId);
        if (!lyrics.length) {
            console.warn("scraper > Lyrics not found after all attempts.");
            safeRespond(200, {
                status: 200,
                message: "Lyrics not found",
                data: { url: page.url(), title },
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
        console.error("scraper > Error in scrapeLyrisc:", error?.message || error);
        safeRespond(500, {
            error: error?.message,
            stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
        });
    }
    finally {
        if (context) {
            try {
                await context.close();
                console.log("scraper > Browser context closed.");
            }
            catch (error) {
                console.error("scraper > Error closing browser:", error?.message || error);
            }
        }
    }
}
router.get("/scrape-lyrics", scrapeLyrisc);
export default router;
