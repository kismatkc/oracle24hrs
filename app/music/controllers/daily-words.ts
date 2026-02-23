// app/music/controllers/daily-words.ts
// ═══════════════════════════════════════════════════════════════════════════
// UNLIMITED ZERO-REPEAT DAILY WORDS — Production v2
// ═══════════════════════════════════════════════════════════════════════════
//
// Architecture overview:
//
//   Master list: ~370K words loaded from disk (curated first, then huge).
//   Every word is served exactly once before any word repeats (global cycle).
//   Within a single calendar day, the same 5 words are returned on every call.
//
// Redis data model (all keys auto-prefixed with "app:" by ioredis):
//
//   daily:shown          → Sorted Set  (member = word, score = unix-ms last shown)
//   daily:today_shown    → Set         (words already served today)
//   daily:today_date     → String      (YYYY-MM-DD — detects day boundary)
//   daily:pool_cursor    → String      (integer index into WORDS array)
//   daily:enriched:{w}   → String      (JSON WordEntry — permanent cache)
//   daily:skip:{w}       → String      ("1" — word permanently failed enrichment)
//
// Enrichment pipeline (stop at first success):
//   1. Wiktionary REST API  (definition + example)
//   2. dictionaryapi.dev    (fallback — also provides phonetic)
//   Then: translate example sentence to French via MyMemory API.
//
// Test mode: returns 5 hardcoded beautiful words instantly, zero API calls.
//
// JSON response shape is 100% identical to what the mobile app already expects.
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { appRedis } from "../../../lib/appRedis.ts";

const router = express.Router();

// ─── Word Lists ─────────────────────────────────────────────────────────────
// Load word files exactly as before: curated (~1 533) first, then huge (~370K).
// The combined array is the master pool — words are served in this order
// during the initial "seeding" phase.

function loadWordList(filename: string, minLen = 3): string[] {
  try {
    const filePath = path.join(process.cwd(), "app", "data", filename);
    const words = fs
      .readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= minLen && /^[a-z]+$/.test(w));
    console.log(`[daily-words] Loaded ${words.length} words from ${filename}`);
    return words;
  } catch (err: any) {
    console.error(`[daily-words] Failed to load ${filename}:`, err.message);
    return [];
  }
}

const CURATED_WORDS = loadWordList("words_curated.txt");
const HUGE_WORDS = loadWordList("words_huge.txt");

const curatedSet = new Set(CURATED_WORDS);
const WORDS = [
  ...CURATED_WORDS,
  ...HUGE_WORDS.filter((w) => !curatedSet.has(w)),
];
console.log(
  `[daily-words] Combined: ${WORDS.length} total (${CURATED_WORDS.length} curated + ${WORDS.length - CURATED_WORDS.length} huge)`,
);

// ─── Redis Key Constants ────────────────────────────────────────────────────
const KEY_SHOWN = "daily:shown"; // Sorted Set — global history
const KEY_TODAY_SHOWN = "daily:today_shown"; // Set — today's served words
const KEY_TODAY_DATE = "daily:today_date"; // String — current date
const KEY_POOL_CURSOR = "daily:pool_cursor"; // String — index into WORDS[]
const ENRICHED_PREFIX = "daily:enriched:"; // Per-word enrichment cache
const SKIP_PREFIX = "daily:skip:"; // Per-word failure flag
const APP_KEY_PREFIX = "app:"; // ioredis keyPrefix (for SCAN matching)

// ─── API Endpoints ──────────────────────────────────────────────────────────
const WIKTIONARY_API = "https://en.wiktionary.org/api/rest_v1/page/definition";
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

// ─── Interfaces ─────────────────────────────────────────────────────────────

/** The exact shape the mobile frontend expects — do NOT change field names. */
interface WordEntry {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  example: string;
  frenchWord: string;
  frenchDefinition: string;
  frenchExample: string;
}

/** Intermediate type before French translation is applied. */
interface EnglishData {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  example: string;
}

// ─── Test Mode: 5 Hardcoded Beautiful Words ─────────────────────────────────
// These are returned instantly in testMode — no Redis, no API calls.

