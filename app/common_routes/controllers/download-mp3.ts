//videodetails.title
import express, { Request, Response } from "express";
import ytdl from "@distube/ytdl-core";

import { spawn } from "child_process";
import { v4 } from "uuid";

const router = express.Router();

// async function getAudioBuffer(url: string): Promise<Buffer> {
//   console.log(`[yt-dlp] Starting audio download for: ${url}`);

//   return new Promise((resolve, reject) => {
//     const chunks: Buffer[] = [];

//     // Command arguments for yt-dlp
//     const args = [
//       url,
//       "-f",
//       "bestaudio", // Format: best audio available
//       "--no-warnings", // Suppress warnings
//       "-x", // Extract audio only
//       "--audio-format",
//       "mp3", // Convert to MP3

//       "-o",
//       "-", // Output to stdout
//     ];

//     // Spawn the yt-dlp process
//     const ytdlpProcess = spawn("yt-dlp", args, {
//       stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout and stderr piped
//     });

//     let streamStarted = false;
//     let stderrOutput = "";

//     // Set up timeout
//     const timeout = setTimeout(() => {
//       console.error(
//         "[yt-dlp] Error: Stream timeout - no data received in 15 seconds."
//       );
//       ytdlpProcess.kill("SIGTERM");
//       reject(new Error("yt-dlp stream timeout - no data received"));
//     }, 15000);

//     // Handle stdout (the actual audio data)
//     ytdlpProcess.stdout.on("data", (chunk: Buffer) => {
//       if (!streamStarted) {
//         streamStarted = true;
//         clearTimeout(timeout);
//         console.log("[yt-dlp] Stream started, first chunk received.");
//       }
//       chunks.push(chunk);
//     });

//     ytdlpProcess.stdout.on("end", () => {
//       clearTimeout(timeout);
//       console.log(`[yt-dlp] Stream ended, total chunks: ${chunks.length}`);

//       if (chunks.length === 0) {
//         return reject(
//           new Error(
//             `Stream ended but no data was received. Error: ${stderrOutput}`
//           )
//         );
//       }

//       resolve(Buffer.concat(chunks));
//     });

//     ytdlpProcess.stdout.on("error", (err) => {
//       clearTimeout(timeout);
//       console.error("[yt-dlp] Stdout error:", err);
//       reject(err);
//     });

//     // Handle stderr (error messages and progress info)
//     ytdlpProcess.stderr.on("data", (chunk: Buffer) => {
//       stderrOutput += chunk.toString();
//       // You can also log progress here if needed
//       // console.log("[yt-dlp] Progress:", chunk.toString().trim());
//     });

//     ytdlpProcess.stderr.on("error", (err) => {
//       console.error("[yt-dlp] Stderr error:", err);
//     });

//     // Handle process exit
//     ytdlpProcess.on("close", (code) => {
//       clearTimeout(timeout);

//       if (code !== 0) {
//         console.error(`[yt-dlp] Process exited with code ${code}`);
//         console.error(`[yt-dlp] Error output: ${stderrOutput}`);
//         reject(
//           new Error(`yt-dlp failed with exit code ${code}: ${stderrOutput}`)
//         );
//       }

//       // If code is 0 but we have no data, something went wrong
//       if (code === 0 && chunks.length === 0) {
//         reject(
//           new Error(
//             `yt-dlp succeeded but no audio data received: ${stderrOutput}`
//           )
//         );
//       }
//     });

//     // Handle process errors (e.g., binary not found)
//     ytdlpProcess.on("error", (err) => {
//       clearTimeout(timeout);
//       console.error("[yt-dlp] Process error:", err);

//       if (err.message.includes("ENOENT")) {
//         reject(
//           new Error(
//             "yt-dlp binary not found. Make sure it's installed and in your PATH."
//           )
//         );
//       } else {
//         reject(err);
//       }
//     });
//   });
// }

// async function getAudioBufferMain(url: string): Promise<Buffer> {
//   return new Promise((resolve, reject) => {
//     const chunks = [];
//     let streamStarted = false;

//     // Add timeout
//     const timeout = setTimeout(() => {
//       if (!streamStarted) {
//         reject(new Error("ytdl stream timeout - no data received"));
//       }
//     }, 15000); // 15 seconds timeout

//     const audioStream = ytdl(url, {
//       filter: "audioonly",
//       quality: "highestaudio",
//       requestOptions: {
//         headers: {
//           "User-Agent":
//             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
//         },
//       },
//     });

