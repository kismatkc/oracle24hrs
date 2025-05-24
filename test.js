function extractVideoID(url) {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|v\/))([A-Za-z0-9_-]{11})/
  );
  if (!m) throw new Error("Invalid YouTube URL");
  return m[1];
}

// console.log(extractVideoID("https://www.youtube.com/watch?v=mZQH8CPQ-wo"));

const PIPED_BASE = "https://pipedapi.kavin.rocks";

async function fetchAudioStreams1(videoId) {
  const res = await fetch(`${PIPED_BASE}/streams/${videoId}`);
  if (!res.ok) throw new Error("Piped lookup failed");
  const json = await res.json();
  return json.audioStreams; // array of { quality, mimeType, url, … }
}

// console.log(await fetchAudioStreams1("mZQH8CPQ-wo"));

const INV_BASE = "https://yewtu.be/api/v1";
// (or any other public Invidious host)
async function fetchAudioStreams(videoId) {
  const res = await fetch(`${INV_BASE}/videos/${videoId}`);
  const { adaptiveFormats } = await res.json();
  return adaptiveFormats.filter((f) => f.mimeType.startsWith("audio/"));
}

console.log(await fetchAudioStreams("mZQH8CPQ-wo"));

// console.log("hello");