const TEST_MODE_WORDS: WordEntry[] = [
  {
    word: "disorder",
    phonetic: "/dɪsˈɔːdə/",
    partOfSpeech: "noun",
    definition: "A state of confusion or lack of order.",
    example: "The room was in complete disorder after the party.",
    frenchWord: "Désordre",
    frenchDefinition: "Un état de confusion ou de manque d'ordre.",
    frenchExample: "La pièce était en désordre complet après la fête.",
  },
  {
    word: "interval",
    phonetic: "/ˈɪntəvəl/",
    partOfSpeech: "noun",
    definition: "A pause or gap between two events or periods of time.",
    example: "There was a brief interval between the two acts of the play.",
    frenchWord: "Intervalle",
    frenchDefinition: "Une pause ou un écart entre deux événements ou périodes.",
    frenchExample: "Il y avait un bref intervalle entre les deux actes de la pièce.",
  },
  {
    word: "bitter",
    phonetic: "/ˈbɪtə/",
    partOfSpeech: "adjective",
    definition: "Having a sharp, pungent taste; not sweet.",
    example: "The medicine had a bitter taste that lingered.",
    frenchWord: "Amer",
    frenchDefinition: "Ayant un goût âpre et désagréable ; pas sucré.",
    frenchExample: "Le médicament avait un goût amer qui persistait.",
  },
  {
    word: "abolish",
    phonetic: "/əˈbɒlɪʃ/",
    partOfSpeech: "verb",
    definition: "To formally put an end to a system, practice, or institution.",
    example: "The government voted to abolish the outdated law.",
    frenchWord: "Abolir",
    frenchDefinition: "Mettre fin officiellement à un système, une pratique ou une institution.",
    frenchExample: "Le gouvernement a voté pour abolir la loi obsolète.",
  },
  {
    word: "thorough",
    phonetic: "/ˈθʌɹə/",
    partOfSpeech: "adjective",
    definition: "Complete with regard to every detail; not superficial.",
    example: "She conducted a thorough investigation of the incident.",
    frenchWord: "Minutieux",
    frenchDefinition: "Complet en ce qui concerne chaque détail ; pas superficiel.",
    frenchExample: "Elle a mené une enquête minutieuse sur l'incident.",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip HTML tags from Wiktionary definition strings. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Today's date as YYYY-MM-DD (UTC). */
function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Translation via MyMemory API (free, no self-hosting) ───────────────────
// Unchanged from previous version — reliable EN → FR translation with retries.

async function translateToFrench(text: string): Promise<string> {
  if (!text) return "";
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const params = new URLSearchParams({
        q: text,
        langpair: "en|fr",
        de: "kismatkc@gmail.com", // email improves rate limits
      });
      const res = await fetch(`${MYMEMORY_URL}?${params.toString()}`);
      if (!res.ok) {
        console.warn(
          `[daily-words] MyMemory HTTP ${res.status} for: "${text.substring(0, 50)}" (attempt ${attempt + 1})`,
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return "";
      }
      const data = (await res.json()) as any;
      const translated: string = data?.responseData?.translatedText || "";
      // MyMemory returns the original text when it can't translate — treat as failure
      if (translated && translated.toLowerCase() !== text.toLowerCase()) return translated;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return "";
    } catch (err: any) {
      console.warn(
        `[daily-words] MyMemory error for "${text.substring(0, 50)}":`,
        err.message,
        `(attempt ${attempt + 1})`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return "";
    }
  }
  return "";
}

// ─── English Data Fetchers ──────────────────────────────────────────────────

/**
 * Source 1: Wiktionary REST API.
 * Fast, comprehensive, but definitions contain HTML and examples may be sparse.
 * Returns EnglishData with BOTH definition AND example, or null.
 */
async function tryWiktionary(word: string): Promise<EnglishData | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${WIKTIONARY_API}/${encodeURIComponent(word)}`,
      {
        headers: { "Api-User-Agent": "OnTimeBot/1.0 (kismatkc@gmail.com)" },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as any;

    // Wiktionary returns { en: [...sections...] } for English entries
    const enEntries = data?.en;
    if (!Array.isArray(enEntries) || enEntries.length === 0) return null;

    // Scan every section and definition for one with BOTH definition AND example
    for (const section of enEntries) {
      const pos = section.partOfSpeech || "";
      for (const def of section.definitions || []) {
        const definition = stripHtml(def.definition || "");
        if (!definition) continue;

        // Examples can be in parsedExamples (objects) or examples (strings)
        let example = "";
        if (Array.isArray(def.parsedExamples) && def.parsedExamples.length > 0) {
          example = stripHtml(def.parsedExamples[0].example || "");
        }
        if (!example && Array.isArray(def.examples) && def.examples.length > 0) {
          example = stripHtml(typeof def.examples[0] === "string" ? def.examples[0] : def.examples[0]?.example || "");
        }

        if (definition && example) {
          return {
            word,
            phonetic: "", // Wiktionary definition endpoint doesn't include phonetic
            partOfSpeech: pos.toLowerCase(),
            definition,
            example,
          };
        }
      }
    }
    return null;
  } catch (err: any) {
    console.warn(`[daily-words] Wiktionary error for "${word}":`, err.message);
    return null;
  }
}

/**
 * Source 2 (fallback): Free Dictionary API (dictionaryapi.dev).
 * Provides phonetic, part of speech, definition, and example.
 * Returns EnglishData with BOTH definition AND example, or null.
 */
async function tryDictionaryApi(word: string): Promise<EnglishData | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${DICT_API}/${encodeURIComponent(word)}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    const phonetic =
      entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text || "";

    // Scan ALL meanings for one with both definition AND example
    for (const m of entry.meanings || []) {
      for (const d of m.definitions || []) {
        if (d.definition && d.example) {
          return {
            word: entry.word || word,
            phonetic,
            partOfSpeech: m.partOfSpeech || "",
            definition: d.definition,
            example: d.example,
          };
        }
      }
    }
    return null;
  } catch (err: any) {
    console.warn(`[daily-words] DictionaryAPI error for "${word}":`, err.message);
    return null;
  }
}

// ─── Word Enrichment ────────────────────────────────────────────────────────

/**
 * Enrich a single word: fetch English data → translate to French → cache.
 *
 * Pipeline:
 *   1. Check daily:enriched:{word} cache → instant return
 *   2. Check daily:skip:{word} → instant skip
 *   3. Try Wiktionary REST API
 *   4. Fallback to dictionaryapi.dev
 *   5. Translate (word, definition, example) → French in parallel
 *   6. Cache permanently in daily:enriched:{word}
 *
 * Returns full WordEntry or null (word is unenrichable).
 */
async function enrichWord(word: string): Promise<WordEntry | null> {
  // ── Cache hit: return instantly ──
  try {
    const cached = await appRedis.get(`${ENRICHED_PREFIX}${word}`);
    if (cached) return JSON.parse(cached) as WordEntry;
  } catch {
    /* cache miss or parse error — continue to fresh lookup */
  }

  // ── Skip hit: known permanent failure ──
  try {
    const skip = await appRedis.get(`${SKIP_PREFIX}${word}`);
    if (skip) return null;
  } catch {
    /* ignore */
  }

  // ── Fetch English data (Wiktionary → DictionaryAPI fallback) ──
  let english = await tryWiktionary(word);
  if (!english) english = await tryDictionaryApi(word);

  if (!english) {
    // Both sources failed — permanently mark as unenrichable
    await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => {});
    return null;
  }

  // ── Translate to French (word, definition, example — in parallel) ──
  const [frenchWord, frenchDefinition, frenchExample] = await Promise.all([
    translateToFrench(english.word),
    translateToFrench(english.definition),
    translateToFrench(english.example),
  ]);

  // Reject if any French field is empty — word needs all 3 for the two-column layout
  if (!frenchWord || !frenchDefinition || !frenchExample) {
    console.warn(`[daily-words] Incomplete French for "${word}" — skipping`);
    await appRedis.set(`${SKIP_PREFIX}${word}`, "1").catch(() => {});
    return null;
  }

  const entry: WordEntry = {
    word: english.word,
    phonetic: english.phonetic,
    partOfSpeech: english.partOfSpeech,
    definition: english.definition,
    example: english.example,
    frenchWord,
    frenchDefinition,
    frenchExample,
  };

  // ── Permanent enrichment cache ──
  try {
    await appRedis.set(`${ENRICHED_PREFIX}${word}`, JSON.stringify(entry));
  } catch {
    /* non-critical */
  }

  return entry;
}

// ─── Day Rollover ───────────────────────────────────────────────────────────

/**
 * Clear daily:today_shown if the calendar day has changed.
 * Safe with multiple PM2 workers — a double-clear is harmless
 * (the Set becomes empty, which is the correct state for a new day).
 */
async function ensureDayRollover(): Promise<void> {
  const today = todayDateStr();
  const stored = await appRedis.get(KEY_TODAY_DATE);
  if (stored === today) return; // Same day — nothing to do

  console.log(
    `[daily-words] Day rollover detected (${stored || "null"} → ${today}) — clearing today_shown`,
  );
  await appRedis.del(KEY_TODAY_SHOWN);
  await appRedis.set(KEY_TODAY_DATE, today);
}

// ─── Candidate Selection ────────────────────────────────────────────────────

/**
 * Select candidate words for enrichment.
 *
 * Phase 1 — UNSEEN WORDS (seeding):
 *   Walk WORDS array forward from daily:pool_cursor.
 *   Pick words that are NOT in daily:skip (known failures) and not already
 *   shown today. These are brand-new words never served before.
 *
 * Phase 2 — LRU RECYCLING (after pool exhaustion):
 *   Once the cursor reaches the end of WORDS (entire pool scanned),
 *   recycle from daily:shown sorted set by lowest score (= least recently shown).
 *   These words are guaranteed to be in the enrichment cache.
 *
 * Returns more candidates than needed to absorb enrichment failures.
 */
async function selectCandidates(
  needed: number,
  todaySet: Set<string>,
): Promise<string[]> {
  const TARGET = needed * 30; // Overshoot to handle enrichment failures
  const candidates: string[] = [];
  const candidateSet = new Set<string>();

  // ── Phase 1: Pool walk (unseen words) ──
  let cursor = parseInt((await appRedis.get(KEY_POOL_CURSOR)) || "0", 10);
  if (isNaN(cursor) || cursor < 0) cursor = 0;

  if (cursor < WORDS.length) {
    let pos = cursor;
    // Limit single-call scan distance to avoid blocking too long
    const maxScan = Math.min(pos + TARGET * 5, WORDS.length);

    while (candidates.length < TARGET && pos < maxScan) {
      const word = WORDS[pos];
      pos++;

      if (todaySet.has(word) || candidateSet.has(word)) continue;

      candidates.push(word);
      candidateSet.add(word);
    }

    // Persist cursor (advances past the scanned region)
    await appRedis.set(KEY_POOL_CURSOR, String(pos));

    if (pos >= WORDS.length) {
      console.log(
        `[daily-words] Pool fully scanned (${WORDS.length} words). Future days use LRU recycling.`,
      );
    }
  }

  // ── Phase 2: LRU recycling (pool exhausted or not enough unseen words) ──
  if (candidates.length < TARGET) {
    const recycleNeeded = (TARGET - candidates.length) * 2;
    // ZRANGE returns members ordered by score (lowest = oldest shown = first to recycle)
    const lru: string[] = await appRedis.zrange(KEY_SHOWN, 0, recycleNeeded - 1);

    for (const w of lru) {
      if (candidates.length >= TARGET) break;
      if (todaySet.has(w) || candidateSet.has(w)) continue;
      candidates.push(w);
      candidateSet.add(w);
    }
  }

  return candidates;
}

// ─── Core: getDailyWords ────────────────────────────────────────────────────

/**
 * Main entry point for the daily words endpoint.
 *
 * Test mode:  returns 5 hardcoded words instantly (no Redis, no API calls).
 * Normal mode:
 *   1) Day rollover check → clears daily:today_shown if new day
 *   2) If today's words are already selected → return from enrichment cache
 *   3) Otherwise: pick candidates → enrich → store in both sorted sets → return
 *
 * Idempotent within a day: same 5 words on every call until midnight UTC.
 */
async function getDailyWords(isTestMode: boolean): Promise<{
  words: WordEntry[];
  attempts: number;
  fromCache: boolean;
}> {
  // ── Test mode: instant return ──
  if (isTestMode) {
    return { words: TEST_MODE_WORDS, attempts: 0, fromCache: true };
  }

  const BATCH_SIZE = 5;

  // ── 1. Day rollover ──
  await ensureDayRollover();

  // ── 2. Check if today's words are already selected ──
  const todayWords = await appRedis.smembers(KEY_TODAY_SHOWN);

  // Load enriched data for any words already shown today
  const existingEntries: WordEntry[] = [];
  if (todayWords.length > 0) {
    const entries = await Promise.all(
      todayWords.map(async (w) => {
        try {
          const raw = await appRedis.get(`${ENRICHED_PREFIX}${w}`);
          return raw ? (JSON.parse(raw) as WordEntry) : null;
        } catch {
          return null;
        }
      }),
    );
    for (const e of entries) {
      if (e) existingEntries.push(e);
    }
  }

  // If we already have 5 valid cached words for today, return them
  if (existingEntries.length >= BATCH_SIZE) {
    console.log(
      `[daily-words] Returning ${existingEntries.length} cached today-words`,
    );
    return {
      words: existingEntries.slice(0, BATCH_SIZE),
      attempts: 0,
      fromCache: true,
    };
  }

  // ── 3. Need more words — select candidates and enrich ──
  const needed = BATCH_SIZE - existingEntries.length;
  const todaySet = new Set(todayWords);
  const candidates = await selectCandidates(needed, todaySet);

  const newEntries: WordEntry[] = [];
  let attempts = 0;

  for (const word of candidates) {
    if (newEntries.length >= needed) break;
    attempts++;

    const entry = await enrichWord(word);
    if (!entry) continue;

    newEntries.push(entry);

    // Record in global history (score = current Unix ms → used for LRU ordering)
    await appRedis.zadd(KEY_SHOWN, Date.now(), word).catch(() => {});
    // Record in today's set (prevents same-day repeats)
    await appRedis.sadd(KEY_TODAY_SHOWN, word).catch(() => {});
  }

  const allWords = [...existingEntries, ...newEntries].slice(0, BATCH_SIZE);

  console.log(
    `[daily-words] Selected ${newEntries.length} new + ${existingEntries.length} cached = ${allWords.length} words in ${attempts} attempts`,
  );

  return { words: allWords, attempts, fromCache: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Routes ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /daily-words ───────────────────────────────────────────────────────
// Same route the mobile app already calls. Response shape is 100% identical.

router.get("/daily-words", async (req: Request, res: Response) => {
  try {
    if (WORDS.length === 0) {
      res.status(500).json({ error: "Word list not loaded" });
      return;
    }

    const isTestMode = req.query.testMode === "true";
    const { words, attempts, fromCache } = await getDailyWords(isTestMode);

    // Read cursor for the meta block (frontend may display this)
    const rawCursor = await appRedis.get(KEY_POOL_CURSOR);
    const cursor = rawCursor ? parseInt(rawCursor, 10) : 0;

    console.log(
      `[daily-words] Served ${words.length} words | attempts=${attempts} | cached=${fromCache} | cursor=${cursor}/${WORDS.length}`,
    );

    res.json({
      words,
      meta: {
        totalWords: WORDS.length,
        curatedWords: CURATED_WORDS.length,
        currentIndex: cursor,
        attempts,
        servedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[daily-words] GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch daily words" });
  }
});

// ─── POST /daily-words/reset ────────────────────────────────────────────────
// Resets pool cursor to 0 and clears today's selection.
// Does NOT clear enrichment cache or global history (use clear-cache for that).

router.post("/daily-words/reset", async (_req: Request, res: Response) => {
  try {
    await appRedis.set(KEY_POOL_CURSOR, "0");
    await appRedis.del(KEY_TODAY_SHOWN);
    await appRedis.del(KEY_TODAY_DATE);
    console.log("[daily-words] Pool cursor reset to 0, today cleared");
    res.json({ ok: true, message: "Pool cursor reset to 0, today cleared" });
  } catch (err: any) {
    console.error("[daily-words] Reset failed:", err.message);
    res.status(500).json({ error: "Failed to reset" });
  }
});

// ─── POST /daily-words/clear-cache ──────────────────────────────────────────
// Nuclear option: clears ALL daily:* keys AND legacy daily-words:* keys.
// After this, the system starts fresh (new enrichments, new cursor, new history).
// NOTE: appRedis keyPrefix "app:" is NOT applied to SCAN MATCH — manually added.

router.post(
  "/daily-words/clear-cache",
  async (_req: Request, res: Response) => {
    try {
      let deletedCount = 0;

      // Clean both new daily:* and legacy daily-words:* keys
      const patterns = [
        `${APP_KEY_PREFIX}daily:*`,
        `${APP_KEY_PREFIX}daily-words:*`,
      ];

      for (const pattern of patterns) {
        let scanCursor = "0";
        do {
          const [nextCursor, keys] = await appRedis.scan(
            scanCursor,
            "MATCH",
            pattern,
            "COUNT",
            200,
          );
          scanCursor = nextCursor;
          if (keys.length > 0) {
            // Strip "app:" prefix since appRedis.del() re-adds it automatically
            const unprefixed = keys.map((k: string) =>
              k.startsWith(APP_KEY_PREFIX)
                ? k.slice(APP_KEY_PREFIX.length)
                : k,
            );
            await appRedis.del(...unprefixed);
            deletedCount += keys.length;
          }
        } while (scanCursor !== "0");
      }

      console.log(
        `[daily-words] Cleared ${deletedCount} keys (daily:* + legacy daily-words:*)`,
      );
      res.json({
        ok: true,
        message: `Cleared ${deletedCount} cache entries`,
        deletedCount,
      });
    } catch (err: any) {
      console.error("[daily-words] Clear cache failed:", err.message);
      res.status(500).json({ error: "Failed to clear cache" });
    }
  },
);

// ─── POST /daily-words/preheat ──────────────────────────────────────────────
// Background-enrich N words ahead of time so future daily calls are instant.
// Does NOT affect today's shown set or global history — purely warms the cache.
// Usage: POST /ontime/daily-words/preheat?count=100

router.post("/daily-words/preheat", async (req: Request, res: Response) => {
  const count = Math.min(
    parseInt(req.query.count as string, 10) || 50,
    500,
  );

  // Respond immediately — enrichment runs in background
  res.json({ ok: true, message: `Preheating ${count} words in background` });

  (async () => {
    let cursor = parseInt(
      (await appRedis.get(KEY_POOL_CURSOR)) || "0",
      10,
    );
    if (isNaN(cursor)) cursor = 0;

    let enriched = 0;
    let skipped = 0;
    const maxPos = Math.min(cursor + count * 3, WORDS.length);

    for (let pos = cursor; pos < maxPos && enriched < count; pos++) {
      const word = WORDS[pos];

      // Already cached? Count as enriched.
      const existing = await appRedis.get(`${ENRICHED_PREFIX}${word}`);
      if (existing) {
        enriched++;
        continue;
      }

      // Already known to fail? Skip.
      const skipFlag = await appRedis.get(`${SKIP_PREFIX}${word}`);
      if (skipFlag) {
        skipped++;
        continue;
      }

      // Enrich (calls external APIs)
      const entry = await enrichWord(word);
      if (entry) enriched++;
      else skipped++;

      // Small delay to avoid hammering external APIs
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(
      `[daily-words] Preheat complete: ${enriched} enriched, ${skipped} skipped`,
    );
  })().catch((err) =>
    console.error("[daily-words] Preheat error:", err.message),
  );
});

export default router;
