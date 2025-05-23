// // import { Readability } from "@mozilla/readability";

// const router = express.Router();
// // // console.log(process.env);
// // function isEnglishCharactersOnly(text: string): boolean {
// //   // Using regular expression to match only English letters
// //   const englishLettersRegex = /^[A-Za-z]+$/;

// //   // Return true if the text matches the regex (contains only English letters)
// //   return englishLettersRegex.test(text);
// // }

// const globalTimeout = 1000 * 15; // 15 seconds
// interface LyricsLine {
//   original: string;
//   translated: string;
// }

// const FuseOptions = {
//   keys: ["title"], // The property to search in each item
//   threshold: 0.4, // How fuzzy the matching is (0 = exact, 1 = very loose)
//   includeScore: true, // Shows how well each result matches,
//   isCaseSensitive: false, // Whether the search is case sensitive
//   ignoreLocation: true, // Ignore the location of the search term
// };

// interface LyricsSection {
//   heading: string;
//   lyrics: LyricsLine[];
// }

// interface LyricsData {
//   sections: LyricsSection[];
// }

// async function getRapLyrics(
//   startElement: any
// ): Promise<{ lyrics: LyricsLine[] }> {
//   // First get the proper lyrics container (parent of the lyrics section)
//   const lyricsContainerHandle = await startElement.evaluateHandle((el) => {
//     return el.parentElement.parentElement.parentElement;
//   });

//   const data = await lyricsContainerHandle.evaluate(
//     (lyricsContainer: HTMLElement) => {
//       const lyricsLines: LyricsLine[] = [];

//       // Get the second child div which hosts all the lyrics according to the description
//       const containerDivs = Array.from(lyricsContainer.children).filter(
//         (el): el is HTMLDivElement => el.tagName === "DIV"
//       );

//       // Make sure we have at least 2 children
//       if (containerDivs.length < 2) {
//         return { lyrics: lyricsLines };
//       }

//       // The second child should be the lyrics container
//       const lyricsMainContainer = containerDivs[1];

//       // Process all lyrics sections (direct children of main container)
//       Array.from(lyricsMainContainer.children).forEach((sectionDiv) => {
//         if (sectionDiv.tagName !== "DIV") return;

//         // Each section div contains multiple lyric line divs
//         const lyricDivs = Array.from(sectionDiv.children).filter(
//           (el): el is HTMLDivElement => el.tagName === "DIV"
//         );

//         // Process each lyric div in this section
//         lyricDivs.forEach((lyricDiv) => {
//           // Each lyric div should have two child divs - original and translation
//           const textDivs = Array.from(lyricDiv.children).filter(
//             (el): el is HTMLDivElement => el.tagName === "DIV"
//           );

//           // Only process if we have at least 2 children (original + translation)
//           if (textDivs.length >= 2) {
//             // Extract the text content from each div
//             let original = "";
//             let translated = "";

//             // The first div (original) might have nested structure
//             const firstDivContent =
//               textDivs[0].querySelector('[dir="auto"]')?.textContent ||
//               textDivs[0].textContent;

//             // The second div (translation) might have nested structure
//             const secondDivContent =
//               textDivs[1].querySelector('[dir="auto"]')?.textContent ||
//               textDivs[1].textContent;

//             original = firstDivContent?.trim() || "";
//             translated = secondDivContent?.trim() || "";

//             // Filter out elements that aren't actually lyrics
//             // Skip buttons, actions, or very short text that's likely UI elements
//             const isUIElement =
//               original.toLowerCase().includes("add to") ||
//               original.toLowerCase().includes("share") ||
//               translated.toLowerCase().includes("add to") ||
//               translated.toLowerCase().includes("share");

//             // Only add valid lyric pairs
//             if (original && translated && !isUIElement) {
//               lyricsLines.push({ original, translated });
//             }
//           }
//         });
//       });

//       return {
//         lyrics: lyricsLines,
//       };
//     }
//   );

//   return data;
// }

