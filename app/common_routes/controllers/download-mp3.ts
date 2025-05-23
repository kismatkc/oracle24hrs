//videodetails.title
import express, { Request, Response } from "express";
import ytdl from "@distube/ytdl-core";
import { spawn } from "child_process";
import { buffer } from "stream/consumers";
import { v4 } from "uuid";
const router = express.Router();

// async function getAudioBuffer(url: string) {
//   return new Promise<Buffer>((resolve, reject) => {
//     const chunks: Buffer[] = [];
//     const audioStream = ytdl(url, {
//       filter: "audioonly",
//       quality: "highestaudio",
//     });

//     audioStream
//       .on("data", (chunk: Buffer) => chunks.push(chunk))
//       .on("end", () => resolve(Buffer.concat(chunks)))
//       .on("error", (err: Error) => reject(err));
//   });
// }

async function getAudioBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let streamStarted = false;

    // Add timeout
    const timeout = setTimeout(() => {
      if (!streamStarted) {
        reject(new Error("ytdl stream timeout - no data received"));
      }
    }, 15000); // 15 seconds timeout

    const audioStream = ytdl(url, {
      filter: "audioonly",
      quality: "highestaudio",
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      },
    });

    audioStream
      .on("data", (chunk) => {
        if (!streamStarted) {
          streamStarted = true;
          clearTimeout(timeout);
          console.log("ytdl stream started, first chunk received");
        }
        chunks.push(chunk);
      })
      .on("end", () => {
        clearTimeout(timeout);
        console.log(`ytdl stream ended, total chunks: ${chunks.length}`);
        resolve(Buffer.concat(chunks));
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        console.error("ytdl stream error:", err);
        reject(err);
      });
  });
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

    if (!url || !ytdl.validateURL(url)) {
      res.status(400).json({
        success: false,
        message: "URL is required",
      });
    }
    const audioBuffer = await getAudioBuffer(url);
    const wavBuffer = await convertToWav(audioBuffer);
    const base64Data = wavBuffer.toString("base64");

    const audioInfo = await ytdl.getBasicInfo(url);
    const {
      title,
      author: { name },
    } = audioInfo.videoDetails;

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
