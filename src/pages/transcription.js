import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { extractAudioWebm } from '../media/extract-audio.js';
import { userMessage } from '../errors/user-message.js';
import {
  appendTranscriptWords,
  claimNextJob,
  getRecording,
  getRecordingChunks,
  getRecordingPartChunks,
  getRecordingParts,
  listTranscriptionJobs,
  queueTranscription,
  resetRunningJobs,
  replaceRecordingWithAudio,
  discardRecording,
  updateTranscriptionJob,
} from '../storage/database.js';

const status = document.querySelector('#status');
const jobsContainer = document.querySelector('#jobs');
const form = document.querySelector('#queue-form');
const recordingId = new URLSearchParams(location.search).get('recordingId');
let activeWorker;
let activeJob;
let cancelled = false;
let cancelActiveWindow;
let runnerActive = false;

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

async function renderJobs() {
  jobsContainer.replaceChildren();
  for (const job of await listTranscriptionJobs()) {
    const row = document.createElement('div');
    const summary = document.createElement('p');
    summary.textContent = `${job.recordingId} — ${job.status} — ${formatTime(job.progressSeconds || 0)} / ${formatTime(job.totalSeconds || 0)}${job.error ? ` — ${job.error}` : ''}`;
    row.append(summary);
    if (job.status === 'running' || job.status === 'queued') {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', async () => {
        try {
          await updateTranscriptionJob(job.recordingId, { status: 'cancelled' });
          if (activeJob?.recordingId === job.recordingId) {
            cancelled = true;
            activeWorker?.terminate();
            cancelActiveWindow?.();
          }
          await renderJobs();
        } catch (error) {
          status.textContent = `Could not cancel transcription: ${userMessage(error)}`;
        }
      });
      summary.append(' ', cancel);
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', async () => {
        try {
          await updateTranscriptionJob(job.recordingId, { status: 'queued', error: '' });
          await renderJobs();
          startQueueRunner();
        } catch (error) {
          status.textContent = `Could not retry transcription: ${userMessage(error)}`;
        }
      });
      summary.append(' ', retry);
    }
    if (job.status === 'complete' && !job.keepChoice) {
      const recording = await getRecording(job.recordingId);
      if (recording) row.append(makeKeepForm(job, recording));
    }
    jobsContainer.append(row);
  }
}

async function keepAudioOnly(recording) {
  if (recording.mode === 'audio') return;
  const chunks = await getRecordingChunks(recording.id);
  const partNumbers = [...new Set(chunks.map(({ part }) => part))].sort((left, right) => left - right);
  if (!partNumbers.length) throw new Error('No saved video parts were found.');
  const audioParts = [];
  for (const part of partNumbers) {
    status.textContent = `Extracting audio from part ${part + 1}…`;
    const partChunks = chunks
      .filter((chunk) => chunk.part === part)
      .sort((left, right) => left.index - right.index);
    const type = partChunks[0]?.blob.type || 'video/webm';
    const videoBlob = new Blob(partChunks.map(({ blob }) => blob), { type });
    audioParts.push({ part, blob: await extractAudioWebm(videoBlob) });
  }
  await replaceRecordingWithAudio(recording.id, audioParts);
}

function makeKeepForm(job, recording) {
  const formElement = document.createElement('form');
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Transcription finished. What should be kept?';
  fieldset.append(legend);
  const choices = recording.mode === 'video'
    ? [
      ['video', 'Video + transcript'],
      ['audio', 'Audio + transcript'],
      ['transcript', 'Transcript only'],
    ]
    : [
      ['audio', 'Audio + transcript'],
      ['transcript', 'Transcript only'],
    ];
  for (const [value, labelText] of choices) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'keep';
    radio.value = value;
    radio.required = true;
    label.append(radio, ` ${labelText}`);
    fieldset.append(label, ' ');
  }
  const applyButton = document.createElement('button');
  applyButton.type = 'submit';
  applyButton.textContent = 'Apply';
  fieldset.append(applyButton);
  formElement.append(fieldset);
  formElement.addEventListener('submit', async (event) => {
    event.preventDefault();
    applyButton.disabled = true;
    const keepChoice = new FormData(formElement).get('keep');
    try {
      if (keepChoice === 'audio') await keepAudioOnly(recording);
      if (keepChoice === 'transcript') await discardRecording(recording.id);
      await updateTranscriptionJob(job.recordingId, { keepChoice });
      status.textContent = 'Keep choice applied. The transcript is still available in history.';
      await renderJobs();
    } catch (error) {
      status.textContent = `Could not apply the keep choice: ${userMessage(error)}`;
      applyButton.disabled = false;
    }
  });
  return formElement;
}

function resampleBuffers(buffers) {
  const pieces = [];
  let total = 0;
  for (const { buffer } of buffers) {
    const outputLength = Math.round(buffer.duration * 16000);
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(buffer.length - 1, Math.floor(index * buffer.sampleRate / 16000));
      let sample = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        sample += buffer.getChannelData(channel)[sourceIndex];
      }
      output[index] = sample / buffer.numberOfChannels;
    }
    pieces.push(output);
    total += output.length;
  }
  const joined = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return joined;
}

