import fs from "fs";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import { dirname } from "path";
import express from "express";
const router = express.Router();
// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function getPhenome(word) {
    return new Promise((resolve, reject) => {
        let found = false;
        const searchWord = word.toLowerCase();
        const filepath = `${__dirname}/../Lexique383.tsv`;
        const stream = fs
            .createReadStream(filepath)
            .pipe(csv({ separator: "\t" }))
            .on("data", (row) => {
            // When we find the word, resolve the promise with the phoneme
            if (row.ortho.toLowerCase() === searchWord) {
                found = true;
                resolve(row.phon);
                // Properly destroy the stream
                stream.destroy();
            }
        })
            .on("end", () => {
            if (!found)
                resolve("Word not found in the lexicon");
        })
            .on("error", (error) => {
            reject(`Error reading file: ${error.message}`);
            throw new Error(`Error reading file: ${error.message}`);
        });
    });
}
async function getWordBreakdown(req, res) {
    try {
        const word = req.params.word;
        const breakdown = await getPhenome(word);
        res.status(200).json({
            success: true,
            data: breakdown,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
        });
    }
}
router.get("/get-word-breakdown/:word", getWordBreakdown);
export default router;
