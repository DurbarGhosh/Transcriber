import { env, pipeline } from '@huggingface/transformers';
import { NonRealTimeVAD } from '@ricky0123/vad-web';
import { modelErrorMessage } from '../errors/user-message.js';

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
  let fallbackMessage = hasWebGpu ? '' : 'WebGPU is unavailable. Using the slower WASM fallback.';
  const makePipeline = () => pipeline('automatic-speech-recognition', model, {
    device,
    progress_callback: (item) => {
      if (item.status === 'progress' && Number.isFinite(item.progress)) {
        sendStatus(`Downloading model: ${item.progress.toFixed(1)}%`);
      }
    },
  });
  sendStatus(fallbackMessage || `Loading Whisper on ${device}…`);
  try {
    transcriber = await makePipeline();
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    fallbackMessage = 'WebGPU could not start. Using the slower WASM fallback.';
    sendStatus(fallbackMessage);
    transcriber = await makePipeline();
  }
  loadedLanguage = language;
}

function hasAudibleSignal(audio) {
  const blockSize = 1600; // 100 ms at 16 kHz.
  let audibleBlocks = 0;
  for (let blockStart = 0; blockStart < audio.length; blockStart += blockSize) {
    const blockEnd = Math.min(audio.length, blockStart + blockSize);
    let squareSum = 0;
    for (let index = blockStart; index < blockEnd; index += 1) {
      squareSum += audio[index] * audio[index];
    }
    const rms = Math.sqrt(squareSum / Math.max(1, blockEnd - blockStart));
    if (rms >= 0.002) audibleBlocks += 1;
    // Require sustained sound so a click or codec artifact does not send a
    // genuinely silent window to Whisper, where it could invent words.
    if (audibleBlocks >= 5) return true;
  }
  return false;
}

async function transcribeWindow(audio, windowStart, language, hasWebGpu) {
  await load(language, hasWebGpu);
  let speechFound = false;
  const speechSections = [];
  for await (const speech of vad.run(audio, 16000)) {
    speechFound = true;
    speechSections.push({ audio: speech.audio, start: speech.start / 1000 });
  }
  if (!speechFound && hasAudibleSignal(audio)) {
    // Some media (especially quiet or processed voices after a pause) can be
    // rejected by VAD even though the window is plainly audible.
    speechSections.push({ audio, start: 0 });
  }
  for (const speech of speechSections) {
    const speechStart = windowStart + speech.start;
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
    .catch((error) => self.postMessage({ type: 'ERROR', error: modelErrorMessage(error) }));
});
