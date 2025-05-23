import express, { Request, Response } from "express";
import { getBrowser } from "../playright.ts";
import { BrowserContext } from "playwright";
import axios from "axios";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const router = express.Router();
const globalTimeout = 1000 * 10; // 15 seconds

// const extractLyricsFromReadability = (jsonResponse: any): string[] => {
//   // Extract HTML content directly from the JSON response
//   const { content: htmlContent } = jsonResponse;

//   if (!htmlContent || typeof htmlContent !== "string") {
//     throw new Error("Invalid JSON response: missing or invalid content field");
//   }

//   // Parse HTML using JSDOM
//   const dom = new JSDOM(htmlContent);
//   const { document, Node } = dom.window; // Get Node from JSDOM window

//   // Find the root node - prefer #readability-page-1, fallback to body
//   const rootNode =
//     document.querySelector("#readability-page-1") ||
//     document.body ||
//     document.documentElement;

//   if (!rootNode) {
//     throw new Error("Could not find valid root node in HTML content");
//   }

//   const lines: string[] = [];
//   let currentBuffer = "";

//   // Block-level elements that should trigger paragraph/stanza breaks
//   const blockElements = new Set([
//     "P",
//     "DIV",
//     "BLOCKQUOTE",
//     "LI",
//     "UL",
//     "OL",
//     "H1",
//     "H2",
//     "H3",
//     "H4",
//     "H5",
//     "H6",
//     "SECTION",
//     "ARTICLE",
//     "HEADER",
//     "FOOTER",
//     "MAIN",
//     "ASIDE",
//     "NAV",
//     "PRE",
//   ]);

//   const flushBuffer = (): void => {
//     if (currentBuffer.trim()) {
//       lines.push(currentBuffer.trim());
//       currentBuffer = "";
//     }
//   };

//   const traverseNode = (node: Node): void => {
//     if (node.nodeType === Node.TEXT_NODE) {
//       // Text node - append to buffer
//       currentBuffer += node.textContent || "";
//     } else if (node.nodeType === Node.ELEMENT_NODE) {
//       const element = node as Element;
//       const tagName = element.tagName.toUpperCase();

//       if (tagName === "BR") {
//         // Line break - flush current buffer and start new line
//         flushBuffer();
//       } else if (blockElements.has(tagName)) {
//         // Block element - flush before, traverse children, flush after + blank line
//         flushBuffer();

//         // Traverse children using for...of
//         for (const child of element.childNodes) {
//           traverseNode(child);
//         }

//         flushBuffer();
//         // Add blank line to separate stanzas/paragraphs
//         if (lines.length > 0 && lines[lines.length - 1] !== "") {
//           lines.push("");
//         }
//       } else {
//         // Inline element - just traverse children
//         for (const child of element.childNodes) {
//           traverseNode(child);
//         }
//       }
//     }
//   };

//   // Start traversal
//   traverseNode(rootNode);

//   // Flush any remaining buffer
//   flushBuffer();

//   // Post-process: remove consecutive blank lines and trim
//   const cleanLines = lines.reduce<string[]>((acc, line) => {
//     const trimmedLine = line.trim();
//     const lastLine = acc[acc.length - 1];

//     if (trimmedLine === "") {
//       // Only add blank line if the last line wasn't empty and we have content
//       if (lastLine && lastLine !== "") {
//         acc.push("");
//       }
//     } else {
//       acc.push(trimmedLine);
//     }

//     return acc;
//   }, []);

