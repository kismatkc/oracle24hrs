// app/music/controllers/cache-management.ts
// Cache management API — lets the frontend see & delete cached YouTube audio,
// separated stem files, uploaded files, and normalized audio.
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
const router = express.Router();
const ROOT = process.cwd();
const YOUTUBE_CACHE_DIR = path.join(ROOT, "youtube-cache");
const SEPARATED_DIR = path.join(ROOT, "separated");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const NORMALIZED_DIR = path.join(ROOT, "normalized");
const model = process.env.DEMUCS_MODEL || "htdemucs_6s";
// ─── Helpers ─────────────────────────────────────────────────────────────────
function safeStatSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    }
    catch {
        return 0;
    }
}
function safeMtime(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    }
    catch {
        return 0;
    }
}
function dirSizeBytes(dirPath) {
    if (!fs.existsSync(dirPath))
        return 0;
    let total = 0;
    try {
        for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const full = path.join(dirPath, ent.name);
            if (ent.isDirectory())
                total += dirSizeBytes(full);
            else
                total += safeStatSize(full);
        }
    }
    catch { }
    return total;
}
function formatBytes(bytes) {
    if (bytes === 0)
        return "0 B";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
/** List files in a flat directory with size/age info */
function listFilesInDir(dirPath) {
    if (!fs.existsSync(dirPath))
        return { items: [], totalSize: 0 };
    const items = [];
    let totalSize = 0;
    const now = Date.now();
    for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, ent.name);
        const size = ent.isDirectory()
            ? dirSizeBytes(fullPath)
            : safeStatSize(fullPath);
        if (size === 0 && !ent.isDirectory())
            continue;
        totalSize += size;
        const mtime = safeMtime(fullPath);
        items.push({
            name: ent.name,
            fileSize: size,
            fileSizeFormatted: formatBytes(size),
            createdAt: mtime,
            ageHours: Math.round((now - mtime) / 3600000),
        });
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return { items, totalSize };
}
router.get("/cache/youtube", async (_req, res) => {
    try {
        if (!fs.existsSync(YOUTUBE_CACHE_DIR)) {
            res.json({ items: [], totalSize: 0, totalSizeFormatted: "0 B" });
            return;
        }
        const items = [];
        let totalSize = 0;
        const now = Date.now();
        const files = fs.readdirSync(YOUTUBE_CACHE_DIR);
        for (const file of files) {
            if (!file.endsWith(".mp3"))
                continue;
            const videoId = file.replace(".mp3", "");
            const mp3Path = path.join(YOUTUBE_CACHE_DIR, file);
            const metaPath = path.join(YOUTUBE_CACHE_DIR, `${videoId}.meta.json`);
            const size = safeStatSize(mp3Path);
            if (size < 1000)
                continue;
            totalSize += size;
            let title = videoId;
            let author = "Unknown";
            let duration = 0;
            let thumbnail = "";
            try {
                if (fs.existsSync(metaPath)) {
                    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
                    title = meta.title || videoId;
                    author = meta.author || "Unknown";
                    duration = meta.duration || 0;
                    thumbnail = meta.thumbnail || "";
                }
            }
            catch { }
            const mtime = safeMtime(mp3Path);
            const ageMs = now - mtime;
            items.push({
                videoId,
                title,
                author,
                duration,
                thumbnail,
                fileSize: size,
                fileSizeFormatted: formatBytes(size),
                cachedAt: mtime,
                ageHours: Math.round(ageMs / 3600000),
            });
        }
        items.sort((a, b) => b.cachedAt - a.cachedAt);
        res.json({
            items,
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            count: items.length,
        });
    }
    catch (e) {
        console.error("[cache-mgmt] youtube list error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/youtube/:videoId ──────────────────────────────────────────
router.delete("/cache/youtube/:videoId", async (req, res) => {
    try {
        const { videoId } = req.params;
        if (!videoId) {
            res.status(400).json({ error: "videoId required" });
            return;
        }
        const mp3Path = path.join(YOUTUBE_CACHE_DIR, `${videoId}.mp3`);
        const metaPath = path.join(YOUTUBE_CACHE_DIR, `${videoId}.meta.json`);
        let deleted = false;
        if (fs.existsSync(mp3Path)) {
            fs.unlinkSync(mp3Path);
            deleted = true;
        }
        if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
        }
        console.log(`[cache-mgmt] Deleted youtube cache: ${videoId}`);
        res.json({ success: true, deleted });
    }
    catch (e) {
        console.error("[cache-mgmt] youtube delete error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/youtube — delete ALL ──────────────────────────────────────
router.delete("/cache/youtube", async (_req, res) => {
    try {
        if (!fs.existsSync(YOUTUBE_CACHE_DIR)) {
            res.json({ success: true, deletedCount: 0 });
            return;
        }
        let deletedCount = 0;
        for (const file of fs.readdirSync(YOUTUBE_CACHE_DIR)) {
            try {
                fs.unlinkSync(path.join(YOUTUBE_CACHE_DIR, file));
                deletedCount++;
            }
            catch { }
        }
        console.log(`[cache-mgmt] Cleared all youtube cache: ${deletedCount} files`);
        res.json({ success: true, deletedCount });
    }
    catch (e) {
        console.error("[cache-mgmt] youtube clear error:", e);
        res.status(500).json({ error: e.message });
    }
});
router.get("/cache/stems", async (_req, res) => {
    try {
        const stemsRoot = path.join(SEPARATED_DIR, model);
        if (!fs.existsSync(stemsRoot)) {
            res.json({ items: [], totalSize: 0, totalSizeFormatted: "0 B" });
            return;
        }
        const items = [];
        let totalSize = 0;
        const now = Date.now();
        for (const ent of fs.readdirSync(stemsRoot, { withFileTypes: true })) {
            if (!ent.isDirectory())
                continue;
            const dirPath = path.join(stemsRoot, ent.name);
            const size = dirSizeBytes(dirPath);
            totalSize += size;
            const stemFiles = [];
            try {
                for (const f of fs.readdirSync(dirPath)) {
                    if (f.endsWith(".mp3") || f.endsWith(".wav")) {
                        stemFiles.push(f.replace(/\.(mp3|wav)$/, ""));
                    }
                }
            }
            catch { }
            let songId = ent.name;
            if (songId.endsWith("_normalized")) {
                songId = songId.replace(/_normalized$/, "");
            }
            const mtime = safeMtime(dirPath);
            items.push({
                songId,
                dirSize: size,
                dirSizeFormatted: formatBytes(size),
                stemCount: stemFiles.length,
                stems: stemFiles,
                createdAt: mtime,
                ageHours: Math.round((now - mtime) / 3600000),
            });
        }
        items.sort((a, b) => b.createdAt - a.createdAt);
        res.json({
            items,
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            count: items.length,
        });
    }
    catch (e) {
        console.error("[cache-mgmt] stems list error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/stems/:songId ─────────────────────────────────────────────
router.delete("/cache/stems/:songId", async (req, res) => {
    try {
        const { songId } = req.params;
        if (!songId) {
            res.status(400).json({ error: "songId required" });
            return;
        }
        const stemsRoot = path.join(SEPARATED_DIR, model);
        let deleted = false;
        for (const suffix of ["", "_normalized"]) {
            const dirPath = path.join(stemsRoot, `${songId}${suffix}`);
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true });
                deleted = true;
                console.log(`[cache-mgmt] Deleted stem dir: ${dirPath}`);
            }
        }
        // Also clean corresponding files from normalized/ and uploads/
        for (const dir of [NORMALIZED_DIR, UPLOADS_DIR]) {
            if (!fs.existsSync(dir))
                continue;
            try {
                for (const f of fs.readdirSync(dir)) {
                    if (f.includes(songId)) {
                        const fullPath = path.join(dir, f);
                        fs.rmSync(fullPath, { recursive: true });
                        deleted = true;
                        console.log(`[cache-mgmt] Deleted related file: ${fullPath}`);
                    }
                }
            }
            catch (e) {
                console.warn(`[cache-mgmt] Error cleaning ${dir}:`, e);
            }
        }
        // Also clean any input_ prefixed files in the project root
        try {
            for (const f of fs.readdirSync(ROOT)) {
                if (f.startsWith(`input_${songId}`) &&
                    (f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".m4a"))) {
                    fs.unlinkSync(path.join(ROOT, f));
                    console.log(`[cache-mgmt] Deleted leftover input: ${f}`);
                }
            }
        }
        catch { }
        res.json({ success: true, deleted });
    }
    catch (e) {
        console.error("[cache-mgmt] stems delete error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/stems — delete ALL separated stems ────────────────────────
router.delete("/cache/stems", async (_req, res) => {
    try {
        const stemsRoot = path.join(SEPARATED_DIR, model);
        if (!fs.existsSync(stemsRoot)) {
            res.json({ success: true, deletedCount: 0 });
            return;
        }
        let deletedCount = 0;
        for (const ent of fs.readdirSync(stemsRoot, { withFileTypes: true })) {
            if (!ent.isDirectory())
                continue;
            try {
                fs.rmSync(path.join(stemsRoot, ent.name), { recursive: true });
                deletedCount++;
            }
            catch { }
        }
        // Also clean uploads and normalized
        for (const dir of [UPLOADS_DIR, NORMALIZED_DIR]) {
            if (!fs.existsSync(dir))
                continue;
            for (const f of fs.readdirSync(dir)) {
                try {
                    fs.rmSync(path.join(dir, f), { recursive: true });
                }
                catch { }
            }
        }
        console.log(`[cache-mgmt] Cleared all stems: ${deletedCount} dirs`);
        res.json({ success: true, deletedCount });
    }
    catch (e) {
        console.error("[cache-mgmt] stems clear error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── GET /cache/uploads — list uploaded audio files ──────────────────────────
router.get("/cache/uploads", async (_req, res) => {
    try {
        const { items, totalSize } = listFilesInDir(UPLOADS_DIR);
        res.json({
            items,
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            count: items.length,
        });
    }
    catch (e) {
        console.error("[cache-mgmt] uploads list error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/uploads/:name — delete a specific uploaded file ───────────
router.delete("/cache/uploads/:name", async (req, res) => {
    try {
        const { name } = req.params;
        if (!name) {
            res.status(400).json({ error: "name required" });
            return;
        }
        const filePath = path.join(UPLOADS_DIR, name);
        let deleted = false;
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true });
            deleted = true;
            console.log(`[cache-mgmt] Deleted upload: ${name}`);
        }
        res.json({ success: true, deleted });
    }
    catch (e) {
        console.error("[cache-mgmt] upload delete error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/uploads — delete ALL uploads ──────────────────────────────
router.delete("/cache/uploads", async (_req, res) => {
    try {
        if (!fs.existsSync(UPLOADS_DIR)) {
            res.json({ success: true, deletedCount: 0 });
            return;
        }
        let deletedCount = 0;
        for (const f of fs.readdirSync(UPLOADS_DIR)) {
            try {
                fs.rmSync(path.join(UPLOADS_DIR, f), { recursive: true });
                deletedCount++;
            }
            catch { }
        }
        console.log(`[cache-mgmt] Cleared all uploads: ${deletedCount} files`);
        res.json({ success: true, deletedCount });
    }
    catch (e) {
        console.error("[cache-mgmt] uploads clear error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── GET /cache/normalized — list normalized audio files ─────────────────────
router.get("/cache/normalized", async (_req, res) => {
    try {
        const { items, totalSize } = listFilesInDir(NORMALIZED_DIR);
        res.json({
            items,
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            count: items.length,
        });
    }
    catch (e) {
        console.error("[cache-mgmt] normalized list error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/normalized/:name — delete a specific normalized file ──────
router.delete("/cache/normalized/:name", async (req, res) => {
    try {
        const { name } = req.params;
        if (!name) {
            res.status(400).json({ error: "name required" });
            return;
        }
        const filePath = path.join(NORMALIZED_DIR, name);
        let deleted = false;
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true });
            deleted = true;
            console.log(`[cache-mgmt] Deleted normalized: ${name}`);
        }
        res.json({ success: true, deleted });
    }
    catch (e) {
        console.error("[cache-mgmt] normalized delete error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/normalized — delete ALL normalized ────────────────────────
router.delete("/cache/normalized", async (_req, res) => {
    try {
        if (!fs.existsSync(NORMALIZED_DIR)) {
            res.json({ success: true, deletedCount: 0 });
            return;
        }
        let deletedCount = 0;
        for (const f of fs.readdirSync(NORMALIZED_DIR)) {
            try {
                fs.rmSync(path.join(NORMALIZED_DIR, f), { recursive: true });
                deletedCount++;
            }
            catch { }
        }
        console.log(`[cache-mgmt] Cleared all normalized: ${deletedCount} files`);
        res.json({ success: true, deletedCount });
    }
    catch (e) {
        console.error("[cache-mgmt] normalized clear error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── DELETE /cache/all — NUKE EVERYTHING on Oracle ───────────────────────────
router.delete("/cache/all", async (_req, res) => {
    try {
        let totalDeleted = 0;
        // 1. YouTube cache
        if (fs.existsSync(YOUTUBE_CACHE_DIR)) {
            for (const f of fs.readdirSync(YOUTUBE_CACHE_DIR)) {
                try {
                    fs.rmSync(path.join(YOUTUBE_CACHE_DIR, f), { recursive: true });
                    totalDeleted++;
                }
                catch { }
            }
        }
        // 2. Separated stems
        const stemsRoot = path.join(SEPARATED_DIR, model);
        if (fs.existsSync(stemsRoot)) {
            for (const f of fs.readdirSync(stemsRoot)) {
                try {
                    fs.rmSync(path.join(stemsRoot, f), { recursive: true });
                    totalDeleted++;
                }
                catch { }
            }
        }
        // 3. Uploads
        if (fs.existsSync(UPLOADS_DIR)) {
            for (const f of fs.readdirSync(UPLOADS_DIR)) {
                try {
                    fs.rmSync(path.join(UPLOADS_DIR, f), { recursive: true });
                    totalDeleted++;
                }
                catch { }
            }
        }
        // 4. Normalized
        if (fs.existsSync(NORMALIZED_DIR)) {
            for (const f of fs.readdirSync(NORMALIZED_DIR)) {
                try {
                    fs.rmSync(path.join(NORMALIZED_DIR, f), { recursive: true });
                    totalDeleted++;
                }
                catch { }
            }
        }
        // 5. Any leftover input_* files in root
        try {
            for (const f of fs.readdirSync(ROOT)) {
                if (f.startsWith("input_") &&
                    (f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".m4a"))) {
                    fs.unlinkSync(path.join(ROOT, f));
                    totalDeleted++;
                }
            }
        }
        catch { }
        console.log(`[cache-mgmt] ☢️ NUKED all Oracle cache: ${totalDeleted} items`);
        res.json({ success: true, deletedCount: totalDeleted });
    }
    catch (e) {
        console.error("[cache-mgmt] nuke all error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ─── GET /cache/summary — overall cache stats ───────────────────────────────
router.get("/cache/summary", async (_req, res) => {
    try {
        const ytSize = fs.existsSync(YOUTUBE_CACHE_DIR)
            ? dirSizeBytes(YOUTUBE_CACHE_DIR)
            : 0;
        const stemsSize = fs.existsSync(path.join(SEPARATED_DIR, model))
            ? dirSizeBytes(path.join(SEPARATED_DIR, model))
            : 0;
        const uploadsSize = fs.existsSync(UPLOADS_DIR)
            ? dirSizeBytes(UPLOADS_DIR)
            : 0;
        const normalizedSize = fs.existsSync(NORMALIZED_DIR)
            ? dirSizeBytes(NORMALIZED_DIR)
            : 0;
        const categorizedTotal = ytSize + stemsSize + uploadsSize + normalizedSize;
        // ── Full disk audit: scan ALL data directories to catch anything uncategorized
        let auditTotal = 0;
        // 1. youtube-cache/ (entire directory)
        auditTotal += ytSize;
        // 2. separated/ (may have files outside model dir)
        auditTotal += fs.existsSync(SEPARATED_DIR)
            ? dirSizeBytes(SEPARATED_DIR)
            : 0;
        // 3. uploads/
        auditTotal += uploadsSize;
        // 4. normalized/
        auditTotal += normalizedSize;
        // 5. Stray input_* files in project root
        let strayInputsSize = 0;
        try {
            for (const f of fs.readdirSync(ROOT)) {
                if (f.startsWith("input_") &&
                    (f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".m4a"))) {
                    strayInputsSize += safeStatSize(path.join(ROOT, f));
                }
            }
        }
        catch { }
        auditTotal += strayInputsSize;
        // separated/ includes stemsSize but may have extra files at the root level
        // Adjust: auditTotal already counted separated/ fully, but categorized only counted model subdir
        // So replace stemsSize contribution with full separated/ size
        const fullSeparatedSize = fs.existsSync(SEPARATED_DIR)
            ? dirSizeBytes(SEPARATED_DIR)
            : 0;
        const adjustedAudit = ytSize +
            fullSeparatedSize +
            uploadsSize +
            normalizedSize +
            strayInputsSize;
        const untrackedSize = Math.max(0, adjustedAudit - categorizedTotal);
        // Count items
        let ytCount = 0;
        if (fs.existsSync(YOUTUBE_CACHE_DIR)) {
            ytCount = fs
                .readdirSync(YOUTUBE_CACHE_DIR)
                .filter((f) => f.endsWith(".mp3")).length;
        }
        let stemsCount = 0;
        const stemsRoot = path.join(SEPARATED_DIR, model);
        if (fs.existsSync(stemsRoot)) {
            stemsCount = fs
                .readdirSync(stemsRoot, { withFileTypes: true })
                .filter((e) => e.isDirectory()).length;
        }
        let uploadsCount = 0;
        if (fs.existsSync(UPLOADS_DIR)) {
            uploadsCount = fs.readdirSync(UPLOADS_DIR).length;
        }
        let normalizedCount = 0;
        if (fs.existsSync(NORMALIZED_DIR)) {
            normalizedCount = fs.readdirSync(NORMALIZED_DIR).length;
        }
        res.json({
            youtube: {
                count: ytCount,
                size: ytSize,
                sizeFormatted: formatBytes(ytSize),
                purgeAfterDays: 5,
            },
            stems: {
                count: stemsCount,
                size: stemsSize,
                sizeFormatted: formatBytes(stemsSize),
                purgeAfterDays: 3,
            },
            uploads: {
                count: uploadsCount,
                size: uploadsSize,
                sizeFormatted: formatBytes(uploadsSize),
            },
            normalized: {
                count: normalizedCount,
                size: normalizedSize,
                sizeFormatted: formatBytes(normalizedSize),
            },
            total: {
                size: categorizedTotal,
                sizeFormatted: formatBytes(categorizedTotal),
            },
            diskAudit: {
                scannedSize: adjustedAudit,
                scannedSizeFormatted: formatBytes(adjustedAudit),
                categorizedSize: categorizedTotal,
                untrackedSize,
                untrackedSizeFormatted: formatBytes(untrackedSize),
            },
        });
    }
    catch (e) {
        console.error("[cache-mgmt] summary error:", e);
        res.status(500).json({ error: e.message });
    }
});
export default router;
