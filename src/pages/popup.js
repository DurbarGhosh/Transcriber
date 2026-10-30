const status = document.querySelector('#status');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');

function showRecordingState(recording) {
  startButton.disabled = recording;
  stopButton.disabled = !recording;
  if (recording) status.textContent = 'This tab is recording.';
}

async function refreshStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'GET_RECORDING_STATUS',
  });
  showRecordingState(result.recording && result.tabId === tab.id);
}

startButton.addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  status.textContent = 'Starting…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'START_RECORDING',
      tabId: tab.id,
    });
    status.textContent = result.ok
      ? result.alreadyRecording
        ? 'This tab is already recording. Click Stop when finished.'
        : 'Recording. You should still hear the tab.'
      : `Could not start: ${result.error}`;
    if (result.ok) showRecordingState(true);
  } catch (error) {
    status.textContent = `Could not start: ${error.message}`;
  } finally {
    // Keep Start disabled after success; only unlock it when no recording began.
    if (stopButton.disabled) event.currentTarget.disabled = false;
  }
});

stopButton.addEventListener('click', async () => {
  status.textContent = 'Stopping…';
  const result = await chrome.runtime.sendMessage({ target: 'background', type: 'STOP_RECORDING' });
  status.textContent = result.ok
    ? `Recording stopped. Saved ${Math.ceil(result.size / 1024)} KB in memory.`
    : `Could not stop: ${result.error}`;
  if (result.ok) showRecordingState(false);
});

document.querySelector('#open-spike').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') });
});

refreshStatus().catch((error) => {
  status.textContent = `Could not check recording status: ${error.message}`;
});
