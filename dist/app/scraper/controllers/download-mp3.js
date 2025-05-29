import express from "express";
import { randomUUID } from "node:crypto";
import { getBrowser } from "../playright.js";
/* ---------- progress store ---------- */
const progress = {};
const setP = (id, p) => {
    progress[id] = p;
    console.log("[setP]", id, p);
};
const router = express.Router();
const HARD_TIMEOUT = 1000 * 180;
/* ---------- helpers ---------- */
async function streamToBuffer(r, onChunk) {
    const chunks = [];
    let read = 0;
    for await (const c of r) {
        chunks.push(c);
        read += c.length;
        // Simple progress based on bytes read (estimate 10MB max)
        onChunk(Math.min(0.95, read / (1024 * 1024 * 10)));
    }
    return Buffer.concat(chunks);
}
/* ---------- controller ---------- */
async function downloadMp3(req, res) {
    const id = req.query.id || randomUUID();
    console.log("[dl] new request id", id, "url", req.query.url);
    let ctxMeta = null;
    let ctxDl = null;
    const killer = setTimeout(() => {
        ctxMeta?.close().catch(() => null);
        ctxDl?.close().catch(() => null);
        setP(id, 1);
        res.status(504).json({ error: "Timed out" });
    }, HARD_TIMEOUT);
    try {
        const videoUrl = req.query.url;
        if (!/^https?:\/\//i.test(videoUrl))
            throw new Error("Invalid URL");
        const browser = await getBrowser();
        /* 1. metadata */
        setP(id, 0.05);
        ctxMeta = await browser.newContext();
        const pMeta = await ctxMeta.newPage();
        await pMeta.goto("https://mattw.io/youtube-metadata/");
        await pMeta.fill("#value", videoUrl);
        await Promise.all([
            pMeta.locator("#submit").click(),
            pMeta.waitForSelector("pre", { timeout: 15000 }),
        ]);
        const raw = await pMeta.$eval("pre", (el) => el.textContent || "{}");
        const meta = JSON.parse(raw);
        const title = meta.title ?? meta.localized?.title ?? "";
        const author = meta.channelTitle ?? "";
        await ctxMeta.close();
        setP(id, 0.15);
        /* 2. convert / download */
        ctxDl = await browser.newContext({ acceptDownloads: true });
        const p = await ctxDl.newPage();
        await p.goto("https://ytmp3.cc/5Hcs/");
        await p.fill("#v", videoUrl);
        await Promise.all([
            p.getByRole("button", { name: "Convert", exact: true }).click(),
            p.waitForSelector('xpath=//button[normalize-space()="Download"] | //a[normalize-space()="Download"]', { timeout: 110000 }),
        ]);
        setP(id, 0.4);
        const dlEvt = p.waitForEvent("download");
        await p.locator('xpath=//button[.="Download"] | //a[.="Download"]').click();
        const dl = await dlEvt;
        // No HEAD request - just stream directly
        const mp3Buf = (await streamToBuffer(await dl.createReadStream(), (f) => setP(id, 0.4 + f * 0.55))).toString("base64");
        await dl.delete();
        await ctxDl.close();
        clearTimeout(killer);
        setP(id, 1);
        console.log("[dl] finished id", id);
        res.json({ base64Buffer: mp3Buf, title, author, id });
    }
    catch (err) {
        clearTimeout(killer);
        setP(id, 1);
        await ctxMeta?.close().catch(() => null);
        await ctxDl?.close().catch(() => null);
        console.log("[dl] error", err);
        res.status(500).json({ error: err.message });
    }
}
/* ---------- progress endpoint ---------- */
router.get("/progress/:id", (req, res) => {
    const val = progress[req.params.id] ?? 0;
    console.log("[progress] id", req.params.id, "->", val);
    res.json({ progress: val });
});
router.get("/download-mp3", downloadMp3);
export default router;
