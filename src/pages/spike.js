const device = document.querySelector('#device');
const progress = document.querySelector('#progress');
const words = document.querySelector('#words');
const fileInput = document.querySelector('#audio-file');
const backend = document.querySelector('#backend');
const downloadStatus = document.querySelector('#download-status');

const hasWebGpu = 'gpu' in navigator;
device.textContent = hasWebGpu
  ? 'WebGPU is available. Transcription will try WebGPU first.'
  : 'WebGPU is unavailable. Transcription will use WASM.';

document.querySelector('#download').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_LAST_RECORDING' });
  if (!result?.ok) {
    downloadStatus.textContent = 'No completed recording is available yet.';
    return;
  }
  const link = document.createElement('a');
  link.href = result.url;
  link.download = `tab-recording-${new Date().toISOString().replaceAll(':', '-')}.webm`;
  link.click();
  downloadStatus.textContent = 'Download started.';
});

async function decodeToMono16Khz(file) {
  const sourceContext = new AudioContext();
  const decoded = await sourceContext.decodeAudioData(await file.arrayBuffer());
  const frameCount = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frameCount, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  await sourceContext.close();
  return new Float32Array(rendered.getChannelData(0));
}

document.querySelector('#transcribe').addEventListener('click', async () => {
  const [file] = fileInput.files;
  if (!file) {
    progress.textContent = 'Choose a recording first.';
    return;
  }

  progress.textContent = 'Decoding and resampling to 16 kHz mono…';
  words.textContent = '';
  try {
    const audio = await decodeToMono16Khz(file);
    const worker = new Worker(new URL('../workers/transcription-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'STATUS') progress.textContent = message.text;
      if (message.type === 'DONE') {
        progress.textContent = `Finished with ${message.device} in ${message.seconds.toFixed(1)} seconds.`;
        words.textContent = message.words
          .map(({ word, start, end }) => `${start.toFixed(2)}–${end.toFixed(2)}  ${word}`)
          .join('\n');
        worker.terminate();
      }
      if (message.type === 'ERROR') {
        progress.textContent = `Transcription failed: ${message.error}`;
        worker.terminate();
      }
    });
    worker.postMessage({
      audio,
      hasWebGpu: hasWebGpu && backend.value === 'auto',
    }, [audio.buffer]);
  } catch (error) {
    progress.textContent = `Could not read the file: ${error.message}`;
  }
});
