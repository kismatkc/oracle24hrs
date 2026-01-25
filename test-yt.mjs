import { Innertube } from 'youtubei.js';

const yt = await Innertube.create({ generate_session_locally: true });

const videoId = 'dQw4w9WgXcQ';
console.log('Testing video:', videoId);

const info = await yt.getInfo(videoId);
console.log('Has streaming_data:', !!info.streaming_data);

if (info.streaming_data) {
  console.log('Adaptive formats:', info.streaming_data.adaptive_formats?.length);
  
  const audioFormats = info.streaming_data.adaptive_formats?.filter(f => f.has_audio && !f.has_video) || [];
  console.log('Audio formats:', audioFormats.length);
  
  if (audioFormats.length > 0) {
    const format = audioFormats[0];
    console.log('Format has decipher:', typeof format.decipher);
    
    if (format.decipher) {
      const url = await format.decipher(yt.session.player);
      console.log('Got URL:', url?.substring(0, 100) + '...');
    }
  }
}
