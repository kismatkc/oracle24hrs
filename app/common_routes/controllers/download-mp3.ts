// import express, { Request, Response } from "express";
// import { BrowserContext } from "playwright";
// import { spawn } from "node:child_process";
// import { once } from "node:events";
// import { getBrowser } from "../../scraper/playright.ts";

// const router = express.Router();
// const HARD_TIMEOUT = 1000 * 120; // 2 min

// /* util: collect a Readable into a Buffer */
// const streamToBuffer = async (readable: NodeJS.ReadableStream) => {
//   const chunks: Buffer[] = [];
//   for await (const chunk of readable) chunks.push(chunk as Buffer);
//   return Buffer.concat(chunks);
// };

// /* util: convert MP3 → WAV (Buffer-in / Buffer-out) */
// const toWavBuffer = async (mp3Buf: Buffer): Promise<Buffer> => {
//   const ff = spawn("ffmpeg", [
//     "-i",
//     "pipe:0", // stdin
//     "-f",
//     "wav",
//     "pipe:1", // stdout
//     "-loglevel",
//     "error", // keep it quiet
//   ]);

//   ff.stdin.write(mp3Buf);
//   ff.stdin.end();

//   const [wavBuf] = await Promise.all([
//     streamToBuffer(ff.stdout),
//     once(ff, "close"),
//   ]);

//   return wavBuf;
// };

// /* GET /download-mp3/:url  → { wavBase64: string } */
// async function downloadMp3(req: Request, res: Response) {
//   let ctx: BrowserContext | null = null;
//   const killer = setTimeout(() => {
//     ctx?.close().catch(() => null);
//     res.status(504).json({ error: "Timed out" });
//   }, HARD_TIMEOUT);

//   try {
//     const videoUrl = decodeURIComponent(req.params.url || "");
//     if (!/^https?:\/\//i.test(videoUrl)) throw new Error("Invalid video URL");

//     const browser = await getBrowser();
//     ctx = await browser.newContext({ acceptDownloads: true });
//     const page = await ctx.newPage();

//     /* open site & submit */
//     await page.goto("https://ytmp3.cc/5Hcs/", {
//       waitUntil: "domcontentloaded",
//     });
//     await page.fill("#v", videoUrl);

//     const convertBtn = page.getByRole("button", {
//       name: "Convert",
//       exact: true,
//     });
//     await Promise.all([
//       convertBtn.click(),
//       page.waitForSelector('xpath=//button[.="Download"] | //a[.="Download"]', {
//         timeout: 110_000,
//       }),
//     ]);

//     /* download */
//     const dlPromise = page.waitForEvent("download");
//     await page
//       .locator('xpath=//button[.="Download"] | //a[.="Download"]')
//       .click();
//     const download = await dlPromise;

//     const mp3Buf = await streamToBuffer(await download.createReadStream());
//     await download.delete(); // <- nothing persists on disk ✔︎
//     await ctx.close(); // closes tmp profile, too
//     clearTimeout(killer);

//     /* convert → WAV → base-64 */
//     const wavBuf = await toWavBuffer(mp3Buf);
//     const wav64 = wavBuf.toString("base64");

//     res.json({ wavBase64: wav64 }); // send to client
//   } catch (err: any) {
//     clearTimeout(killer);
//     await ctx?.close().catch(() => null);
//     res.status(500).json({ error: err.message });
//   }
// }

// router.get("/download-mp3/:url", downloadMp3);
// export default router;

import express, { Request, Response } from "express";
import { BrowserContext } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { getBrowser } from "../../scraper/playright.ts";

const router = express.Router();
const HARD_TIMEOUT = 1000 * 120; // 2 min

/* ---------------- helpers --------------------------------------------- */
const streamToBuffer = async (r: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

const mp3ToWav = async (mp3: Buffer) => {
  const ff = spawn("ffmpeg", [
    "-i",
    "pipe:0",
    "-f",
    "wav",
    "pipe:1",
    "-loglevel",
    "error",
  ]);
  ff.stdin.write(mp3);
  ff.stdin.end();
  const [wav] = await Promise.all([
    streamToBuffer(ff.stdout),
    once(ff, "close"),
  ]);
  return wav;
};

/* ---------------- controller ------------------------------------------ */
async function downloadMp3(req: Request, res: Response) {
  let ctxMeta: BrowserContext | null = null;
  let ctxDl: BrowserContext | null = null;

  const killer = setTimeout(() => {
    ctxMeta?.close().catch(() => null);
    ctxDl?.close().catch(() => null);
    res.status(504).json({ error: "Timed out" });
  }, HARD_TIMEOUT);

  try {
    /* -------- validate URL -------------------------------------------- */
    const videoUrl = decodeURIComponent(req.params.url || "").trim();
    if (!/^https?:\/\//i.test(videoUrl)) throw new Error("Invalid video URL");

    const browser = await getBrowser();

    /* ===== 1.  METADATA  ============================================= */
    ctxMeta = await browser.newContext();
    const pMeta = await ctxMeta.newPage();

    await pMeta.goto("https://mattw.io/youtube-metadata/", {
      waitUntil: "domcontentloaded",
    });
    await pMeta.fill("#value", videoUrl);

    // NEW ➜ click the Submit button, then wait for <pre> JSON
    const submitBtn = pMeta.locator("#submit");
    await Promise.all([
      submitBtn.click(),
      pMeta.waitForSelector("pre", { timeout: 15_000 }),
    ]);

    const raw = await pMeta.$eval("pre", (el) => el.textContent || "{}");
    const meta = JSON.parse(raw);
    const title = meta.title ?? meta.localized?.title ?? "";
    const author = meta.channelTitle ?? "";

    await ctxMeta.close(); // done with metadata

    /* ===== 2.  DOWNLOAD MP3 ========================================== */
    ctxDl = await browser.newContext({ acceptDownloads: true });
    const p = await ctxDl.newPage();

    await p.goto("https://ytmp3.cc/5Hcs/", { waitUntil: "domcontentloaded" });
    await p.fill("#v", videoUrl);

    const convert = p.getByRole("button", { name: "Convert", exact: true });
    await Promise.all([
      convert.click(),
      p.waitForSelector(
        'xpath=//button[normalize-space()="Download"] | //a[normalize-space()="Download"]',
        { timeout: 110_000 }
      ),
    ]);

    const dlEvt = p.waitForEvent("download");
    await p.locator('xpath=//button[.="Download"] | //a[.="Download"]').click();
    const dl = await dlEvt;
    const mp3Buf = await streamToBuffer(await dl.createReadStream());

    await dl.delete(); // no file persists
    await ctxDl.close(); // wipe temp profile

    /* ===== 3.  CONVERT → WAV, ENCODE ================================= */
    const wav64 = (await mp3ToWav(mp3Buf)).toString("base64");

    clearTimeout(killer);
    res.json({ base64Buffer: wav64, title, author });
  } catch (err: any) {
    clearTimeout(killer);
    await ctxMeta?.close().catch(() => null);
    await ctxDl?.close().catch(() => null);
    res.status(500).json({ error: err.message });
  }
}

router.get("/download-mp3/:url", downloadMp3);
export default router;
