import { createRecording, finishRecording, saveChunk } from '../storage/database.js';

let audioContext;
let capturedStream;
let mediaRecorder;
let recordingTabId;
let recordingId;
let recordingStartedAt;
let chunkIndex = 0;
let pendingChunkWrites = [];
let stopPromise;

async function startRecording(streamId, tab) {
  if (mediaRecorder?.state === 'recording') {
    throw new Error('A recording is already running.');
  }

  capturedStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // Capturing a tab normally mutes it. Routing the captured stream back to the
  // speakers keeps playback audible without mixing microphone audio into it.
  audioContext = new AudioContext();
  audioContext.createMediaStreamSource(capturedStream).connect(audioContext.destination);
  await audioContext.resume();

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  mediaRecorder = new MediaRecorder(capturedStream, { mimeType });
  recordingId = crypto.randomUUID();
  recordingTabId = tab.id;
  recordingStartedAt = Date.now();
  chunkIndex = 0;
  pendingChunkWrites = [];
  stopPromise = undefined;

  await createRecording({
    id: recordingId,
    title: tab.title || 'Untitled tab',
    url: tab.url || '',
    date: new Date(recordingStartedAt).toISOString(),
    mode: 'audio',
    status: 'recording',
    duration: 0,
  });

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) return;
    const write = saveChunk({
      recordingId,
      part: 0,
      index: chunkIndex,
      blob: event.data,
    });
    chunkIndex += 1;
    pendingChunkWrites.push(write);
  });
  capturedStream.getTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (mediaRecorder?.state === 'recording') stopRecording().catch(() => {});
    }, { once: true });
  });
  mediaRecorder.start(5000);
}

function stopRecording() {
  if (stopPromise) return stopPromise;

  stopPromise = new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      reject(new Error('No recording is running.'));
      return;
    }

    mediaRecorder.addEventListener('stop', async () => {
      try {
        await Promise.all(pendingChunkWrites);
        const duration = (Date.now() - recordingStartedAt) / 1000;
        await finishRecording(recordingId, duration);
        capturedStream.getTracks().forEach((track) => track.stop());
        await audioContext.close();
        const completedId = recordingId;
        recordingTabId = undefined;
        recordingId = undefined;
        recordingStartedAt = undefined;
        resolve({ ok: true, recordingId: completedId, duration });
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    mediaRecorder.stop();
  });
  return stopPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  if (message.type === 'START_RECORDING') {
    startRecording(message.streamId, message.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    stopRecording()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({
      recording: mediaRecorder?.state === 'recording',
      tabId: recordingTabId,
      startedAt: recordingStartedAt,
    });
    return false;
  }

  return false;
});