//     audioStream
//       .on("data", (chunk) => {
//         if (!streamStarted) {
//           streamStarted = true;
//           clearTimeout(timeout);
//           console.log("ytdl stream started, first chunk received");
//         }
//         chunks.push(chunk);
//       })
//       .on("end", () => {
//         clearTimeout(timeout);
//         console.log(`ytdl stream ended, total chunks: ${chunks.length}`);
//         resolve(Buffer.concat(chunks));
//       })
//       .on("error", (err) => {
//         clearTimeout(timeout);
//         console.error("ytdl stream error:", err);
//         reject(err);
//       });
//   });
// }

function extractVideoId(url) {
  const match = url.match(/v=([^&]+)/);
  return match ? match[1] : null;
}

// Function to get audio buffer from a single URL
async function fetchAudioBuffer(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn("yt-dlp", [
      "-o",
      "-", // Output to stdout
      "--format",
      "bestaudio/best", // Get highest quality audio
      url,
    ]);

    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (data) => console.error(`Error: ${data}`));
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`yt-dlp failed with code ${code}`));
    });
  });
}

// Main function to get audio buffer from multiple sources
async function getAudioBuffer(url): Promise<any> {
  const videoId = extractVideoId(url);
  const sources = [
    // { name: "YouTube", url },
    {
      name: "Invidious1",
      url: `https://invidious.snopyta.org/watch?v=${videoId}`,
    },
    {
      name: "Invidious2",
      url: `https://invidious.kavin.rocks/watch?v=${videoId}`,
    },
    { name: "Piped1", url: `https://piped.kavin.rocks/watch?v=${videoId}` },
    { name: "Piped2", url: `https://piped.video/watch?v=${videoId}` },
  ];

  for (const source of sources) {
    console.log(`Trying ${source.name}: ${source.url}`);
    // Skip YouTube if videoId is not present

    if (source.name !== "YouTube" && !videoId) continue;
    console.log(`Trying ${source.name}: ${source.url}`);
    try {
      // const buffer = await fetchAudioBuffer(source.url);
      const buffer = await fetchAudioBuffer(source.url);
      console.log(`Success with ${source.name}`);
      return buffer;
    } catch (error) {
      console.error(`${source.name} failed: ${error.message}`);
    }
  }
  throw new Error("All sources failed to retrieve audio buffer");
}
function convertToWav(audioBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 1. spawn ffmpeg, reading from stdin (pipe:0) and writing WAV to stdout (pipe:1)
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      "pipe:0", // input = our stdin
      "-f",
      "wav", // output container = WAV
      "-acodec",
      "pcm_s16le", // codec = 16-bit PCM
      "-ar",
      "44100", // sampling rate = 44.1 kHz
      "-ac",
      "2", // channels = stereo
      "pipe:1", // output = stdout
    ]);

    const wavChunks: Buffer[] = [];

    // 2. collect every chunk ffmpeg writes to stdout
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      wavChunks.push(chunk);
    });

    // 3. watch for errors
    ffmpeg.on("error", reject);
    ffmpeg.stderr.on("data", (data) => {
      // ffmpeg logs progress/errors here; you can log if you like
      // console.error("ffmpeg stderr:", data.toString());
    });

    // 4. when ffmpeg finishes, concat and resolve
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}`));
      }
      resolve(Buffer.concat(wavChunks));
    });

    // 5. finally, feed your raw audio into ffmpeg's stdin
    ffmpeg.stdin.write(audioBuffer);
    ffmpeg.stdin.end();
  });
}

async function getMp3(req: Request, res: Response) {
  try {
    const { url } = req.params;
    console.log("fired");

    if (!url || !ytdl.validateURL(url)) {
      res.status(400).json({
        success: false,
        message: "URL is required",
      });
    }
    const audioBuffer = await getAudioBuffer(url);
    const wavBuffer = await convertToWav(audioBuffer);
    const base64Data = wavBuffer.toString("base64");

    // const audioInfo = await ytdl.getBasicInfo(url);
    // const {
    //   title,
    //   author: { name },
    // } = audioInfo.videoDetails;
    const {
      title,
      author: { name },
    } = { title: "Sample Title", author: { name: "Sample Author" } };

    // Send the buffer directly
    res
      .status(200)
      .send({ title, author: name, base64Buffer: base64Data, id: v4() });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error downloading audio",
    });
  }
}

// Routes
router.get("/download-mp3/:url", getMp3);

export default router;
