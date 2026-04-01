// app/music/controllers/reddit-summarize.ts
// POST /api/reddit/summarize
//
// 1. Fetch the Reddit thread via residential proxy (appends .json, depth=10, limit=500)
// 2. Filter: keep all real human comments/replies, strip deleted/removed/AutoModerator/stickied
// 3. Send clean text to Gemini 2.5 Pro → one-paragraph conclusion
//
// Response: { success: true, summary: "...", url }
import express from "express";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { rateLimit } from "express-rate-limit";
import { callGemini } from "../lib/gemini.js";
// ─── Proxy ────────────────────────────────────────────────────────────────────
const PROXY_URL = "http://10.8.0.2:3128";
const proxyAgent = new HttpsProxyAgent(PROXY_URL);
// Mimic a real Chrome browser on macOS — residential proxy handles the IP
const REDDIT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://www.reddit.com/",
};
// ─── URL Helpers ──────────────────────────────────────────────────────────────
function validateRedditUrl(raw) {
    if (!raw || typeof raw !== "string")
        return { valid: false, error: "url is required" };
    try {
        const parsed = new URL(raw.trim());
        if (!parsed.hostname.endsWith("reddit.com"))
            return { valid: false, error: "url must be a reddit.com URL" };
        if (!parsed.pathname.includes("/comments/"))
            return { valid: false, error: "url must be a Reddit post URL (must contain /comments/)" };
        return { valid: true, url: raw.trim() };
    }
    catch {
        return { valid: false, error: "Invalid URL" };
    }
}
function buildJsonUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    // Normalise to www.reddit.com (handles old.reddit.com, reddit.com, share links)
    parsed.hostname = "www.reddit.com";
    const pathname = parsed.pathname.replace(/\/+$/, ""); // strip trailing slashes
    const url = new URL(`https://www.reddit.com${pathname}.json`);
    url.searchParams.set("limit", "500"); // Reddit caps at 500 — request max
    url.searchParams.set("depth", "10"); // nested reply depth
    return url.toString();
}
// ─── Thread Text Extraction ───────────────────────────────────────────────────
const SKIP_AUTHORS = new Set(["AutoModerator", "[deleted]", "BotDefense"]);
const SKIP_BODIES = new Set(["[deleted]", "[removed]", ""]);
function extractComments(children, depth = 0) {
    const lines = [];
    const pad = "  ".repeat(depth);
    for (const child of children) {
        if (child.kind !== "t1")
            continue;
        const { author, body, stickied, replies } = child.data ?? {};
        if (!author || !body)
            continue;
        if (SKIP_AUTHORS.has(author))
            continue;
        if (SKIP_BODIES.has(body?.trim()))
            continue;
        if (stickied)
            continue;
        lines.push(`${pad}${author}: ${body.trim()}`);
        // Recurse into nested replies
        if (replies && typeof replies !== "string") {
            const nested = replies?.data?.children;
            if (Array.isArray(nested) && nested.length > 0) {
                lines.push(...extractComments(nested, depth + 1));
            }
        }
    }
    return lines;
}
function buildCleanText(apiData) {
    const post = apiData[0]?.data?.children?.[0]?.data;
    if (!post)
        throw new Error("Could not parse Reddit post data");
    const parts = [];
    // Title + body
    parts.push(post.title?.trim() ?? "");
    if (post.selftext && !SKIP_BODIES.has(post.selftext.trim())) {
        parts.push(post.selftext.trim());
    }
    parts.push("---");
    // All comments
    const commentChildren = apiData[1]?.data?.children ?? [];
    const commentLines = extractComments(commentChildren);
    if (commentLines.length === 0) {
        throw new Error("Thread has no readable comments");
    }
    parts.push(...commentLines);
    return parts.filter(Boolean).join("\n\n");
}
// ─── Handler ──────────────────────────────────────────────────────────────────
async function summarizeReddit(req, res) {
    const validation = validateRedditUrl(req.body?.url);
    if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
    }
    const { url } = validation;
    const jsonUrl = buildJsonUrl(url);
    console.log("[reddit-summarize] fetching:", jsonUrl);
    try {
        const { data: rawData, status } = await axios.get(jsonUrl, {
            httpsAgent: proxyAgent,
            headers: REDDIT_HEADERS,
            timeout: 30000,
            validateStatus: () => true, // handle status manually
        });
        if (status === 404) {
            res.status(404).json({ success: false, error: "Reddit post not found or private" });
            return;
        }
        if (status === 403 || status === 429) {
            res.status(502).json({ success: false, error: "Reddit blocked the request — try again in a moment" });
            return;
        }
        if (status !== 200) {
            res.status(502).json({ success: false, error: `Reddit returned HTTP ${status}` });
            return;
        }
        if (!Array.isArray(rawData) || rawData.length < 2) {
            res.status(502).json({ success: false, error: "Unexpected Reddit response format" });
            return;
        }
        const cleanText = buildCleanText(rawData);
        console.log(`[reddit-summarize] clean text: ${cleanText.length} chars`);
        const prompt = `Here is a Reddit thread:\n\n${cleanText}\n\nGive me one clear, direct conclusion. What is the final consensus or answer this thread arrives at? No bullet points, no breakdown, no structure — just one paragraph that tells me the bottom line opinion or answer as if a smart friend read the whole thread and summarized it for me.`;
        const summary = await callGemini(prompt);
        console.log("[reddit-summarize] summary ready, length:", summary.length);
        res.json({ success: true, summary: summary.trim(), url });
    }
    catch (err) {
        console.error("[reddit-summarize] error:", err.message);
        res.status(500).json({ success: false, error: err.message || "Failed to summarize thread" });
    }
}
// ─── Route ────────────────────────────────────────────────────────────────────
const redditLimiter = rateLimit({
    windowMs: 60000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: { success: false, error: "Too many requests. Max 10 per minute." },
});
const router = express.Router();
router.post("/reddit/summarize", redditLimiter, summarizeReddit);
export default router;
