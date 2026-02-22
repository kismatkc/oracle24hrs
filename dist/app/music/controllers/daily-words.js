// app/music/controllers/daily-words.ts
// Returns 5 daily vocabulary words with definitions and translations.
// Uses a filtered word list (5–12 chars), free Dictionary API, and Redis
// to track position so the same user never gets repeated words.
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { appRedis } from "../../../lib/appRedis.js";
const router = express.Router();
// ─── Word list ──────────────────────────────────────────────────────────────
const WORDS_PATH = path.join(process.cwd(), "app", "data", "words_filtered.txt");
let WORDS = [];
try {
    WORDS = fs
        .readFileSync(WORDS_PATH, "utf-8")
        .split(/\r?\n/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 5);
    console.log(`[daily-words] Loaded ${WORDS.length} words`);
}
catch (err) {
    console.error("[daily-words] Failed to load word list:", err.message);
}
// ─── Redis keys (app: prefix applied automatically by appRedis) ─────────────
const REDIS_INDEX_KEY = "daily-words:index";
// ─── Free Dictionary API ────────────────────────────────────────────────────
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
async function lookupWord(word) {
    try {
        const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`);
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (!Array.isArray(data) || data.length === 0)
            return null;
        const entry = data[0];
        const phonetic = entry.phonetic ||
            entry.phonetics?.find((p) => p.text)?.text ||
            "";
        // Pick the first meaning with a definition
        const meaning = entry.meanings?.[0];
        const def = meaning?.definitions?.[0];
        return {
            word: entry.word || word,
            phonetic,
            definition: def?.definition || "No definition available",
            partOfSpeech: meaning?.partOfSpeech || "",
            example: def?.example || "",
        };
    }
    catch {
        return null;
    }
}
// ─── GET /daily-words ───────────────────────────────────────────────────────
// Returns 5 words with definitions. Uses Redis index to walk through the list
// sequentially (shuffled once), so every batch is unique.
router.get("/daily-words", async (req, res) => {
    try {
        if (WORDS.length === 0) {
            res.status(500).json({ error: "Word list not loaded" });
            return;
        }
        // When testMode=true, serve random words WITHOUT advancing the Redis index
        const isTestMode = req.query.testMode === "true";
        const BATCH_SIZE = 5;
        const MAX_ATTEMPTS = BATCH_SIZE * 4; // try extra words in case dict API fails
        // Get current index from Redis (default 0)
        const rawIndex = await appRedis.get(REDIS_INDEX_KEY);
        let currentIndex = rawIndex ? parseInt(rawIndex, 10) : 0;
        if (isNaN(currentIndex) || currentIndex < 0)
            currentIndex = 0;
        // Wrap around if we've exhausted the list
        if (currentIndex >= WORDS.length)
            currentIndex = 0;
        // In test mode, pick a random starting position so it feels fresh
        let idx = isTestMode
            ? Math.floor(Math.random() * WORDS.length)
            : currentIndex;
        const results = [];
        let attempts = 0;
        while (results.length < BATCH_SIZE && attempts < MAX_ATTEMPTS) {
            if (idx >= WORDS.length)
                idx = 0; // wrap
            const word = WORDS[idx];
            idx++;
            attempts++;
            const entry = await lookupWord(word);
            if (entry) {
                results.push(entry);
            }
        }
        // Only persist the new index in normal mode — test mode is read-only
        if (!isTestMode) {
            await appRedis.set(REDIS_INDEX_KEY, String(idx));
        }
        res.json({
            words: results,
            meta: {
                totalWords: WORDS.length,
                currentIndex: idx,
                servedAt: new Date().toISOString(),
            },
        });
    }
    catch (err) {
        console.error("[daily-words] Error:", err.message);
        res.status(500).json({ error: "Failed to fetch daily words" });
    }
});
export default router;