// async function getGoogleSearchFirstResult(query: string) {
//   try {
//     const modifiedQuery = `${query} musixmatch`;
//     const response = await axios.get(
//       `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_NOBILLING_API_KEY_2}&cx=${process.env.SEARCHENGINE_ID_2}&q=${modifiedQuery}&num=10`
//     );

//     const result = response.data.items;

//     return result;
//   } catch (error) {
//     console.log("Error fetching Google search results:", error.response);
//   }
// }

// async function extractLyricsData(parentHandle: any): Promise<LyricsData> {
//   const mainParent = await parentHandle.evaluateHandle((el) => {
//     return el.parentElement.parentElement.parentElement;
//   });

//   const data = await mainParent.evaluate((parent: HTMLElement) => {
//     // Step 1: Find all direct child divs of the parent
//     const allChildDivs = Array.from(parent.children).filter(
//       (el): el is HTMLDivElement => el.tagName === "DIV"
//     );

//     // Step 2: Count class occurrences to find the most common class
//     const classCounter: Record<string, number> = {};
//     allChildDivs.forEach((div) => {
//       if (div.className) {
//         classCounter[div.className] = (classCounter[div.className] || 0) + 1;
//       }
//     });

//     // Step 3: Determine the most common class
//     let mostCommonClass = "";
//     let maxCount = 0;
//     for (const [className, count] of Object.entries(classCounter)) {
//       if (count > maxCount && className.trim() !== "") {
//         mostCommonClass = className;
//         maxCount = count;
//       }
//     }

//     // Step 4: Extract data from divs with the most common class
//     const lyricsData: LyricsSection[] = [];

//     // Get all divs with the most common class in document order
//     const targetDivs = Array.from(parent.children).filter(
//       (el): el is HTMLDivElement =>
//         el.tagName === "DIV" && el.className === mostCommonClass
//     );

//     // Process each lyrics section in sequence
//     targetDivs.forEach((sectionDiv) => {
//       const childDivs = Array.from(sectionDiv.querySelectorAll("div"));

//       if (childDivs.length > 0) {
//         // Extract heading from the first div and convert to uppercase
//         const heading = (childDivs[0].textContent?.trim() || "").toUpperCase();

//         // Create a container for this section's lyrics
//         const sectionLyrics: LyricsLine[] = [];

//         // Process all subsequent divs (skip the heading div)
//         for (let i = 1; i < childDivs.length; i++) {
//           const lyricsDiv = childDivs[i];

//           // Get all text elements in order
//           const textElements: string[] = [];

//           // Use a TreeWalker for more precise in-order text extraction
//           const walker = document.createTreeWalker(
//             lyricsDiv,
//             NodeFilter.SHOW_TEXT,
//             {
//               acceptNode: (node: Text) =>
//                 node.textContent?.trim()
//                   ? NodeFilter.FILTER_ACCEPT
//                   : NodeFilter.FILTER_REJECT,
//             }
//           );

//           // Walk the tree in document order
//           let currentNode: Node | null;
//           while ((currentNode = walker.nextNode())) {
//             const text = currentNode.textContent?.trim() || "";
//             if (text) textElements.push(text);
//           }

//           // If we have at least two text pieces, assume first is original, second is translated
//           if (textElements.length >= 2) {
//             sectionLyrics.push({
//               original: textElements[0],
//               translated: textElements[1],
//             });
//           }
//         }

//         lyricsData.push({
//           heading: heading,
//           lyrics: sectionLyrics,
//         });
//       }
//     });

//     return {
//       lyrics: lyricsData,
//     };
//   });

//   return data;
// }
// async function scrapeLyrisc(req: Request, res: Response) {
//   let context: BrowserContext = null;

//   const timeoutId = setTimeout(() => {
//     if (context) {
//       // context.close();
//       res.status(200).json({
//         status: 200,
//         message: "Lyrisc not found",
//         data: {},
//       });
//     }
//     return;
//   }, globalTimeout);

//   try {
//     const songName = req.params.songName.toLowerCase();
//     const browser = await getBrowser();
//     context = await browser.newContext({
//       viewport: { width: 1280, height: 720 },
//       userAgent:
//         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
//       extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
//     });
//     const page = await context.newPage();

