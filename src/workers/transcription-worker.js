import { env, pipeline } from '@huggingface/transformers';

// Runtime code stays inside the extension. Model weights are the only files
// fetched remotely and the browser cache avoids downloading them again.
env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/wasm/`;
env.useBrowserCache = true;

async function makeTranscriber(device) {
  self.postMessage({ type: 'STATUS', text: `Loading Whisper base on ${device}. The first model download can take several minutes…` });
  return pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
    device,
    progress_callback: (item) => {
      if (item.status === 'progress' && Number.isFinite(item.progress)) {
        self.postMessage({ type: 'STATUS', text: `Downloading model: ${item.progress.toFixed(1)}%` });
      }
    },
  });
}

self.addEventListener('message', async (event) => {
  const { audio, hasWebGpu } = event.data;
  let selectedDevice = hasWebGpu ? 'webgpu' : 'wasm';
  const startedAt = performance.now();

  try {
    let transcriber;
    try {
      transcriber = await makeTranscriber(selectedDevice);
    } catch (error) {
      if (selectedDevice !== 'webgpu') throw error;
      selectedDevice = 'wasm';
      self.postMessage({ type: 'STATUS', text: 'WebGPU could not start. Falling back to WASM…' });
      transcriber = await makeTranscriber(selectedDevice);
    }

    self.postMessage({ type: 'STATUS', text: `Transcribing with ${selectedDevice}…` });
    const result = await transcriber(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const timestampedWords = (result.chunks ?? [])
      .filter((chunk) => chunk.timestamp?.every(Number.isFinite))
      .map((chunk) => ({
        word: chunk.text.trim(),
        start: chunk.timestamp[0],
        end: chunk.timestamp[1],
      }))
      .filter(({ word }) => word.length > 0);
    self.postMessage({
      type: 'DONE',
      device: selectedDevice,
      seconds: (performance.now() - startedAt) / 1000,
      words: timestampedWords,
    });
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error.message });
  }
});
