// app/common_routes/controllers/updates.ts
// server/updatesRouter.ts
import express, { Router } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
const router = Router();
const ORIGIN = "https://gigidy.link";
const BASE = "/updates";
const ROOT = "/home/ubuntu/Projects/oracle24hrs";
const OUT_DIR = path.join(ROOT, "updates-dist");
const MIME = {
    ".hbc": "application/octet-stream",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".caf": "audio/x-caf",
    ".bin": "application/octet-stream",
};
const CT_TO_EXT = {
    "application/javascript": ".js",
    "application/octet-stream": "",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-caf": ".caf",
};
const ctFromExt = (f) => MIME[path.extname(f).toLowerCase()] || "application/octet-stream";
function sha256(file) {
    const buf = fs.readFileSync(file);
    const h = crypto.createHash("sha256").update(buf);
    const hex = h.digest("hex");
    const b64 = Buffer.from(hex, "hex").toString("base64");
    return { hex, b64, size: buf.length };
}
function safeJSON(p) {
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    }
    catch {
        return {};
    }
}
function walk(dir, out = [], maxDepth = 8, depth = 0) {
    if (!fs.existsSync(dir) || depth > maxDepth)
        return out;
    for (const name of fs.readdirSync(dir)) {
        if (name === ".DS_Store" || name.startsWith(".__") || name.startsWith("._"))
            continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory())
            walk(full, out, maxDepth, depth + 1);
        else
            out.push(full);
    }
    return out;
}
function getRuntimeVersionFromFiles() {
    const shippedApp = safeJSON(path.join(OUT_DIR, "app.json"));
    const expoCfg = shippedApp.expo ?? shippedApp;
    if (expoCfg && typeof expoCfg.runtimeVersion === "string")
        return expoCfg.runtimeVersion;
    if (expoCfg && typeof expoCfg.version === "string")
        return expoCfg.version;
    return "1.0.4";
}
// Simple signature sniffer so assets get correct content-type/ext even if filename has no ext
function sniff(abs) {
    const fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return { contentType: "image/png", ext: ".png" };
    if (buf[0] === 0xff && buf[1] === 0xd8)
        return { contentType: "image/jpeg", ext: ".jpg" };
    if (buf.slice(0, 3).toString("ascii") === "GIF")
        return { contentType: "image/gif", ext: ".gif" };
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP")
        return { contentType: "image/webp", ext: ".webp" };
    if (buf.slice(0, 4).toString("ascii") === "OTTO")
        return { contentType: "font/otf", ext: ".otf" };
    if (buf.readUInt32BE(0) === 0x00010000 || buf.slice(0, 4).toString("ascii") === "true")
        return { contentType: "font/ttf", ext: ".ttf" };
    if (buf.slice(0, 4).toString("ascii") === "caff")
        return { contentType: "audio/x-caf", ext: ".caf" };
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WAVE")
        return { contentType: "audio/wav", ext: ".wav" };
    if (buf.slice(0, 3).toString("ascii") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
        return { contentType: "audio/mpeg", ext: ".mp3" };
    const guessed = ctFromExt(abs);
    return { contentType: guessed, ext: CT_TO_EXT[guessed] || "" };
}
router.use(`${BASE}`, (req, _res, next) => {
    const plat = req.headers["expo-platform"] || req.query.platform || "";
    const rt = req.headers["expo-runtime-version"] || req.query.runtimeVersion || "";
    const ua = req.headers["user-agent"] || "";
    console.log(`[updates] ${req.method} ${req.path} :: platform=${plat} runtime=${rt} UA="${ua}"`);
    next();
});
router.get(`${BASE}/ping`, (_req, res) => res.status(200).send("ok"));
router.get(`${BASE}/debug`, (_req, res) => {
    const metaPath = path.join(OUT_DIR, "metadata.json");
    const appPath = path.join(OUT_DIR, "app.json");
    const exists = {
        OUT_DIR: fs.existsSync(OUT_DIR),
        "updates-dist/app.json": fs.existsSync(appPath),
        "updates-dist/metadata.json": fs.existsSync(metaPath),
        "updates-dist/_expo": fs.existsSync(path.join(OUT_DIR, "_expo")),
        "updates-dist/assets": fs.existsSync(path.join(OUT_DIR, "assets")),
    };
    let fmBundle = null;
    try {
        fmBundle = safeJSON(path.join(OUT_DIR, "metadata.json"))?.fileMetadata?.ios?.bundle ?? null;
    }
    catch { }
    res.json({ node: process.version, ROOT, OUT_DIR, exists, iosBundleRel: fmBundle, runtimeVersionFromFiles: getRuntimeVersionFromFiles() });
});
// Collect assets from metadata.json (preferred) or by walking
function collectAssets(meta, platform) {
    const picked = [];
    if (Array.isArray(meta?.assets)) {
        for (const a of meta.assets)
            if (a?.path)
                picked.push({ rel: a.path, contentType: a.contentType });
    }
    const fm = meta?.fileMetadata?.[platform];
    if (Array.isArray(fm?.assets)) {
        for (const a of fm.assets) {
            if (typeof a === "string")
                picked.push({ rel: a });
            else if (a?.path)
                picked.push({ rel: a.path, contentType: a.contentType });
        }
    }
    if (picked.length)
        return { entries: picked, source: "metadata" };
    const rels = walk(OUT_DIR)
        .map(abs => path.relative(OUT_DIR, abs).replace(/\\/g, "/"))
        .filter(rel => !rel.endsWith(".hbc") && rel !== "metadata.json" && rel !== "app.json" &&
        (/(^|\/)assets\//.test(rel) || /\/_expo\/static\/media\//.test(rel) || /\/_expo\/static\/fonts\//.test(rel)));
    return { entries: rels.map(rel => ({ rel })), source: "walk" };
}
function serveManifest(req, res) {
    const t0 = Date.now();
    try {
        const platform = (req.headers["expo-platform"] || req.query.platform || "ios").toLowerCase();
        const headerRuntime = req.headers["expo-runtime-version"] || req.query.runtimeVersion || "";
        const runtimeVersion = headerRuntime || getRuntimeVersionFromFiles();
        const metaPath = path.join(OUT_DIR, "metadata.json");
        if (!fs.existsSync(metaPath))
            throw new Error("metadata.json not found in updates-dist");
        const meta = safeJSON(metaPath);
        const fm = meta?.fileMetadata?.[platform];
        if (!fm?.bundle)
            throw new Error(`fileMetadata.${platform}.bundle missing in metadata.json`);
        const launchRel = fm.bundle; // "_expo/static/js/ios/index-....hbc"
        const launchAbs = path.join(OUT_DIR, launchRel);
        if (!fs.existsSync(launchAbs))
            throw new Error(`launch bundle not found: ${launchRel}`);
        const launchDig = sha256(launchAbs);
        const { entries, source } = collectAssets(meta, platform);
        const assets = entries.map(({ rel, contentType }) => {
            const abs = path.join(OUT_DIR, rel);
            if (!fs.existsSync(abs)) {
                console.warn(`[updates] missing asset on disk (skipping): ${rel}`);
                return null;
            }
            const dig = sha256(abs);
            const sn = sniff(abs);
            const finalCT = contentType || sn.contentType || ctFromExt(abs);
            const finalExt = CT_TO_EXT[finalCT] || sn.ext || path.extname(abs) || "";
            return {
                key: path.basename(abs),
                contentType: finalCT,
                fileExtension: finalExt,
                fileSHA256: dig.b64, // EAS-style
                url: `${ORIGIN}${BASE}/${encodeURI(rel)}`,
                size: dig.size,
            };
        }).filter(Boolean);
        const shippedApp = safeJSON(path.join(OUT_DIR, "app.json"));
        const expoClient = shippedApp.expo ?? shippedApp;
        const appVersion = typeof expoClient?.version === "string" ? expoClient.version : null;
        const manifest = {
            id: crypto.randomUUID(), // UUID required
            createdAt: new Date().toISOString(),
            runtimeVersion,
            metadata: {},
            manifestFilters: {},
            launchAsset: {
                key: path.basename(launchAbs),
                contentType: ctFromExt(launchAbs), // ok for .hbc
                fileSHA256: launchDig.b64, // EAS-style
                url: `${ORIGIN}${BASE}/${encodeURI(launchRel)}`,
                size: launchDig.size,
            },
            assets,
            extra: { expoClient, appVersion },
        };
        console.log(`[updates] manifest built in ${Date.now() - t0}ms :: runtime=${runtimeVersion} platform=${platform} assets=${assets.length} (source=${source}) launch=${path.basename(launchRel)} size=${launchDig.size}`);
        for (const a of assets.slice(0, 8)) {
            console.log(`[updates] asset: ${a.contentType} ${a.size}B ext=${a.fileExtension || "(none)"} → ${a.url.replace(ORIGIN, "")}`);
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-transform, private, max-age=0");
        res.setHeader("expo-protocol-version", "0");
        res.status(200).send(JSON.stringify(manifest));
    }
    catch (e) {
        console.error("[updates] manifest error:", e?.message || e);
        res.status(500).json({ error: e?.message || "manifest error" });
    }
}
// manifest endpoints
router.get(`${BASE}`, serveManifest);
router.head(`${BASE}`, serveManifest);
router.get(`${BASE}/manifest`, serveManifest);
// ---- Static files with digest headers (compat for older native code paths)
const shaCache = new Map();
router.use(`${BASE}`, (req, res, next) => {
    const start = Date.now();
    res.setHeader("Content-Encoding", "identity");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable, no-transform");
    res.on("finish", () => {
        const rel = decodeURIComponent(req.path.replace(/^\//, ""));
        const abs = path.join(OUT_DIR, rel);
        const ms = Date.now() - start;
        let size = "-";
        try {
            if (fs.existsSync(abs)) {
                const st = fs.statSync(abs);
                if (st.isFile())
                    size = String(st.size);
            }
        }
        catch { }
        console.log(`[updates] static ${req.method} ${req.path} -> ${res.statusCode} size=${size}B in ${ms}ms`);
    });
    next();
});
router.use(`${BASE}`, express.static(OUT_DIR, {
    fallthrough: true,
    immutable: true,
    maxAge: "365d",
    setHeaders: (res, p) => {
        try {
            const sn = sniff(p);
            res.type(sn.contentType || ctFromExt(p));
            // attach digest headers (compat with older expo-updates that inspect headers)
            let c = shaCache.get(p);
            if (!c) {
                const { b64, size } = sha256(p);
                c = { b64, size };
                shaCache.set(p, c);
            }
            res.setHeader("x-expo-update-asset-sha256", c.b64);
            res.setHeader("expo-asset-sha256", c.b64);
            res.setHeader("x-amz-meta-sha256", c.b64);
        }
        catch {
            res.type(ctFromExt(p));
        }
        res.setHeader("Content-Encoding", "identity");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable, no-transform");
    },
}));
export default router;
