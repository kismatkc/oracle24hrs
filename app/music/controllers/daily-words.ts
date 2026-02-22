// app/music/controllers/daily-words.ts
// Returns 5 daily vocabulary words with definitions, examples, and French translations.
// Uses a filtered word list (5–12 chars), free Dictionary API, MyMemory translation API,
// and Redis to track position so the same user never gets repeated words.

import express, { Request, Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { appRedis } from "../../../lib/appRedis.ts";

const router = express.Router();

// ─── Word list ──────────────────────────────────────────────────────────────
const WORDS_PATH = path.join(
  process.cwd(),
  "app",
  "data",
  "words_filtered.txt",
);
let WORDS: string[] = [];

try {
  WORDS = fs
    .readFileSync(WORDS_PATH, "utf-8")
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 5);
  console.log(`[daily-words] Loaded ${WORDS.length} words`);
} catch (err: any) {
  console.error("[daily-words] Failed to load word list:", err.message);
}

// ─── Redis keys (app: prefix applied automatically by appRedis) ─────────────
const REDIS_INDEX_KEY = "daily-words:index";

// ─── Free Dictionary API ────────────────────────────────────────────────────
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

// ─── MyMemory Translation API (EN → FR) ─────────────────────────────────────
const TRANSLATE_API = "https://api.mymemory.translated.net/get";

async function translateToFrench(text: string): Promise<string> {
  if (!text) return "";
  try {
    const res = await fetch(
      `${TRANSLATE_API}?q=${encodeURIComponent(text)}&langpair=en|fr`,
    );
    if (!res.ok) return "";
    const data = (await res.json()) as any;
    return data?.responseData?.translatedText || "";
  } catch {
    return "";
  }
}

interface WordEntry {
  word: string;
  phonetic: string;
  definition: string;
  partOfSpeech: string;
  example: string;
  frenchWord: string;
  frenchDefinition: string;
  frenchExample: string;
}

async function lookupWord(word: string): Promise<WordEntry | null> {
  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`);
    if (!res.ok) return null;

    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    const phonetic =
      entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text || "";

    // Pick the first meaning with a definition
    const meaning = entry.meanings?.[0];
    const def = meaning?.definitions?.[0];

    const definition = def?.definition || "No definition available";
    const example = def?.example || "";

    // Translate word, definition, and example to French in parallel
    const [frenchWord, frenchDefinition, frenchExample] = await Promise.all([
      translateToFrench(entry.word || word),
      translateToFrench(definition),
      example ? translateToFrench(example) : Promise.resolve(""),
    ]);

    return {
      word: entry.word || word,
      phonetic,
      definition,
      partOfSpeech: meaning?.partOfSpeech || "",
      example,
      frenchWord,
      frenchDefinition,
      frenchExample,
    };
  } catch {
    return null;
  }
}

// ─── GET /daily-words ───────────────────────────────────────────────────────
// Returns 5 words with definitions. Uses Redis index to walk through the list
// sequentially (shuffled once), so every batch is unique.
router.get("/daily-words", async (req: Request, res: Response) => {
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
    if (isNaN(currentIndex) || currentIndex < 0) currentIndex = 0;
    // Wrap around if we've exhausted the list
    if (currentIndex >= WORDS.length) currentIndex = 0;

    // In test mode, pick a random starting position so it feels fresh
    let idx = isTestMode
      ? Math.floor(Math.random() * WORDS.length)
      : currentIndex;

    const results: WordEntry[] = [];
    let attempts = 0;

    while (results.length < BATCH_SIZE && attempts < MAX_ATTEMPTS) {
      if (idx >= WORDS.length) idx = 0; // wrap

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
  } catch (err: any) {
    console.error("[daily-words] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch daily words" });
  }
});

export default router;
