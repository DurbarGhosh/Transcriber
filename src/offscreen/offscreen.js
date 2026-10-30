let audioContext;
let capturedStream;
let mediaRecorder;
let recordedChunks = [];
let lastRecordingUrl;
let recordingTabId;

async function startRecording(streamId, tabId) {
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

  recordedChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  mediaRecorder = new MediaRecorder(capturedStream, { mimeType });
  recordingTabId = tabId;
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  });
  mediaRecorder.start(1000);
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      reject(new Error('No recording is running.'));
      return;
    }

    mediaRecorder.addEventListener('stop', async () => {
      if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      lastRecordingUrl = URL.createObjectURL(blob);
      capturedStream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
      recordingTabId = undefined;
      resolve({ ok: true, size: blob.size });
    }, { once: true });
    mediaRecorder.stop();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  if (message.type === 'START_RECORDING') {
    startRecording(message.streamId, message.tabId)
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

  if (message.type === 'GET_LAST_RECORDING') {
    sendResponse({ ok: Boolean(lastRecordingUrl), url: lastRecordingUrl });
    return false;
  }

  if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({
      recording: mediaRecorder?.state === 'recording',
      tabId: recordingTabId,
    });
    return false;
  }

  return false;
});
