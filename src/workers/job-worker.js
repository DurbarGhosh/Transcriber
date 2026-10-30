import { env, pipeline } from '@huggingface/transformers';
import { NonRealTimeVAD } from '@ricky0123/vad-web';

env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/wasm/`;
env.useBrowserCache = true;

let transcriber;
let loadedLanguage;
let vad;

function sendStatus(text) {
  self.postMessage({ type: 'STATUS', text });
}

async function load(language, hasWebGpu) {
  if (!vad) {
    sendStatus('Loading local speech detector…');
    vad = await NonRealTimeVAD.new({
      modelURL: `${self.location.origin}/vad/silero_vad_legacy.onnx`,
      ortConfig: (ort) => { ort.env.wasm.wasmPaths = `${self.location.origin}/vad/`; },
    });
  }
  if (transcriber && loadedLanguage === language) return;
  const model = language === 'en'
    ? 'onnx-community/whisper-base.en_timestamped'
    : 'onnx-community/whisper-base_timestamped';
  let device = hasWebGpu ? 'webgpu' : 'wasm';
  const makePipeline = () => pipeline('automatic-speech-recognition', model, {
    device,
    progress_callback: (item) => {
      if (item.status === 'progress' && Number.isFinite(item.progress)) {
        sendStatus(`Downloading model: ${item.progress.toFixed(1)}%`);
      }
    },
  });
  sendStatus(`Loading Whisper on ${device}…`);
  try {
    transcriber = await makePipeline();
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    sendStatus('WebGPU could not start. Falling back to WASM…');
    transcriber = await makePipeline();
  }
  loadedLanguage = language;
}

async function transcribeWindow(audio, windowStart, language, hasWebGpu) {
  await load(language, hasWebGpu);
  let speechFound = false;
  for await (const speech of vad.run(audio, 16000)) {
    speechFound = true;
    const speechStart = windowStart + speech.start / 1000;
    const maxSamples = 28 * 16000;
    const overlapSamples = 16000;
    for (let startSample = 0; startSample < speech.audio.length; startSample += maxSamples - overlapSamples) {
      const endSample = Math.min(speech.audio.length, startSample + maxSamples);
      const segment = speech.audio.slice(startSample, endSample);
      const segmentStart = speechStart + startSample / 16000;
      sendStatus(`Transcribing at ${Math.floor(segmentStart / 60)}:${String(Math.floor(segmentStart % 60)).padStart(2, '0')}…`);
      const result = await transcriber(segment, { return_timestamps: 'word' });
      const words = (result.chunks ?? [])
        .filter((chunk) => chunk.timestamp?.every(Number.isFinite))
        .map((chunk) => ({
          word: chunk.text.trim(),
          start: segmentStart + chunk.timestamp[0],
          end: segmentStart + chunk.timestamp[1],
        }))
        .filter(({ word }) => word.length > 0);
      self.postMessage({ type: 'SEGMENT', words });
      if (endSample === speech.audio.length) break;
    }
  }
  self.postMessage({ type: 'WINDOW_DONE', speechFound });
}

self.addEventListener('message', (event) => {
  const { audio, windowStart, language, hasWebGpu } = event.data;
  transcribeWindow(audio, windowStart, language, hasWebGpu)
    .catch((error) => self.postMessage({ type: 'ERROR', error: error.message }));
});