function runWorkerWindow(worker, audio, windowStart, windowEnd, job) {
  return new Promise((resolve, reject) => {
    let saveChain = Promise.resolve();
    const listener = (event) => {
      const message = event.data;
      if (message.type === 'STATUS') status.textContent = message.text;
      if (message.type === 'SEGMENT') {
        const segmentProgress = message.words.at(-1)?.end ?? windowStart;
        saveChain = saveChain.then(() => appendTranscriptWords(job, message.words, segmentProgress));
      }
      if (message.type === 'ERROR') {
        worker.removeEventListener('message', listener);
        cancelActiveWindow = undefined;
        reject(new Error(message.error));
      }
      if (message.type === 'WINDOW_DONE') {
        worker.removeEventListener('message', listener);
        cancelActiveWindow = undefined;
        saveChain
          .then(() => appendTranscriptWords(job, [], windowEnd))
          .then(resolve, reject);
      }
    };
    cancelActiveWindow = () => {
      worker.removeEventListener('message', listener);
      reject(new Error('Transcription cancelled.'));
    };
    worker.addEventListener('message', listener);
    worker.postMessage({
      audio,
      windowStart,
      language: job.language,
      hasWebGpu: 'gpu' in navigator,
    }, [audio.buffer]);
  });
}

async function processJob(job) {
  activeJob = job;
  cancelled = false;
  activeWorker = new Worker(new URL('../workers/job-worker.js', import.meta.url), { type: 'module' });
  const parts = await getRecordingParts(job.recordingId);
  const recording = await getRecording(job.recordingId);
  parts.sort((a, b) => a.part - b.part);
  const totalSeconds = recording?.duration ?? 0;
  await updateTranscriptionJob(job.recordingId, { totalSeconds });
  const timingStartedAt = performance.now();
  const timingProgressStart = job.progressSeconds || 0;

  for (const part of parts) {
    if (cancelled) return;
    const partChunks = await getRecordingPartChunks(job.recordingId, part.part);
    partChunks.sort((a, b) => a.index - b.index);
    if (!partChunks.length) continue;
    const blob = new Blob(partChunks.map(({ blob: chunkBlob }) => chunkBlob), { type: partChunks[0].blob.type });
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('No audio track was found in this recording part. Protected video may have blocked its audio.');
      const duration = await input.computeDuration();
      const sink = new AudioBufferSink(track);
      let windowStart = Math.max(0, (job.progressSeconds || 0) - part.offset);
      while (windowStart < duration && !cancelled) {
        const windowEnd = Math.min(duration, windowStart + 30);
        const buffers = [];
        for await (const wrapped of sink.buffers(windowStart, windowEnd)) buffers.push(wrapped);
        const audio = resampleBuffers(buffers);
        await runWorkerWindow(
          activeWorker,
          audio,
          part.offset + windowStart,
          part.offset + windowEnd,
          job,
        );
        const progress = part.offset + windowEnd;
        const elapsedSeconds = Math.max(1, (performance.now() - timingStartedAt) / 1000);
        const processedSeconds = Math.max(1, progress - timingProgressStart);
        const remainingSeconds = Math.max(0, totalSeconds - progress) * elapsedSeconds / processedSeconds;
        status.textContent = `Processed ${formatTime(progress)}. Estimated time remaining: ${formatTime(remainingSeconds)}.`;
        await renderJobs();
        windowStart = windowEnd < duration ? Math.max(0, windowEnd - 1) : duration;
      }
    } finally {
      input.dispose();
    }
  }
  if (!cancelled) await updateTranscriptionJob(job.recordingId, { status: 'complete', error: '' });
  activeWorker.terminate();
  activeWorker = undefined;
  activeJob = undefined;
}

async function runQueueLoop() {
  while (true) {
    const job = await claimNextJob();
    if (!job) {
      status.textContent = 'No transcription is currently running.';
      await renderJobs();
      return;
    }
    try {
      await processJob(job);
    } catch (error) {
      activeWorker?.terminate();
      if (!cancelled) {
        const message = userMessage(error, 'Transcription failed. Click Retry to try again.');
        await updateTranscriptionJob(job.recordingId, { status: 'failed', error: message });
        status.textContent = `Transcription failed: ${message}`;
      }
    } finally {
      activeJob = undefined;
      activeWorker = undefined;
      await renderJobs();
    }
  }
}

function startQueueRunner() {
  if (runnerActive) return;
  navigator.locks.request('transcription-queue', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      status.textContent = 'The transcription queue is running in another extension tab.';
      return;
    }
    runnerActive = true;
    try {
      await resetRunningJobs();
      await runQueueLoop();
    } finally {
      runnerActive = false;
    }
  }).catch((error) => {
    runnerActive = false;
    status.textContent = `The transcription queue stopped: ${userMessage(error)}`;
  });
}

form.hidden = !recordingId;
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const language = new FormData(form).get('language');
    await queueTranscription(recordingId, language);
    await renderJobs();
    startQueueRunner();
  } catch (error) {
    status.textContent = `Could not add this recording: ${userMessage(error)}`;
  }
});

try {
  await renderJobs();
  startQueueRunner();
} catch (error) {
  status.textContent = `Could not open the transcription queue: ${userMessage(error)}`;
}