//     const results = await getGoogleSearchFirstResult(songName);

//     // const results = [
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Rights Rishi - Why This Kolaveri Di lyrics | Musixmatch",
//     //     htmlTitle:
//     //       "Rights Rishi - <b>Why This Kolaveri Di</b> lyrics | <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Rights-Rishi/Why-This-Kolaveri-Di",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "Lyrics of Why This Kolaveri Di by Rights Rishi. Yo boys! I am singing song Soup song Flop song Why this kolaveri kolaveri kolaveri di.",
//     //     htmlSnippet:
//     //       "Lyrics of <b>Why This Kolaveri Di</b> by Rights Rishi. Yo boys! I am singing song Soup song Flop song Why this kolaveri kolaveri <b>kolaveri di</b>.",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/Rights-Rishi/Why-This-Kolaveri-Di",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/Rights-Rishi/<b>Why-This-Kolaveri</b>-<b>Di</b>",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title:
//     //       "Anirudh Ravichander, Dhanush - Why This Kolaveri Di? - Musixmatch",
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Dhanush - <b>Why This Kolaveri Di</b>? - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Anirudh-Ravichander/why-this-kolaveri-di-3",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "outro ... The song 'Why This Kolaveri Di?' by Anirudh Ravichander feat. Dhanush humorously expresses the feelings of heartbreak and confusion after a breakup. The ...",
//     //     htmlSnippet:
//     //       "outro ... The song &#39;<b>Why This Kolaveri Di</b>?&#39; by Anirudh Ravichander feat. Dhanush humorously expresses the feelings of heartbreak and confusion after a breakup. The&nbsp;...",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/Anirudh.../why-this-kolaveri-di-3",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/Anirudh.../<b>why-this-kolaveri</b>-<b>di</b>-3",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title:
//     //       "Dhanush, Anirudh Ravichander - Why This Kolaveri Di - Musixmatch",
//     //     htmlTitle:
//     //       "Dhanush, Anirudh Ravichander - <b>Why This Kolaveri Di</b> - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Dhanush-2/Why-This-Kolaveri-Di-The-DJ-Rishabh-House-Mix/translation/hindi",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "Why This Kolaveri Di - The DJ Rishabh House Mix Dhanush Anirudh Ravichander Translation in Hindi Yo boys i am singing song लड़कों में गाना गा रहा हूं",
//     //     htmlSnippet:
//     //       "<b>Why This Kolaveri Di</b> - The DJ Rishabh House Mix Dhanush Anirudh Ravichander Translation in Hindi Yo boys i am singing song लड़कों में गाना गा रहा हूं",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/...2/Why-This-Kolaveri-Di.../hindi",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/...2/<b>Why-This-Kolaveri</b>-<b>Di</b>.../hindi",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title:
//     //       "Dhanush, Anirudh Ravichander - Why This Kolaveri Di - Musixmatch",
//     //     htmlTitle:
//     //       "Dhanush, Anirudh Ravichander - <b>Why This Kolaveri Di</b> - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Dhanush-2/Why-This-Kolaveri-Di-The-DJ-Rishabh-House-Mix/translation/bengali",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "Yo boys i am singing song. Soup song. Soup song. Flop song. ব্যার্থ গান. Why this kolaveri kolaveri kolaveri di. কেনো এই কলাভেরি কলাভেরি কলাভেরিডি. Why this kolaveri kolaveri ...",
//     //     htmlSnippet:
//     //       "Yo boys i am singing song. Soup song. Soup song. Flop song. ব্যার্থ গান. Why this kolaveri kolaveri <b>kolaveri di</b>. কেনো এই কলাভেরি কলাভেরি কলাভেরিডি. Why this kolaveri kolaveri&nbsp;...",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/.../Why-This-Kolaveri-Di.../bengali",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/.../<b>Why-This-Kolaveri</b>-<b>Di</b>.../bengali",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title:
//     //       'Anirudh Ravichander, Dhanush - Why This Kolaveri Di? (From "3 ...',
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Dhanush - <b>Why This Kolaveri Di</b>? (From &quot;3 ...",
//     //     link: "https://www.musixmatch.com/de/songtext/Anirudh-Ravichander-feat-Dhanush-2/Why-This-Kolaveri-Di-From-3-131-132-BPM-2",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "Bist du ein Künstler? Hol das Beste aus deinen Songtexten mit Musixmatch Pro heraus!",
//     //     htmlSnippet:
//     //       "Bist du ein Künstler? Hol das Beste aus deinen Songtexten mit <b>Musixmatch</b> Pro heraus!",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/.../Why-This-Kolaveri-Di-From-3-131-132-...",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/.../<b>Why-This-Kolaveri</b>-<b>Di</b>-From-3-131-132-...",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Anirudh Ravichander, Shruti Haasan, Ajesh - Musixmatch",
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Shruti Haasan, Ajesh - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Anirudh-Ravichander-Shruti-Haasan-Ajesh-Ashok/Tan-Ye-Mera-The-Kiss-of-Love",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "The song 'Tan Ye Mera - The Kiss of Love' by Anirudh Ravichander feat ... 6. Why This Kolaveri Di? - The Soup of Love. Anirudh Ravichander, Dhanush. 7.",
//     //     htmlSnippet:
//     //       "The song &#39;Tan Ye Mera - The Kiss of Love&#39; by Anirudh Ravichander feat ... 6. <b>Why This Kolaveri Di</b>? - The Soup of Love. Anirudh Ravichander, Dhanush. 7.",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/.../Tan-Ye-Mera-The-Kiss-of-Love",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/.../Tan-Ye-Mera-The-Kiss-of-Love",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Anirudh Ravichander, Nadisha Thomas, Mali - Musixmatch",
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Nadisha Thomas, Mali - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/34127832/47593546",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "... 6. Why This Kolaveri Di? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The Rhythm of Love Theme - Theme. Anirudh Ravichander, Flute Navin. 8.",
//     //     htmlSnippet:
//     //       "... 6. <b>Why This Kolaveri Di</b>? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The Rhythm of Love Theme - Theme. Anirudh Ravichander, Flute Navin. 8.",
//     //     formattedUrl: "https://www.musixmatch.com/lyrics/34127832/47593546",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/34127832/47593546",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Anirudh Ravichander, Ajesh - Yedhalo Oka Mounam - Musixmatch",
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Ajesh - Yedhalo Oka Mounam - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/de/songtext/Anirudh-Ravichander-Ajesh/yedhalo-oka-mounam-the-innocence-of-love",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "The song 'Yedhalo Oka Mounam - The Innocence of Love' by Anirudh ... Why This Kolaveri Di? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The ...",
//     //     htmlSnippet:
//     //       "The song &#39;Yedhalo Oka Mounam - The Innocence of Love&#39; by Anirudh ... <b>Why This Kolaveri Di</b>? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The&nbsp;...",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/.../yedhalo-oka-mounam-the-innocence-of-lo...",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/.../yedhalo-oka-mounam-the-innocence-of-lo...",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Anirudh Ravichander, Mohit Chauhan - Po Ve Po - Musixmatch",
//     //     htmlTitle:
//     //       "Anirudh Ravichander, Mohit Chauhan - Po Ve Po - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/53112817/12932671/translation/telugu-romanized",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "The song 'Po Ve Po - The Pain of Love' by Anirudh Ravichander feat ... Why This Kolaveri Di? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The ...",
//     //     htmlSnippet:
//     //       "The song &#39;Po Ve Po - The Pain of Love&#39; by Anirudh Ravichander feat ... <b>Why This Kolaveri Di</b>? - The Soup of Love. Anirudh Ravichander, Dhanush. 7. The&nbsp;...",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/53112817/.../telugu-romanized",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/53112817/.../telugu-romanized",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     //   {
//     //     kind: "customsearch#result",
//     //     title: "Rahat Fateh Ali Khan - Musixmatch",
//     //     htmlTitle: "Rahat Fateh Ali Khan - <b>Musixmatch</b>",
//     //     link: "https://www.musixmatch.com/lyrics/Rahat-Fateh-Ali-Khan/Chaahat-The-Bombay-Bounce-Remix/translation/bengali",
//     //     displayLink: "www.musixmatch.com",
//     //     snippet:
//     //       "The song 'Chaahat' by Rahat Fateh Ali Khan expresses unwavering love and ... Why This Kolaveri Di? (The Tigerstyle Bhangra Mix). Dhanush, Anirudh ...",
//     //     htmlSnippet:
//     //       "The song &#39;Chaahat&#39; by Rahat Fateh Ali Khan expresses unwavering love and ... <b>Why This Kolaveri Di</b>? (The Tigerstyle Bhangra Mix). Dhanush, Anirudh&nbsp;...",
//     //     formattedUrl:
//     //       "https://www.musixmatch.com/lyrics/Rahat-Fateh-Ali-Khan/.../bengali",
//     //     htmlFormattedUrl:
//     //       "https://www.<b>musixmatch</b>.com/lyrics/Rahat-Fateh-Ali-Khan/.../bengali",
//     //     pagemap: {
//     //       cse_thumbnail: [Array],
//     //       metatags: [Array],
//     //       cse_image: [Array],
//     //     },
//     //   },
//     // ];

//     const fuse = new Fuse(results, FuseOptions);
//     const allMatches = fuse.search(songName);

//     // Filter matches to only include those with "musixmatch" in the link
//     const musixmatchMatches = allMatches.filter((match: any) =>
//       match.item.link.toLowerCase().includes("musixmatch")
//     );

//     // Use the first valid match, or return "No lyrics found" if none
//     if (musixmatchMatches.length === 0) {
//       console.log("here 1");
//       res.status(200).json({
//         data: {},
//         message: "No lyrics found",
//       });
//       clearTimeout(timeoutId);
//       return;
//     }

//     const match: any = musixmatchMatches[0].item;
//     await page.goto(match.link, {
//       waitUntil: "networkidle",
//     });
//     await page.addScriptTag({
//       url: "https://unpkg.com/@mozilla/readability/Readability.js",
//     });

//     // ② Now window.Readability is defined
//     const text = await page.evaluate(() => {
//       const docClone = document.cloneNode(true);
//       const article = new (window as any).Readability(docClone).parse();

//       return article?.textContent?.trim() || "";
//     });

//     const currentUrl = page.url();

//     // Ensure the URL ends with /translation/french
//     let modifiedUrl: string;

//     if (currentUrl.match(/\/translation\/.+$/)) {
//       // Replace existing /translation/* with /translation/nepali-romanized
//       modifiedUrl = currentUrl.replace(
//         /\/translation\/.+$/,
//         "/translation/nepali-romanized"
//       );
//     } else {
//       // If no /translation/*, append /translation/nepali-romanized
//       modifiedUrl = currentUrl.endsWith("/")
//         ? `${currentUrl}translation/nepali-romanized`
//         : `${currentUrl}/translation/nepali-romanized`;
//     }

//     await page.goto(modifiedUrl, {
//       waitUntil: "networkidle",
//     });
//     const checkTranslation = page.locator(':has-text("Translation in")');
//     const checkTranslationExists =
//       (await checkTranslation.count()) > 0 ? true : false;
//     if (!checkTranslationExists) {
//       if (currentUrl.match(/\/translation\/.+$/)) {
//         // Replace existing /translation/* with /translation/french
//         modifiedUrl = currentUrl.replace(
//           /\/translation\/.+$/,
//           "/translation/french"
//         );
//       } else {
//         // If no /translation/*, append /translation/french
//         modifiedUrl = currentUrl.endsWith("/")
//           ? `${currentUrl}translation/french`
//           : `${currentUrl}/translation/french`;
//       }
//       await page.goto(modifiedUrl, {
//         waitUntil: "networkidle",
//       });
//       const checkTranslationAgain = page.locator(
//         'text="Translation in French"'
//       );
//       if (!(await checkTranslationAgain.count())) {
//         console.log("here 2");

//         res.status(200).json({
//           data: {},
//           message: "No lyrics found",
//         });
//         clearTimeout(timeoutId);
//         return;
//       }
//     }

//     let lyricsData: any;
//     const isItRap = !/\bverse\b/.test(await page.innerText("body"));

//     const originalLyricsDiv = page.locator('text="Original Lyrics"');

//     if (isItRap) {
//       lyricsData = await getRapLyrics(originalLyricsDiv);
//     } else {
//       lyricsData = await extractLyricsData(originalLyricsDiv);
//     }
//     // console.log(lyricsData);

//     clearTimeout(timeoutId);
//     res.json({
//       status: 200,
//       data: lyricsData,
//       message: "Lyrics scraped successfully",
//     });
//   } catch (error) {
//     clearTimeout(timeoutId);
//     res.status(500).json({ error });
//   } finally {
//     if (context) {
//       try {
//         // await context.close();
//       } catch (error) {
//         console.error("Error closing browser:", error);
//       }
//     }
//   }
// }

// router.get("/scrape-lyrisc/:songName", scrapeLyrisc);
// export default router;

// import express, { Request, Response } from "express";
// import { getBrowser } from "../playright.ts";
// import { BrowserContext, devices } from "playwright";
// import axios from "axios";

// const router = express.Router();

// const globalTimeout = 1000 * 15; // 15 seconds

// async function getGoogleSearchFirstResult(query: string) {
//   try {
//     const modifiedQuery = `${query} lyrics`;
//     const response = await axios.get(
//       "https://www.googleapis.com/customsearch/v1",
//       {
//         params: {
//           key: process.env.GOOGLE_NOBILLING_API_KEY_2,
//           cx: process.env.SEARCHENGINE_ID_2,
//           q: modifiedQuery,
//           num: 10,
//           siteSearch: "youtube.com",
//           siteSearchFilter: "e", // 'e' means exclude
//         },
//       }
//     );
//     const result = response.data.items;

//     return result;
//   } catch (error) {
//     console.log("Error fetching Google search results:", error.response);
//   }
// }

// async function scrapeLyrisc(req: Request, res: Response) {
//   let context: BrowserContext = null;

//   const timeoutId = setTimeout(() => {
//     if (context) {
//       // context.close();
//       res.status(200).json({
//         status: 200,
//         message: "Lyrisc not found",
//         data: {},
//       });
//     }
//     return;
//   }, globalTimeout);
//   let buffer = null;
//   try {
//     const songName = req.params.songName.toLowerCase();
//     const browser = await getBrowser();
//     context = await browser.newContext();
//     const page = await context.newPage();

//     const results = await getGoogleSearchFirstResult(songName);

//     await page.goto(results[0].link, {
//       waitUntil: "domcontentloaded",
//     });
//     const mainElement = page.locator("main").first();
//     const mainElementExists = await mainElement.count();

//     const footerElement = page.locator("footer").first();
//     const footerElementExists = (await footerElement.count()) > 0;
//     const headerElement = page.locator("header").first();
//     const headerElementExists = (await headerElement.count()) > 0;

//     page.evaluate(() => {
//       const allImgElements = document.querySelectorAll("img");
//       allImgElements.forEach((img) => {
//         img.style.display = "none";
//       });
//     });

//     if (footerElementExists) {
//       footerElement.evaluate((el) => {
//         el.style.display = "none";
//       });
//     }
//     if (headerElementExists) {
//       headerElement.evaluate((el) => {
//         el.style.display = "none";
//       });
//     }

//     if (mainElementExists) {
//       buffer = await mainElement.screenshot({});
//     } else {
//       buffer = await page.screenshot({});
//     }

//     res.setHeader("Content-type", "image/png");

//     clearTimeout(timeoutId);
//     res.status(200).end(buffer);
//   } catch (error) {
//     clearTimeout(timeoutId);
//     res.status(500).json({ error });
//   } finally {
//     if (context) {
//       try {
//         await context.close();
//       } catch (error) {
//         console.error("Error closing browser:", error);
//       }
//     }
//   }
// }

// router.get("/scrape-lyrisc/:songName", scrapeLyrisc);
// export default router;
