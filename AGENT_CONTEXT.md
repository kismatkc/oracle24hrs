# Oracle24hrs Backend — Agent Context Document
> **Source of Truth for AI Agents** | Last Updated: February 2026

---

## 1. Core Identity & Stack

### Project Purpose
Oracle24hrs is a **Node.js/Express backend server** that powers the "OnTime" ecosystem — a suite of mobile apps for music streaming/management and lifestyle tracking. It serves as the centralized API for:
- **Music & Audio**: YouTube search/streaming, audio downloading, lyrics scraping, stem separation (Demucs), Shazam recognition, and file cache management.
- **Lifestyle**: Daily vocabulary words (English + French translations).
- **Transit**: TTC (Toronto Transit Commission) service alerts scraping.

The server runs on an Oracle Cloud VPS behind nginx, managed by PM2 in cluster mode.

### Tech Stack & Versions
| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | (system) | Runtime |
| **TypeScript** | ^5.8.3 | Language |
| **Express** | ^5.1.0 | HTTP framework (Express 5!) |
| **ioredis** | ^5.7.0 | Redis client (app cache + BullMQ) |
| **BullMQ** | ^5.56.9 | Job queue for stem separation |
| **Playwright** | ^1.52.0 | Browser automation (lyrics, TTC alerts) |
| **youtubei.js** | ^16.0.1 | YouTube Innertube API client |
| **cheerio** | ^1.0.0 | HTML parsing for lyrics |
| **multer** | ^2.0.2 | File upload handling |
| **PM2** | ^6.0.5 | Process management |
| **Doppler** | CLI | Secrets management |
| **yt-dlp** | (system binary) | YouTube audio downloading |
| **Demucs (htdemucs_6s)** | Python venv | AI stem separation |
| **ffmpeg** | (system binary) | Audio normalization/transcoding |

### Package/Dependency Rules
**Critical Dependencies — Do NOT Remove or Replace:**
- `express@^5.1.0` — The app uses Express 5 (async error handling). Do NOT downgrade to Express 4.
- `ioredis` — Two separate clients: `appRedis` (key prefix `app:`) and `BullRedis` (no prefix, `maxRetriesPerRequest: null` required by BullMQ).
- `bullmq` — Drives the Demucs stem separation pipeline. Queue name is `"demucs"`.
- `youtubei.js` — Innertube client for YouTube search/metadata. Singleton that refreshes every 10 minutes.
- `playwright` — Used by lyrics scraper and TTC alerts. Shared browser singleton in `app/music/lib/playright.ts`.
- `cheerio` + `@mozilla/readability` + `jsdom` — Multi-layer HTML extraction pipeline for lyrics.

**Explicitly NOT Used:**
- No ORM — all Redis operations use raw ioredis commands.
- No database — Redis + filesystem only (no SQL).
- No authentication middleware — API is open (CORS `*`), secured at nginx level.

---

## 2. Architectural Patterns & Rules

### Module System
- **ES Modules** (`"type": "module"` in package.json).
- TypeScript config: `module: "NodeNext"`, `moduleResolution: "nodenext"`.
- Build with `tsc -p tsconfig.build.json` → `dist/` + `fix-imports.js` post-processing.
- Imports MUST use `.ts` extensions in source (due to `allowImportingTsExtensions`).

### State Management
- **Redis** for all runtime state:
  - Download progress: `app:dl-progress:<id>` (5min TTL)
  - YouTube download state: `app:download:<videoId>` (1h TTL)
  - Daily words index: `app:daily-words:index`
  - Stem separation ledger: per-job metadata (3-day TTL)
- **Filesystem** for caches:
  - `youtube-cache/` — downloaded MP3s + `.meta.json` (5-day max age, hourly cleanup)
  - `uploads/` — user-uploaded audio files
  - `separated/` — Demucs output stem directories
  - `normalized/` — ffmpeg-normalized WAV files
  - `uploads/shazam-tmp/` — temporary Shazam audio

### Controller Structure
Each controller is a standalone Express Router exported from `app/music/controllers/`. Pattern:
```
import { Router } from "express";
const router = Router();
// routes...
export default router;
```
Mounted in `app.ts`:
- `/music` prefix → uploadMusic, downloadMp3, scrapeLyrics, ttcAlerts, cacheManagement, shazam
- `/music/youtube` prefix → youtube
- `/ontime` prefix → dailyWords

