"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disablePeriodicRestart = exports.enablePeriodicRestart = exports.restartBrowser = exports.closeBrowser = exports.getBrowser = void 0;
var playwright_1 = require("playwright");
// Private state
var browserInstance = null;
var restartTimer = null;
var startBrowser = function () { return __awaiter(void 0, void 0, void 0, function () {
    var error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, playwright_1.chromium.launch({
                        headless: process.env.ENVIRONMENT === "development" ? false : true,
                    })];
            case 1:
                browserInstance = _a.sent();
                console.log("Browser started successfully");
                return [3 /*break*/, 3];
            case 2:
                error_1 = _a.sent();
                browserInstance = null;
                console.error("Failed to start browser:", error_1);
                throw error_1;
            case 3: return [2 /*return*/];
        }
    });
}); };
/**
 * Close the current browser instance if it exists
 */
var closeBrowser = function () { return __awaiter(void 0, void 0, void 0, function () {
    var error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                if (!browserInstance) return [3 /*break*/, 2];
                return [4 /*yield*/, browserInstance.close()];
            case 1:
                _a.sent();
                browserInstance = null;
                console.log("Browser closed successfully");
                _a.label = 2;
            case 2: return [3 /*break*/, 4];
            case 3:
                error_2 = _a.sent();
                console.error("Error closing browser:", error_2);
                browserInstance = null;
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.closeBrowser = closeBrowser;
/**
 * Restart the browser instance
 */
var restartBrowser = function () { return __awaiter(void 0, void 0, void 0, function () {
    var error_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                return [4 /*yield*/, closeBrowser()];
            case 1:
                _a.sent();
                return [4 /*yield*/, startBrowser()];
            case 2:
                _a.sent();
                return [3 /*break*/, 4];
            case 3:
                error_3 = _a.sent();
                console.error("Error restarting browser:", error_3);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.restartBrowser = restartBrowser;
/**
 * Get the current browser instance or start a new one if none exists
 */
var getBrowser = function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!!browserInstance) return [3 /*break*/, 2];
                return [4 /*yield*/, startBrowser()];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2:
                if (!browserInstance) {
                    throw new Error("Failed to initialize browser");
                }
                return [2 /*return*/, browserInstance];
        }
    });
}); };
exports.getBrowser = getBrowser;
/**
 * Configure periodic restart of the browser
 */
var enablePeriodicRestart = function (intervalMs) {
    if (intervalMs === void 0) { intervalMs = 24 * 60 * 60 * 1000; }
    // Clear any existing timer
    if (restartTimer) {
        clearInterval(restartTimer);
    }
    restartTimer = setInterval(function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("Scheduled browser restart");
                    return [4 /*yield*/, restartBrowser()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); }, intervalMs);
    console.log("Browser will restart every ".concat(intervalMs / (60 * 60 * 1000), " hours"));
};
exports.enablePeriodicRestart = enablePeriodicRestart;
/**
 * Stop periodic browser restarts
 */
var disablePeriodicRestart = function () {
    if (restartTimer) {
        clearInterval(restartTimer);
        restartTimer = null;
        console.log("Stopped periodic browser restarts");
    }
};
exports.disablePeriodicRestart = disablePeriodicRestart;
// Initialize the browser
startBrowser().catch(function (error) {
    console.error("Initial browser startup failed:", error);
});
// Enable periodic restarts by default (every 24 hours)
enablePeriodicRestart();
