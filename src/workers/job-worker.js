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

function findAudibleGaps(audio, coveredRanges) {
  const blockSize = 1600; // 100 ms at 16 kHz.
  const gaps = [];
  let gapStart;
  let lastAudibleEnd;
  let audibleBlocks = 0;
  const finishGap = () => {
    if (gapStart !== undefined && audibleBlocks >= 5) gaps.push({ start: gapStart, end: lastAudibleEnd });
    gapStart = undefined;
    lastAudibleEnd = undefined;
    audibleBlocks = 0;
  };
  for (let blockStart = 0; blockStart < audio.length; blockStart += blockSize) {
    const blockEnd = Math.min(audio.length, blockStart + blockSize);
    const blockStartSeconds = blockStart / 16000;
    const blockEndSeconds = blockEnd / 16000;
    const covered = coveredRanges.some(({ start, end }) => (
      blockStartSeconds < end && blockEndSeconds > start
    ));
    let squareSum = 0;
    for (let index = blockStart; index < blockEnd; index += 1) {
      squareSum += audio[index] * audio[index];
    }
    const rms = Math.sqrt(squareSum / Math.max(1, blockEnd - blockStart));
    if (!covered && rms >= 0.002) {
      if (gapStart === undefined) gapStart = blockStart;
      lastAudibleEnd = blockEnd;
      audibleBlocks += 1;
    } else if (covered || (lastAudibleEnd !== undefined && blockStart - lastAudibleEnd >= 2 * blockSize)) {
      finishGap();
    }
  }
  finishGap();
  return gaps.map(({ start, end }) => ({
    // A little context helps Whisper recognize the first and last word while
    // the timestamp-based duplicate check removes overlap with VAD sections.
    audio: audio.slice(Math.max(0, start - 4000), Math.min(audio.length, end + 4000)),
    start: Math.max(0, start - 4000) / 16000,
  }));
}

async function transcribeWindow(audio, windowStart, language, hasWebGpu) {
  await load(language, hasWebGpu);
  const speechSections = [];
  const coveredRanges = [];
  for await (const speech of vad.run(audio, 16000)) {
    speechSections.push({ audio: speech.audio, start: speech.start / 1000 });
    coveredRanges.push({ start: speech.start / 1000, end: speech.end / 1000 });
  }
  // VAD can recognize the first speech section but miss a later one after a
  // pause. Check audible gaps even when some speech was already found.
  speechSections.push(...findAudibleGaps(audio, coveredRanges));
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
  self.postMessage({ type: 'WINDOW_DONE', speechFound: speechSections.length > 0 });
}

self.addEventListener('message', (event) => {
  const { audio, windowStart, language, hasWebGpu } = event.data;
  transcribeWindow(audio, windowStart, language, hasWebGpu)
    .catch((error) => self.postMessage({ type: 'ERROR', error: modelErrorMessage(error) }));
});
