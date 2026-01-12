// app/common_routes/routes/clipboard.ts
import { Router } from "express";
import { postClipboard, peekClipboard, claimClipboard, ackClipboard, releaseClipboard, deleteClipboard, healthz, checkBearer, } from "../controllers/clipboard.js";
const router = Router();
// Debug logger helper
const debug = (section, message, data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ROUTER:${section}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
};
/* ---- bearer auth ---- */
function auth(req, res, next) {
    const startTime = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers?.['user-agent'] || 'unknown';
    debug('AUTH', `Auth check started for ${req.method} ${req.path}`, {
        ip,
        userAgent,
        hasAuthHeader: !!req.headers?.authorization,
        authHeaderPrefix: req.headers?.authorization?.substring(0, 10) + '...',
    });
    if (!req.headers?.authorization) {
        debug('AUTH', 'Auth failed: No authorization header');
        return res.status(401).json({ error: "unauthorized" });
    }
    const bearerCheck = checkBearer(req.headers.authorization);
    debug('AUTH', `Bearer check result: ${bearerCheck}`, {
        authTime: Date.now() - startTime + 'ms'
    });
    if (!bearerCheck) {
        debug('AUTH', 'Auth failed: Invalid bearer token');
        return res.status(401).json({ error: "unauthorized" });
    }
    debug('AUTH', `Auth success for ${req.method} ${req.path}`, {
        totalAuthTime: Date.now() - startTime + 'ms'
    });
    next();
}
// Request/response logging middleware
const requestLogger = (routeName) => {
    return (req, res, next) => {
        const startTime = Date.now();
        const reqId = Math.random().toString(36).substr(2, 9);
        // Log incoming request
        debug(routeName, `[${reqId}] Incoming request`, {
            method: req.method,
            path: req.path,
            query: req.query,
            bodySize: req.body ? JSON.stringify(req.body).length : 0,
            contentType: req.headers?.['content-type'],
            ip: req.ip || req.connection?.remoteAddress,
        });
        // Capture original res.json to log responses
        const originalJson = res.json.bind(res);
        res.json = function (data) {
            const duration = Date.now() - startTime;
            debug(routeName, `[${reqId}] Response sent`, {
                statusCode: res.statusCode,
                duration: duration + 'ms',
                responseSize: JSON.stringify(data).length,
                success: res.statusCode < 400
            });
            return originalJson(data);
        };
        // Capture original res.status to log status changes
        const originalStatus = res.status.bind(res);
        res.status = function (code) {
            debug(routeName, `[${reqId}] Status set to ${code}`);
            return originalStatus(code);
        };
        req.debugReqId = reqId;
        next();
    };
};
// Error handling wrapper
const asyncHandler = (routeName, fn) => {
    return async (req, res, next) => {
        const reqId = req.debugReqId || 'unknown';
        try {
            debug(routeName, `[${reqId}] Controller execution started`);
            await fn(req, res, next);
            debug(routeName, `[${reqId}] Controller execution completed successfully`);
        }
        catch (error) {
            debug(routeName, `[${reqId}] Controller error`, {
                error: error.message,
                stack: error.stack?.split('\n').slice(0, 5), // First 5 lines of stack
            });
            if (!res.headersSent) {
                res.status(500).json({
                    error: "internal server error",
                    reqId: reqId
                });
            }
            next(error);
        }
    };
};
/* ---- routes with debug logging ---- */
router.post("/clipboard", requestLogger('POST_CLIPBOARD'), auth, asyncHandler('POST_CLIPBOARD', postClipboard));
router.get("/clipboard/peek", requestLogger('PEEK_CLIPBOARD'), auth, asyncHandler('PEEK_CLIPBOARD', peekClipboard));
router.post("/clipboard/claim", requestLogger('CLAIM_CLIPBOARD'), auth, asyncHandler('CLAIM_CLIPBOARD', claimClipboard));
router.post("/clipboard/ack", requestLogger('ACK_CLIPBOARD'), auth, asyncHandler('ACK_CLIPBOARD', ackClipboard));
router.post("/clipboard/release", requestLogger('RELEASE_CLIPBOARD'), auth, asyncHandler('RELEASE_CLIPBOARD', releaseClipboard));
router.delete("/clipboard", requestLogger('DELETE_CLIPBOARD'), auth, asyncHandler('DELETE_CLIPBOARD', deleteClipboard));
router.head("/clipboard/healthz", requestLogger('HEALTHZ'), asyncHandler('HEALTHZ', healthz));
// 404 handler for clipboard routes
router.use((req, res) => {
    debug('404', `Route not found: ${req.method} ${req.originalUrl}`, {
        availableRoutes: [
            'POST /clipboard',
            'GET /clipboard/peek',
            'POST /clipboard/claim',
            'POST /clipboard/ack',
            'POST /clipboard/release',
            'DELETE /clipboard',
            'HEAD /clipboard/healthz'
        ]
    });
    res.status(404).json({ error: "route not found" });
});
// Log router initialization
debug('INIT', 'Clipboard router initialized with all routes and debug logging');
export default router;
