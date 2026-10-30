import { createRecording, finishRecording, saveChunk } from '../storage/database.js';

let audioContext;
let capturedStream;
let mediaRecorder;
let recordingTabId;
let recordingId;
let recordingStartedAt;
let pendingChunkWrites = [];
let stopPromise;
let partDurationSeconds = 30 * 60;
let currentPart = 0;
let currentPartOffset = 0;
let nextTimedPartOffset;
let resolutionCheckInterval;
let partCheckInterval;
let recorderMimeType;
let rolloverPromise;
let finalizing = false;

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

function startPartRecorder() {
  const part = currentPart;
  const offset = currentPartOffset;
  let partChunkIndex = 0;
  mediaRecorder = new MediaRecorder(capturedStream, { mimeType: recorderMimeType });
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) return;
    const elapsedSeconds = (Date.now() - recordingStartedAt) / 1000;
    const write = saveChunk({
      recordingId,
      part,
      index: partChunkIndex,
      blob: event.data,
    }, offset, elapsedSeconds);
    partChunkIndex += 1;
    pendingChunkWrites.push(write);
  });
  mediaRecorder.start(5000);
}

function rolloverPart(offset) {
  if (rolloverPromise || finalizing || mediaRecorder?.state !== 'recording') {
    return rolloverPromise;
  }
  const previousRecorder = mediaRecorder;
  rolloverPromise = new Promise((resolve, reject) => {
    previousRecorder.addEventListener('stop', () => {
      try {
        currentPart += 1;
        currentPartOffset = offset;
        startPartRecorder();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    previousRecorder.stop();
  }).finally(() => {
    rolloverPromise = undefined;
  });
  return rolloverPromise;
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

    recorderMimeType = chooseMimeType(mode);
    recordingId = crypto.randomUUID();
    recordingTabId = tab.id;
    recordingStartedAt = Date.now();
    pendingChunkWrites = [];
    stopPromise = undefined;
    rolloverPromise = undefined;
    finalizing = false;
    partDurationSeconds = rolloverMinutes * 60;
    currentPart = 0;
    currentPartOffset = 0;
    nextTimedPartOffset = partDurationSeconds;

    await createRecording({
      id: recordingId,
      title: tab.title || 'Untitled tab',
      url: tab.url || '',
      date: new Date(recordingStartedAt).toISOString(),
      mode,
      status: 'recording',
      duration: 0,
    });

    startPartRecorder();
    capturedStream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (recordingId) stopRecording().catch(() => {});
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
          rolloverPart((Date.now() - recordingStartedAt) / 1000)?.catch(() => {});
        }
      }, 1000);
    }
    partCheckInterval = setInterval(() => {
      const elapsedSeconds = (Date.now() - recordingStartedAt) / 1000;
      if (elapsedSeconds >= nextTimedPartOffset) {
        const offset = nextTimedPartOffset;
        nextTimedPartOffset += partDurationSeconds;
        rolloverPart(offset)?.catch(() => {});
      }
    }, 1000);
  } catch (error) {
    clearInterval(resolutionCheckInterval);
    clearInterval(partCheckInterval);
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

async function stopRecording() {
  if (stopPromise) return stopPromise;

  if (rolloverPromise) await rolloverPromise;

  stopPromise = new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      reject(new Error('No recording is running.'));
      return;
    }

    finalizing = true;
    mediaRecorder.addEventListener('stop', async () => {
      try {
        await Promise.all(pendingChunkWrites);
        const duration = (Date.now() - recordingStartedAt) / 1000;
        await finishRecording(recordingId, duration);
        clearInterval(resolutionCheckInterval);
        clearInterval(partCheckInterval);
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
      recording: Boolean(recordingId) && !finalizing,
      tabId: recordingTabId,
      startedAt: recordingStartedAt,
    });
    return false;
  }

  return false;
});
