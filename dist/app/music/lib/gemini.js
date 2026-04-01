// app/music/lib/gemini.ts
// Gemini 2.5 Pro client with two-key rotation on 429.
import { GoogleGenerativeAI } from "@google/generative-ai";
const KEYS = [
    process.env.GOOGLE_API_KEY_1 ?? "",
    process.env.GOOGLE_API_KEY_2 ?? "",
];
let currentKeyIndex = 0;
async function makeGeminiRequest(apiKey, prompt) {
    if (!apiKey)
        throw new Error("Gemini API key is not configured — add GOOGLE_API_KEY_1 and GOOGLE_API_KEY_2 to Doppler");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
}
export async function callGemini(prompt) {
    try {
        return await makeGeminiRequest(KEYS[currentKeyIndex], prompt);
    }
    catch (err) {
        const is429 = err.status === 429 ||
            err.statusCode === 429 ||
            err.message?.includes("429") ||
            err.message?.includes("quota") ||
            err.message?.includes("Resource has been exhausted");
        if (is429 && currentKeyIndex === 0) {
            console.log("[gemini] Key 1 hit quota limit, rotating to Key 2");
            currentKeyIndex = 1;
            return await makeGeminiRequest(KEYS[currentKeyIndex], prompt);
        }
        throw err;
    }
}