### Process Architecture (PM2)
| Process | Mode | Instances | File |
|---|---|---|---|
| `music` | cluster | 4 | `dist/app/music/app.js` |
| `demucs_worker` | fork | 1 | `dist/app/music/workers/demucs.worker.js` |
| `redis-gui` | fork | 1 | `scripts/run-redis-gui.cjs` |

Secrets loaded via `doppler-production.cjs` (PM2 `node_args: "-r ./doppler-production.cjs"`).

### Strict Constraints — DO NOT:
1. **Never remove the `maxRetriesPerRequest: null`** on `BullRedis` — BullMQ requires it for blocking calls.
2. **Never change the `app:` key prefix** on `appRedis` — all existing Redis keys depend on it.
3. **Never run Demucs worker in cluster mode** — it's CPU-bound with thread limits (OMP/MKL/OPENBLAS = 4). Must stay fork mode, concurrency 1.
4. **Never remove the proxy** (`http://10.8.0.2:3128`) from yt-dlp commands — YouTube blocks the VPS IP directly.
5. **Never change the BullMQ queue name** from `"demucs"` — workers and producers must match.
6. **Never skip the `fix-imports.js` post-build step** — it patches import paths for NodeNext module resolution.
7. **Never add authentication middleware globally** — the API is intentionally open, secured at the nginx layer.
8. **Never increase Demucs worker concurrency** above 1 — the Oracle VPS CPU cannot handle parallel stem separations.
9. **Never remove the Playwright browser singleton** pattern — creating new browser instances per request causes memory leaks.
10. **Never use `node-fetch`** for new code — use native fetch or axios (node-fetch is legacy).

---

## 3. Feature & Business Logic Context

### Core Features

#### 1. YouTube Audio Pipeline
**Search → Prepare → Cache → Stream**
- Search via Innertube (`youtubei.js`) with singleton client (refreshes every 10min).
- `audio/prepare` kicks off background yt-dlp download through proxy with progress tracking in Redis.
- Downloaded MP3s cached in `youtube-cache/` with metadata JSON sidecars.
- Cache auto-purges files older than 5 days (hourly cron).
- `audio` endpoint serves cached files; `stream` provides direct stream URLs.

#### 2. Lyrics Scraping Pipeline
**Waterfall Strategy**: LRCLIB → Genius → Google Custom Search → Cheerio → Playwright
- LRCLIB: fastest (~200ms), returns synced/plain lyrics.
- Genius: API search for song, then scrape lyrics page (cheerio first, Playwright fallback).
- Google: custom search top 10 URLs, then extract from each using cheerio with site-specific selectors (Genius `[data-lyrics-container]`, AZLyrics, `.lyrics-body`), Readability fallback, then Playwright.
- Playwright runs through the shared browser singleton with proxy.

#### 3. Stem Separation (Demucs)
**Upload → Normalize → Demucs → Transcode → Serve**
- User uploads audio via multer → BullMQ job enqueued.
- Worker pipeline: ffmpeg loudnorm (44100Hz stereo WAV) → `htdemucs_6s` (CPU, 10 shifts) → WAV→MP3 (320kbps) → instrumental mix (drums+bass+guitar+piano+other).
- 6 stems: vocals, drums, bass, guitar, piano, other.
- 72-hour auto-purge sweeper runs hourly.
- Job states tracked via BullMQ + Redis ledger.

#### 4. Shazam Recognition
- Audio uploaded to `uploads/shazam-tmp/` (max 10MB).
- Python subprocess (`scripts/recognize.py`) using `shazamio` library.
- 30-second timeout, temp file cleanup after.

#### 5. Daily Vocabulary Words
- Walks through `words_filtered.txt` sequentially (Redis index counter).
- Returns 5 words with definitions (Free Dictionary API) + French translations (MyMemory API).
- Test mode (`?testMode=true`) returns random words without advancing index.

### Critical Workflows

#### Audio Download Flow (download-mp3 controller)
1. Check streaming cache → serve if exists.
2. Spawn yt-dlp with proxy, `--extractor-args youtube:player_client=android`.
3. Track progress in Redis (`dl-progress:<id>`, 5min TTL).
4. Validate audio headers (MP3/ID3 magic bytes).
5. Save to streaming cache for reuse.
6. 3-minute hard timeout.

