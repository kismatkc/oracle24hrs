# Oracle 24hrs

A multi-purpose backend API built with **Express 5.1** and **TypeScript**, running on **PM2** in cluster mode behind **nginx**. It powers a music/audio toolkit and a lifestyle companion app.

---

## Features

### Music & Audio (`/music`)
- **YouTube Search & Streaming** — search videos, get suggestions, prepare/download/stream audio via `yt-dlp` and `youtubei.js`
- **Lyrics Scraping** — multi-source lyrics lookup (LRCLIB, Genius, Google Custom Search) with Cheerio-first parsing and Playwright fallback
- **MP3 Downloads** — download audio from URLs with real-time progress tracking via Redis
- **Audio Upload & Stem Separation** — upload audio files and split them into stems using [Demucs](https://github.com/facebookresearch/demucs) via BullMQ job queue
- **Shazam Recognition** — identify songs from audio clips using the `shazamio` Python library
- **TTC Alerts** — scrape Toronto Transit Commission service alerts via Playwright
- **Cache Management** — list, delete, and purge YouTube audio cache, uploaded files, separated stems, and normalized audio

### Lifestyle (`/ontime`)
- **Daily Words** — returns 5 vocabulary words per day with translations (MyMemory API), seeded from a curated word list and tracked via Redis

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Language | TypeScript (`module: NodeNext`) |
| Framework | Express 5.1 |
| Process Manager | PM2 (4-instance cluster) |
| Reverse Proxy | nginx |
| Secrets | Doppler |
| Task Queue | BullMQ + ioredis |
| State / Cache | Redis (ioredis) |
| Browser Automation | Playwright |
| Web Scraping | Cheerio, Axios, JSDOM, @mozilla/readability |
| Audio Processing | yt-dlp, Demucs (Python) |
| Song Recognition | shazamio (Python) |

---

## Prerequisites

- **Node.js** ≥ 18
- **Python 3** with `shazamio` installed
- **yt-dlp** on `$PATH`
- **Demucs** (`pip install demucs`)
- **Redis** instance (connection string via env)
- **Playwright browsers** (`npx playwright install`)
- **Doppler CLI** configured (or `.env` for local dev)
- **nginx** (production)

---

## Environment Variables

Managed via **Doppler** (loaded with `doppler-production.cjs` / `doppler-development.cjs`).

| Variable | Purpose |
|---|---|
| `PORT_MUSIC` | Server port (default `3000`) |
| `BODY_LIMIT` | Max request body size (default `25mb`) |
| `REDDIS_CONNECTIONSTRING` | Redis connection string |
| `GENIUS_ACCESS_TOKEN` | Genius API token for lyrics |
| `GOOGLE_NOBILLING_API_KEY_2` | Google Custom Search API key |
| `SEARCHENGINE_ID_2` | Google Custom Search engine ID |
| `OMP_NUM_THREADS` | Thread limit for Demucs (default `4`) |
| `MKL_NUM_THREADS` | Thread limit for Demucs (default `4`) |
| `OPENBLAS_NUM_THREADS` | Thread limit for Demucs (default `4`) |

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Build TypeScript → dist/
npm run build

# 4. Start all PM2 processes (music app, demucs worker, redis-gui)
npm start
```

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript and fix imports |
| `npm start` | Install deps + start PM2 ecosystem |
| `npm run stop` | Stop all PM2 processes |
| `npm run restart` | Restart all PM2 processes |
| `npm run delete` | Delete all PM2 processes |
| `npm run logs` | Tail PM2 logs |
| `npm run monit` | Open PM2 monitor dashboard |
| `npm run status` | Show PM2 process status |

---

## PM2 Processes

| Process | Mode | Instances | Description |
|---|---|---|---|
| `music` | cluster | 4 | Main Express API server |
| `demucs_worker` | fork | 1 | BullMQ worker for stem separation |
| `redis-gui` | fork | 1 | Redis management GUI |

All logs are written to the `logs/` directory.

---

## API Endpoints

All music routes are prefixed with `/music`. YouTube routes are under `/music/youtube`. Lifestyle routes are under `/ontime`.

### YouTube (`/music/youtube`)

| Method | Path | Description |
|---|---|---|
| GET | `/search` | Search YouTube videos |
| GET | `/suggestions` | Get search suggestions |
| GET | `/audio/prepare` | Prepare audio download (yt-dlp) |
| GET | `/audio/check` | Check if audio is cached |
| GET | `/audio` | Download cached audio file |
| GET | `/stream` | Stream audio directly |
| GET | `/info` | Get video metadata |

### Lyrics (`/music`)

| Method | Path | Description |
|---|---|---|
| GET | `/scrape-lyrics` | Auto-select best lyrics source |
| GET | `/scrape-lyrics/lrclib` | Fetch synced lyrics from LRCLIB |
| GET | `/scrape-lyrics/genius` | Fetch lyrics from Genius |
| GET | `/scrape-lyrics/google` | Fetch lyrics via Google search |
| GET | `/scrape-lyrics/extract` | Extract lyrics from a given URL |

### MP3 Download (`/music`)

| Method | Path | Description |
|---|---|---|
| GET | `/download-mp3` | Download audio from a URL |
| GET | `/progress/:id` | Get download progress |

### Upload & Stems (`/music`)

| Method | Path | Description |
|---|---|---|
| POST | `/upload` | Upload an audio file |
| GET | `/stems/:id/state` | Get stem separation job state |
| GET | `/stems/:id/result` | Download separated stems |
| POST | `/stems/:id/cleanup` | Clean up stem separation files |
| GET | `/stems/:id/check` | Check if stems exist |

### Shazam (`/music`)

| Method | Path | Description |
|---|---|---|
| POST | `/shazam` | Recognize a song from an audio clip |

### TTC Alerts (`/music`)

| Method | Path | Description |
|---|---|---|
| GET | `/scrape-news` | Get TTC service alerts |

### Cache Management (`/music`)

| Method | Path | Description |
|---|---|---|
| GET | `/cache/youtube` | List cached YouTube audio |
| DELETE | `/cache/youtube/:videoId` | Delete a cached video |
| DELETE | `/cache/youtube` | Purge all YouTube cache |
| GET | `/cache/stems` | List separated stems |
| DELETE | `/cache/stems/:songId` | Delete stems for a song |
| DELETE | `/cache/stems` | Purge all stems |
| GET | `/cache/uploads` | List uploaded files |
| DELETE | `/cache/uploads/:name` | Delete an uploaded file |
| DELETE | `/cache/uploads` | Purge all uploads |
| GET | `/cache/normalized` | List normalized audio |
| DELETE | `/cache/normalized/:name` | Delete a normalized file |
| DELETE | `/cache/normalized` | Purge all normalized audio |
| DELETE | `/cache/all` | Purge everything |
| GET | `/cache/summary` | Get cache stats summary |

### Daily Words (`/ontime`)

| Method | Path | Description |
|---|---|---|
| GET | `/daily-words` | Get 5 vocabulary words with translations |

---

## Project Structure

```
oracle24hrs/
├── app/
│   ├── data/                    # Word lists for daily-words
│   └── music/
│       ├── app.ts               # Express server entry point
│       ├── controllers/         # Route handlers
│       │   ├── cache-management.ts
│       │   ├── daily-words.ts
│       │   ├── download-mp3.ts
│       │   ├── scrape-lyrics.ts
│       │   ├── shazam.ts
│       │   ├── ttc-alerts.ts
│       │   ├── upload-music.ts
│       │   └── youtube.ts
│       ├── lib/
│       │   └── playright.ts     # Playwright browser singleton
│       ├── queues/
│       │   └── demucs.queue.ts  # BullMQ queue definition
│       └── workers/
│           └── demucs.worker.ts # BullMQ stem separation worker
├── lib/
│   ├── appRedis.ts              # General Redis client
│   └── bullRedis.ts             # BullMQ Redis client
├── scripts/
│   ├── recognize.py             # Shazam recognition script
│   └── run-redis-gui.cjs        # Redis GUI launcher
├── logs/                        # PM2 log files
├── uploads/                     # Uploaded audio files
├── separated/                   # Demucs stem output
├── normalized/                  # Normalized audio files
├── youtube-cache/               # Cached YouTube audio
├── ecosystem.config.cjs         # PM2 configuration
├── nginx-music.conf.example     # nginx reverse proxy config
├── doppler-development.cjs      # Doppler dev secrets loader
├── doppler-production.cjs       # Doppler prod secrets loader
├── tsconfig.json                # TypeScript config
├── tsconfig.build.json          # TypeScript build config
└── package.json
```

---

## nginx Setup

See [nginx-music.conf.example](nginx-music.conf.example) for a ready-to-use reverse proxy configuration. Key settings:

- Proxies `/music` → `http://127.0.0.1:3000`
- 300s timeouts for long-running audio processing
- 50MB max upload body size

---

## License

ISC
"typescript": "^5.8.3"
}
}
