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
let partDurationSeconds = 30 * 60;
let currentPart = 0;
let currentPartOffset = 0;
let nextTimedPartOffset;
let resolutionCheckInterval;
let pendingResolutionOffset;

function chooseMimeType(mode) {
  const candidates = mode === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
    : ['audio/webm;codecs=opus', 'audio/webm'];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error(mode === 'video'
      ? 'This browser does not support VP9 or VP8 video recording.'
      : 'This browser does not support WebM audio recording.');
  }
  return mimeType;
}

async function startRecording(streamId, tab, mode, rolloverMinutes) {
  if (mediaRecorder?.state === 'recording') {
    throw new Error('A recording is already running.');
  }

  try {
    capturedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: mode === 'video' ? {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } : false,
    });

    // Capturing a tab normally mutes it. Routing the captured stream back to the
    // speakers keeps playback audible without mixing microphone audio into it.
    audioContext = new AudioContext();
    audioContext.createMediaStreamSource(capturedStream).connect(audioContext.destination);
    await audioContext.resume();

    const mimeType = chooseMimeType(mode);
    mediaRecorder = new MediaRecorder(capturedStream, { mimeType });
    recordingId = crypto.randomUUID();
    recordingTabId = tab.id;
    recordingStartedAt = Date.now();
    chunkIndex = 0;
    pendingChunkWrites = [];
    stopPromise = undefined;
    partDurationSeconds = rolloverMinutes * 60;
    currentPart = 0;
    currentPartOffset = 0;
    nextTimedPartOffset = partDurationSeconds;
    pendingResolutionOffset = undefined;

    await createRecording({
      id: recordingId,
      title: tab.title || 'Untitled tab',
      url: tab.url || '',
      date: new Date(recordingStartedAt).toISOString(),
      mode,
      status: 'recording',
      duration: 0,
    });

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return;
      const elapsedSeconds = (Date.now() - recordingStartedAt) / 1000;
      while (elapsedSeconds >= nextTimedPartOffset) {
        currentPart += 1;
        currentPartOffset = nextTimedPartOffset;
        nextTimedPartOffset += partDurationSeconds;
      }
      if (pendingResolutionOffset !== undefined) {
        currentPart += 1;
        currentPartOffset = pendingResolutionOffset;
        pendingResolutionOffset = undefined;
      }
      const write = saveChunk({
        recordingId,
        part: currentPart,
        index: chunkIndex,
        blob: event.data,
      }, currentPartOffset, elapsedSeconds);
      chunkIndex += 1;
      pendingChunkWrites.push(write);
    });
    capturedStream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (mediaRecorder?.state === 'recording') stopRecording().catch(() => {});
      }, { once: true });
    });
    const videoTrack = capturedStream.getVideoTracks()[0];
    if (videoTrack) {
      let { width, height } = videoTrack.getSettings();
      resolutionCheckInterval = setInterval(() => {
        const settings = videoTrack.getSettings();
        if (settings.width !== width || settings.height !== height) {
          width = settings.width;
          height = settings.height;
          pendingResolutionOffset = (Date.now() - recordingStartedAt) / 1000;
          mediaRecorder.requestData();
        }
      }, 1000);
    }
    mediaRecorder.start(5000);
  } catch (error) {
    clearInterval(resolutionCheckInterval);
    capturedStream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    capturedStream = undefined;
    mediaRecorder = undefined;
    recordingTabId = undefined;
    recordingId = undefined;
    recordingStartedAt = undefined;
    throw error;
  }
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
        clearInterval(resolutionCheckInterval);
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
    startRecording(message.streamId, message.tab, message.mode, message.rolloverMinutes)
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
