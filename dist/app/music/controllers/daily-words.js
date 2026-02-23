// app/music/controllers/daily-words.ts
// Returns exactly 5 daily vocabulary words with definitions, examples, and French translations.
//
// Architecture:
// 1. Curated word list (~1 533 words) served first, then words_huge.txt (~370K)
// 2. Redis index only moves forward — once a word is served it is never shown again
// 3. Positive cache  (daily-words:cache:{word})  → full WordEntry JSON, permanent
// 4. Negative cache  (daily-words:skip:{word})   → "1", permanent
// 5. Self-hosted LibreTranslate at localhost:5000 for EN → FR translation
// 6. Every returned word MUST have: word, phonetic, partOfSpeech, definition, example,
//    frenchWord, frenchDefinition, frenchExample — all non-empty strings.
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { appRedis } from "../../../lib/appRedis.js";
const router = express.Router();
// ─── Word lists ─────────────────────────────────────────────────────────────
function loadWordList(filename, minLen = 3) {
    try {
        const filePath = path.join(process.cwd(), "app", "data", filename);
        const words = fs
            .readFileSync(filePath, "utf-8")
            .split(/\r?\n/)
            .map((w) => w.trim().toLowerCase())
            .filter((w) => w.length >= minLen && /^[a-z]+$/.test(w));
        console.log(`[daily-words] Loaded ${words.length} words from ${filename}`);
        return words;
    }
    catch (err) {
        console.error(`[daily-words] Failed to load ${filename}:`, err.message);
        return [];
    }
}
const CURATED_WORDS = loadWordList("words_curated.txt");
const HUGE_WORDS = loadWordList("words_huge.txt");
// Combined: curated first, then huge (no duplicates)
const curatedSet = new Set(CURATED_WORDS);
const WORDS = [
    ...CURATED_WORDS,
    ...HUGE_WORDS.filter((w) => !curatedSet.has(w)),
];
console.log(`[daily-words] Combined: ${WORDS.length} total (${CURATED_WORDS.length} curated + ${WORDS.length - CURATED_WORDS.length} huge)`);
// ─── Redis keys ─────────────────────────────────────────────────────────────
const REDIS_INDEX_KEY = "daily-words:index";
const CACHE_PREFIX = "daily-words:cache:";
const SKIP_PREFIX = "daily-words:skip:";
// ─── APIs ───────────────────────────────────────────────────────────────────
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const LIBRE_URL = "http://localhost:5400/translate";
// ─── Translation via self-hosted LibreTranslate ─────────────────────────────
async function translateToFrench(text) {
    if (!text)
        return "";
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(LIBRE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ q: text, source: "en", target: "fr" }),
            });
            if (!res.ok) {
                console.warn(`[daily-words] LibreTranslate HTTP ${res.status} for: "${text.substring(0, 50)}" (attempt ${attempt + 1})`);
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                    continue;
                }
                return "";
            }
            const data = (await res.json());
            const translated = data?.translatedText || "";
            if (translated)
                return translated;
            if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
            return "";
        }
        catch (err) {
            console.warn(`[daily-words] LibreTranslate error for "${text.substring(0, 50)}":`, err.message, `(attempt ${attempt + 1})`);
            if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
            return "";
        }
    }
    return "";
}
// ─── Word lookup with permanent Redis caching ───────────────────────────────
async function lookupWord(word) {
    // ── Positive cache hit ──
    try {
        const cached = await appRedis.get(`${CACHE_PREFIX}${word}`);
        if (cached)
            return JSON.parse(cached);
    }
    catch { /* miss or parse error */ }
    // ── Negative cache hit ──
    try {
        const skip = await appRedis.get(`${SKIP_PREFIX}${word}`);
        if (skip)
            return null;
    }
    catch { /* ignore */ }
    // ── Fresh Dictionary API lookup ──
    try {
        const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`);
        if (!res.ok) {
            await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => { });
            return null;
        }
        const data = (await res.json());
        if (!Array.isArray(data) || data.length === 0) {
            await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => { });
            return null;
        }
        const entry = data[0];
        const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || "";
        // Scan ALL meanings for one with both definition AND example
        let bestMeaning = null;
        let bestDef = null;
        for (const m of entry.meanings || []) {
            for (const d of m.definitions || []) {
                if (d.definition && d.example) {
                    bestMeaning = m;
                    bestDef = d;
                    break;
                }
            }
            if (bestDef)
                break;
        }
        // STRICT: must have definition AND example — no fallback
        if (!bestDef || !bestDef.definition || !bestDef.example) {
            await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => { });
            return null;
        }
        const definition = bestDef.definition;
        const example = bestDef.example;
        const partOfSpeech = bestMeaning?.partOfSpeech || "";
        // Translate word, definition, example → French in parallel
        const [frenchWord, frenchDefinition, frenchExample] = await Promise.all([
            translateToFrench(entry.word || word),
            translateToFrench(definition),
            translateToFrench(example),
        ]);
        // Reject if any French field came back empty
        if (!frenchWord || !frenchDefinition || !frenchExample) {
            console.warn(`[daily-words] Incomplete French translation for "${word}" — skipping`);
            await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => { });
            return null;
        }
        const wordEntry = {
            word: entry.word || word,
            phonetic,
            partOfSpeech,
            definition,
            example,
            frenchWord,
            frenchDefinition,
            frenchExample,
        };
        // Permanent positive cache
        try {
            await appRedis.set(`${CACHE_PREFIX}${word}`, JSON.stringify(wordEntry));
        }
        catch { /* non-critical */ }
        return wordEntry;
    }
    catch (err) {
        console.warn(`[daily-words] lookupWord("${word}") exception:`, err.message);
        return null;
    }
}
// ─── GET /daily-words ───────────────────────────────────────────────────────
router.get("/daily-words", async (req, res) => {
    try {
        if (WORDS.length === 0) {
            res.status(500).json({ error: "Word list not loaded" });
            return;
        }
        const isTestMode = req.query.testMode === "true";
        const BATCH_SIZE = 5;
        const MAX_ATTEMPTS = 300;
        // Current index from Redis
        const rawIndex = await appRedis.get(REDIS_INDEX_KEY);
        let currentIndex = rawIndex ? parseInt(rawIndex, 10) : 0;
        if (isNaN(currentIndex) || currentIndex < 0)
            currentIndex = 0;
        // If list is exhausted (non-test), return friendly completion message
        if (!isTestMode && currentIndex >= WORDS.length) {
            console.log("[daily-words] Vocabulary list exhausted");
            res.json({
                words: [],
                message: "You've completed the entire vocabulary!",
                meta: {
                    totalWords: WORDS.length,
                    curatedWords: CURATED_WORDS.length,
                    currentIndex,
                    attempts: 0,
                    servedAt: new Date().toISOString(),
                },
            });
            return;
        }
        // Test mode: random start, does NOT advance the persistent index
        let idx = isTestMode
            ? Math.floor(Math.random() * WORDS.length)
            : currentIndex;
        const results = [];
        let attempts = 0;
        while (results.length < BATCH_SIZE && attempts < MAX_ATTEMPTS) {
            // In normal mode: if we've hit the end, stop (no wrap)
            if (!isTestMode && idx >= WORDS.length)
                break;
            // In test mode: wrap freely
            if (isTestMode && idx >= WORDS.length)
                idx = 0;
            const word = WORDS[idx];
            idx++;
            attempts++;
            const entry = await lookupWord(word);
            if (entry)
                results.push(entry);
        }
        // Only persist the new index in normal mode
        if (!isTestMode) {
            await appRedis.set(REDIS_INDEX_KEY, String(idx));
        }
        console.log(`[daily-words] Served ${results.length}/${BATCH_SIZE} words in ${attempts} attempts (idx: ${idx}/${WORDS.length})`);
        res.json({
            words: results,
            ...(results.length < BATCH_SIZE && !isTestMode
                ? { message: "You've completed the entire vocabulary!" }
                : {}),
            meta: {
                totalWords: WORDS.length,
                curatedWords: CURATED_WORDS.length,
                currentIndex: idx,
                attempts,
                servedAt: new Date().toISOString(),
            },
        });
    }
    catch (err) {
        console.error("[daily-words] GET error:", err.message);
        res.status(500).json({ error: "Failed to fetch daily words" });
    }
});
// ─── POST /daily-words/reset ────────────────────────────────────────────────
router.post("/daily-words/reset", async (_req, res) => {
    try {
        await appRedis.set(REDIS_INDEX_KEY, "0");
        console.log("[daily-words] Index reset to 0");
        res.json({ ok: true, message: "Word index reset to 0" });
    }
    catch (err) {
        console.error("[daily-words] Reset failed:", err.message);
        res.status(500).json({ error: "Failed to reset word index" });
    }
});
// ─── POST /daily-words/clear-cache ──────────────────────────────────────────
router.post("/daily-words/clear-cache", async (_req, res) => {
    try {
        let cursor = "0";
        let deletedCount = 0;
        do {
            const [nextCursor, keys] = await appRedis.scan(cursor, "MATCH", "daily-words:*", "COUNT", 200);
            cursor = nextCursor;
            if (keys.length > 0) {
                await appRedis.del(...keys);
                deletedCount += keys.length;
            }
        } while (cursor !== "0");
        console.log(`[daily-words] Cleared ${deletedCount} cache keys`);
        res.json({ ok: true, message: `Cleared ${deletedCount} cache entries`, deletedCount });
    }
    catch (err) {
        console.error("[daily-words] Clear cache failed:", err.message);
        res.status(500).json({ error: "Failed to clear cache" });
    }
});
export default router;
