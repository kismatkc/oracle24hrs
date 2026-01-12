// app/common_routes/controllers/clipboard.ts
// // clipboard/controller.ts
// import crypto from "crypto";
// import type { Request, Response } from "express";
// /* ========= Config (via env, with sane defaults) ========= */
// const TOKEN = process.env.CLIPBOARD_TOKEN || "change-me";
// const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES || "", 10) || 8 * 1024 * 1024; // 8MB
// const DEFAULT_TTL_SEC = parseInt(process.env.DEFAULT_TTL_SEC || "", 10) || 120; // 2 min
// const MAX_TTL_SEC = parseInt(process.env.MAX_TTL_SEC || "", 10) || 3600;       // 1 hour max
// const CLAIM_TTL_MS = parseInt(process.env.CLAIM_TTL_MS || "", 10) || 15_000;   // 15s claim lease
// /* ========= Types ========= */
// export type ClipboardType = "text" | "image";
// export interface ClipboardItem {
//   id: string;
//   type: ClipboardType;
//   payload: string;   // text or base64 PNG (no data: header)
//   at: number;        // ms epoch when received
//   expiresAt: number; // ms epoch
// }
// type ClaimLease = { id: string; at: number } | null;
// /* ========= In-memory, ephemeral store ========= */
// let item: ClipboardItem | null = null;
// let claim: ClaimLease = null;
// /* ========= Helpers ========= */
// const now = () => Date.now();
// const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// const isExpired = (it: ClipboardItem | null) => !it || now() >= it.expiresAt;
// const clearAll = () => {
//   item = null;
//   claim = null;
// };
// const ensurePng = (buf: Buffer) => {
//   // PNG signature: 89 50 4E 47 0D 0A 1A 0A
//   const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
//   if (buf.length < sig.length) return false;
//   return sig.every((b, i) => buf[i] === b);
// };
// function normalizeIncoming(body: any): { id: string; type: ClipboardType; payload: string } {
//   const { type, payload } = body || {};
//   if (type !== "text" && type !== "image") throw new Error('type must be "text" or "image"');
//   if (typeof payload !== "string" || payload.length === 0) throw new Error("payload required");
//   const id = body.id || crypto.randomUUID();
//   if (type === "image") {
//     // Accept raw base64 or data URL; store raw base64 without header
//     const b64 = payload.replace(/^data:image\/\w+;base64,/, "");
//     if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new Error("image payload not base64");
//     const buf = Buffer.from(b64, "base64");
//     if (buf.length > MAX_IMAGE_BYTES) throw new Error(`image too large (> ${MAX_IMAGE_BYTES} bytes)`);
//     if (!ensurePng(buf)) throw new Error("image must be PNG (convert on iOS Shortcut)");
//     return { id, type, payload: b64 };
//   }
//   // text
//   return { id, type, payload: String(payload) };
// }
// /* ========= Auto cleanup ticks ========= */
// setInterval(() => {
//   // expire item by TTL
//   if (item && isExpired(item)) clearAll();
//   // release stuck claim if not acked within lease
//   if (claim && item && now() - claim.at > CLAIM_TTL_MS) {
//     claim = null;
//   }
// }, 1000).unref();
// /* ========= Auth helper exported for router ========= */
// export function checkBearer(header?: string | null): boolean {
//   return (header || "") === `Bearer ${TOKEN}`;
// }
// /* ========= Controllers ========= */
// // POST /clipboard
// // body: { type: "text"|"image", payload: string, id?: string, ttlSec?: number }
// export function postClipboard(req: Request, res: Response) {
//   try {
//     const base = normalizeIncoming(req.body);
//     const ttlSec = clamp(Number(req.body?.ttlSec ?? DEFAULT_TTL_SEC), 5, MAX_TTL_SEC);
//     const at = now();
//     item = { ...base, at, expiresAt: at + ttlSec * 1000 };
//     claim = null; // invalidate any prior claim (overwrite semantics)
//     return res.json({ ok: true, id: item.id, at, expiresAt: item.expiresAt });
//   } catch (e: any) {
//     return res.status(400).json({ error: String(e?.message || e) });
//   }
// }
// // GET /clipboard/peek  -> meta only (no payload)
// export function peekClipboard(_req: Request, res: Response) {
//   if (!item || isExpired(item)) return res.status(204).end();
//   const { id, type, at, expiresAt } = item;
//   return res.json({ id, type, at, expiresAt, claimed: !!claim });
// }
// // POST /clipboard/claim  -> claim and fetch the payload (one at a time)
// export function claimClipboard(_req: Request, res: Response) {
//   if (!item || isExpired(item)) {
//     clearAll();
//     return res.status(204).end(); // nothing to claim
//   }
//   if (claim) return res.status(409).json({ error: "already claimed" });
//   claim = { id: crypto.randomUUID(), at: now() };
//   return res.json({ claimId: claim.id, ...item });
// }
// // POST /clipboard/ack  -> { claimId } delete after successful receive
// export function ackClipboard(req: Request, res: Response) {
//   if (!item || !claim) return res.status(204).end();
//   const { claimId } = req.body || {};
//   if (!claimId || claimId !== claim.id) return res.status(400).json({ error: "invalid claimId" });
//   clearAll();
//   return res.json({ ok: true });
// }
// // POST /clipboard/release  -> { claimId } release lock without deleting
// export function releaseClipboard(req: Request, res: Response) {
//   if (!item || !claim) return res.status(204).end();
//   const { claimId } = req.body || {};
//   if (!claimId || claimId !== claim.id) return res.status(400).json({ error: "invalid claimId" });
//   claim = null;
//   return res.json({ ok: true });
// }
// // DELETE /clipboard  -> manual clear
// export function deleteClipboard(_req: Request, res: Response) {
//   clearAll();
//   return res.json({ ok: true });
// }
// // HEAD /clipboard/healthz
// export function healthz(_req: Request, res: Response) {
//   return res.status(200).end();
// }
// app/common_routes/controllers/clipboard.ts
// clipboard/controller.ts
import crypto from "crypto";
/* ========= Config (via env, with sane defaults) ========= */
const TOKEN = process.env.CLIPBOARD_TOKEN || "change-me";
const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES || "", 10) || 8 * 1024 * 1024; // 8MB
const DEFAULT_TTL_SEC = parseInt(process.env.DEFAULT_TTL_SEC || "", 10) || 120; // 2 min
const MAX_TTL_SEC = parseInt(process.env.MAX_TTL_SEC || "", 10) || 3600; // 1 hour max
const CLAIM_TTL_MS = parseInt(process.env.CLAIM_TTL_MS || "", 10) || 15000; // 15s claim lease
/* ========= In-memory, ephemeral store ========= */
let item = null;
let claim = null;
/* ========= Helpers ========= */
const now = () => Date.now();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isExpired = (it) => !it || now() >= it.expiresAt;
const clearAll = () => {
    item = null;
    claim = null;
};
const ensurePng = (buf) => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (buf.length < sig.length)
        return false;
    return sig.every((b, i) => buf[i] === b);
};
function normalizeIncoming(body) {
    const { type, payload } = body || {};
    if (type !== "text" && type !== "image")
        throw new Error('type must be "text" or "image"');
    if (typeof payload !== "string" || payload.length === 0)
        throw new Error("payload required");
    const id = body.id || crypto.randomUUID();
    if (type === "image") {
        // Accept raw base64 or data URL; store raw base64 without header
        const b64 = payload.replace(/^data:image\/\w+;base64,/, "");
        if (!/^[A-Za-z0-9+/=\s]+$/.test(b64))
            throw new Error("image payload not base64");
        const buf = Buffer.from(b64, "base64");
        if (buf.length > MAX_IMAGE_BYTES)
            throw new Error(`image too large (> ${MAX_IMAGE_BYTES} bytes)`);
        if (!ensurePng(buf))
            throw new Error("image must be PNG (convert on iOS Shortcut)");
        return { id, type, payload: b64 };
    }
    // text
    return { id, type, payload: String(payload) };
}
/* ========= Auto cleanup ticks ========= */
setInterval(() => {
    // expire item by TTL
    if (item && isExpired(item))
        clearAll();
    // release stuck claim if not acked within lease
    if (claim && item && now() - claim.at > CLAIM_TTL_MS) {
        claim = null;
    }
}, 1000).unref();
/* ========= Auth helper exported for router ========= */
export function checkBearer(header) {
    return (header || "") === `Bearer ${TOKEN}`;
}
/* ========= Controllers ========= */
// POST /clipboard
// body: { type: "text"|"image", payload: string, id?: string, ttlSec?: number }
export function postClipboard(req, res) {
    try {
        console.log("postClipboard", req.body);
        const base = normalizeIncoming(req.body);
        const ttlSec = clamp(Number(req.body?.ttlSec ?? DEFAULT_TTL_SEC), 5, MAX_TTL_SEC);
        const at = now();
        item = { ...base, at, expiresAt: at + ttlSec * 1000 };
        claim = null; // invalidate any prior claim (overwrite semantics)
        res.json({ ok: true, id: item.id, at, expiresAt: item.expiresAt });
        return;
    }
    catch (e) {
        res.status(400).json({ error: String(e?.message || e) });
        return;
    }
}
// GET /clipboard/peek  -> meta only (no payload)
export function peekClipboard(_req, res) {
    if (!item || isExpired(item)) {
        res.status(204).end();
        return;
    }
    const { id, type, at, expiresAt } = item;
    res.json({ id, type, at, expiresAt, claimed: !!claim });
    return;
}
// POST /clipboard/claim  -> claim and fetch the payload (one at a time)
export function claimClipboard(_req, res) {
    if (!item || isExpired(item)) {
        clearAll();
        res.status(204).end(); // nothing to claim
        return;
    }
    if (claim) {
        res.status(409).json({ error: "already claimed" });
        return;
    }
    claim = { id: crypto.randomUUID(), at: now() };
    res.json({ claimId: claim.id, ...item });
    return;
}
// POST /clipboard/ack  -> { claimId } delete after successful receive
export function ackClipboard(req, res) {
    if (!item || !claim) {
        res.status(204).end();
        return;
    }
    const { claimId } = req.body || {};
    if (!claimId || claimId !== claim.id) {
        res.status(400).json({ error: "invalid claimId" });
        return;
    }
    clearAll();
    res.json({ ok: true });
    return;
}
// POST /clipboard/release  -> { claimId } release lock without deleting
export function releaseClipboard(req, res) {
    if (!item || !claim) {
        res.status(204).end();
        return;
    }
    const { claimId } = req.body || {};
    if (!claimId || claimId !== claim.id) {
        res.status(400).json({ error: "invalid claimId" });
        return;
    }
    claim = null;
    res.json({ ok: true });
    return;
}
// DELETE /clipboard  -> manual clear
export function deleteClipboard(_req, res) {
    clearAll();
    res.json({ ok: true });
    return;
}
// HEAD /clipboard/healthz
export function healthz(_req, res) {
    res.status(200).end();
    return;
}