//   return cleanLines;
// };
const extractLyricsFromReadability = (jsonResponse: any): string[] => {
  // Extract HTML content directly from the JSON response
  const { content: htmlContent } = jsonResponse;

  if (!htmlContent || typeof htmlContent !== "string") {
    throw new Error("Invalid JSON response: missing or invalid content field");
  }

  // Parse HTML using JSDOM
  const dom = new JSDOM(htmlContent);
  const { document, Node } = dom.window; // Get Node from JSDOM window

  // Find the root node - prefer #readability-page-1, fallback to body
  const rootNode =
    document.querySelector("#readability-page-1") ||
    document.body ||
    document.documentElement;

  if (!rootNode) {
    throw new Error("Could not find valid root node in HTML content");
  }

  const lines: string[] = [];
  let currentBuffer = "";

  // Block-level elements that should trigger paragraph/stanza breaks
  const blockElements = new Set([
    "P",
    "DIV",
    "BLOCKQUOTE",
    "LI",
    "UL",
    "OL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "MAIN",
    "ASIDE",
    "NAV",
    "PRE",
  ]);

  const flushBuffer = (): void => {
    if (currentBuffer.trim()) {
      lines.push(currentBuffer.trim());
      currentBuffer = "";
    }
  };

  const traverseNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Text node - append to buffer
      currentBuffer += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toUpperCase();

      if (tagName === "BR") {
        // Line break - flush current buffer and start new line
        flushBuffer();
      } else if (blockElements.has(tagName)) {
        // Block element - flush before, traverse children, flush after + blank line
        flushBuffer();

        // Traverse children using for...of
        for (const child of element.childNodes) {
          traverseNode(child);
        }

        flushBuffer();
        // Add blank line to separate stanzas/paragraphs
        if (lines.length > 0 && lines[lines.length - 1] !== "") {
          lines.push("");
        }
      } else {
        // Inline element - just traverse children
        for (const child of element.childNodes) {
          traverseNode(child);
        }
      }
    }
  };

  // Start traversal
  traverseNode(rootNode);

  // Flush any remaining buffer
  flushBuffer();

  // Post-process: remove consecutive blank lines and trim
  const cleanLines = lines.reduce<string[]>((acc, line) => {
    const trimmedLine = line.trim();
    const lastLine = acc[acc.length - 1];

    if (trimmedLine === "") {
      // Only add blank line if the last line wasn't empty and we have content
      if (lastLine && lastLine !== "") {
        acc.push("");
      }
    } else {
      acc.push(trimmedLine);
    }

    return acc;
  }, []);

  // Final refinement: limit consecutive empty lines to maximum 1
  const refinedLines = cleanLines.reduce<string[]>((acc, line) => {
    if (line === "") {
      // Count consecutive empty lines at the end of acc
      let consecutiveEmptyCount = 0;
      for (let i = acc.length - 1; i >= 0; i--) {
        if (acc[i] === "") {
          consecutiveEmptyCount++;
        } else {
          break;
        }
      }

      // Only add empty line if we have less than 1 consecutive empty line
      if (consecutiveEmptyCount < 1) {
        acc.push("");
      }
      // If we already have 1 or more consecutive empty lines, ignore this one
    } else {
      acc.push(line);
    }

    return acc;
  }, []);

  return refinedLines;
};
async function getGoogleSearchFirstResult(query: string) {
  try {
    const modifiedQuery = `${query} song lyrics`;
    const response = await axios.get(
      "https://www.googleapis.com/customsearch/v1",
      {
        params: {
          key: process.env.GOOGLE_NOBILLING_API_KEY_2,
          cx: process.env.SEARCHENGINE_ID_2,
          q: modifiedQuery,
          num: 10,
          siteSearch:
            "youtube.com reddit.com spotify.com facebook.com instagram.com dailymotion.com wikipedia.org",
          siteSearchFilter: "e", // 'e' means exclude both YouTube and Reddit
        },
      }
    );

    const results = response.data.items || [];

    if (results.length === 0) {
      return [];
    }

    // Sort results to prioritize titles containing "lyrics" and "chords"
    const sortedResults = results.sort((a, b) => {
      const titleA = (a.title || "").toLowerCase();
      const titleB = (b.title || "").toLowerCase();

      // Check for "lyrics" as substring (catches "lyrics", "azlyrics", "songlyrics", etc.)
      const hasLyricsA = titleA.includes("lyrics");
      const hasLyricsB = titleB.includes("lyrics");

      // Check for "chord" as substring (catches "chords", "chord", etc.)
      const hasChordsA = titleA.includes("chord");
      const hasChordsB = titleB.includes("chord");

      // Calculate priority scores
      const scoreA = (hasLyricsA ? 2 : 0) + (hasChordsA ? 1 : 0);
      const scoreB = (hasLyricsB ? 2 : 0) + (hasChordsB ? 1 : 0);

      // Higher score comes first
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      // If scores are equal, maintain original order
      return 0;
    });

    return sortedResults;
  } catch (error) {
    console.log(
      "Error fetching Google search results:",
      error.response?.data || error.message
    );
    return [];
  }
}
async function scrapeLyrisc(req: Request, res: Response) {
  let context: BrowserContext | null = null;

  const timeoutId = setTimeout(() => {
    if (context) {
      context.close();
      res.status(200).json({
        status: 200,
        message: "Lyrics not found",
        data: {},
      });
    }
  }, globalTimeout);

  try {
    const songName = req.params.songName.toLowerCase();
    const browser = await getBrowser();
    context = await browser.newContext();
    const page = await context.newPage();

    // Fetch search results
    const results = await getGoogleSearchFirstResult(songName);
    if (!results || results.length === 0) {
      throw new Error("No search results found for the song");
    }

    // Use the first result instead of the second
    const url = results[0].link;

    // Navigate and wait for full content load
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Get the HTML and log a snippet for debugging
    const pageHtml = await page.content();

    // Parse with Readability
    const dom = new JSDOM(pageHtml);
    const reader = new Readability(dom.window.document);
    const readabilityResult = reader.parse();

    if (!readabilityResult) {
      throw new Error("Readability failed to parse the content");
    }

    const lyrics = extractLyricsFromReadability(readabilityResult);

    clearTimeout(timeoutId);
    res.send({
      status: 200,
      message: "Lyrics found",
      lyrics,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Error in scrapeLyrisc:", error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.error("Error closing browser:", error);
      }
    }
  }
}

router.get("/scrape-lyrics/:songName", scrapeLyrisc);
export default router;