#### Cache Management
4 independent caches with full CRUD + nuclear purge:
- `youtube-cache/` — YouTube audio + metadata
- `separated/` — Demucs stem output
- `uploads/` — User uploads
- `normalized/` — ffmpeg normalized audio
- `DELETE /cache/all` — purges everything including stray `input_*` files.

---

## 4. Historical Context (from Commits)

### Major Milestones (Chronological)
1. **Initial deployment** (`firs` → `auto` commits) — basic server setup on Oracle Cloud.
2. **Audio extraction pipeline** — yt-dlp integration, audio downloading/streaming.
3. **Innertube migration** (`before innertube` → `innertube + ytdlp done`) — replaced previous YouTube API approach with `youtubei.js`.
4. **Guitar tab integration** — JustinGuitar course scraping added.
5. **Stem separation** (`before the stems new logic` → `stable stage after stems`) — BullMQ + Demucs pipeline.
6. **Playlist feature** — category/playlist management.
7. **LRCLIB integration** (`before lrclib` → `after lrclib`) — added fast lyrics source before Genius/Google.
8. **Mac server option** — dual-server stem checking (Oracle CPU + Mac GPU).
9. **Offline songs + music cache** — YouTube cache with auto-purge.
10. **Cluster mode** (`cluster mode activated`) — PM2 4-instance cluster for the main app.
11. **Shazam integration** (`shazam integrated`) — Python-based audio recognition.
12. **Daily words** (`words logic added`) — vocabulary feature for lifestyle app.
13. **Route consolidation** (`all routes consolidated to one app`) — merged multiple Express apps into single server.

### Past Mistakes / Reversions
- **Separate Express apps** were consolidated into one — do NOT split them back out.
- **`merge_logs: true`** in PM2 config was commented out — logs are now separate per instance. Do NOT re-enable.
- **MorphingPlayer experiments** on the frontend (commit `b800de4`) had to be reset — the backend stem API stayed stable through this.
- **Stem extraction progress bar** was removed from the frontend twice — the backend progress tracking via Redis still works, but the UI was simplified to polling-based.

---

## 5. Agent Instructions

You are working on the **Oracle24hrs backend** — a production Express 5 server running on Oracle Cloud VPS behind nginx, managed by PM2 in cluster mode. Before making any changes, recall memory from `sm_project_backend` and save after every task. This server is the API backbone for two mobile apps (music + lifestyle). It handles YouTube audio streaming, lyrics scraping, AI stem separation, Shazam recognition, and daily vocabulary — all through a carefully tuned pipeline of system binaries (yt-dlp, ffmpeg, Demucs/Python), Playwright browser automation, and Redis-backed state management. Never bypass the proxy for YouTube operations. Never change Redis key prefixes or BullMQ queue names. Never increase Demucs worker concurrency. The filesystem caches (youtube-cache/, separated/, uploads/, normalized/) have auto-purge cycles — do not add manual cleanup that conflicts with them. Express 5 is in use — async errors propagate automatically, do not add unnecessary try/catch wrappers on route handlers. When adding new controllers, follow the existing Router pattern and mount under the appropriate prefix in `app.ts`. Always test with `npm run build` before committing — the TypeScript build + `fix-imports.js` post-processing is required for production.

---

## Environment Variables (Required)
| Variable | Purpose |
|---|---|
| `PORT_MUSIC` | Server port (default 3000) |
| `REDDIS_CONNECTIONSTRING` | Redis connection string |
| `GENIUS_ACCESS_TOKEN` | Genius API token for lyrics |
| `GOOGLE_NOBILLING_API_KEY_2` | Google Custom Search API key |
| `SEARCHENGINE_ID_2` | Google Custom Search Engine ID |
| `OMP_NUM_THREADS` | Demucs thread limit (4) |
| `MKL_NUM_THREADS` | Demucs thread limit (4) |
| `OPENBLAS_NUM_THREADS` | Demucs thread limit (4) |
| `RESTART_SECRET` | PM2 restart endpoint secret |

## Supermemory Protocol
- **Container Tag**: `sm_project_backend`
- **MCP Server**: `https://mcp.supermemory.ai/mcp?project=backend`
- Every chat: recall first, save last. No exceptions.
