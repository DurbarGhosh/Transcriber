const status = document.querySelector('#status');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const timer = document.querySelector('#timer');
let timerInterval;

function showRecordingState(recording, startedAt) {
  startButton.disabled = recording;
  stopButton.disabled = !recording;
  clearInterval(timerInterval);
  if (!recording) {
    timer.textContent = '00:00';
    return;
  }
  const updateTimer = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    timer.textContent = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

async function refreshStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'GET_RECORDING_STATUS',
  });
  showRecordingState(result.recording, result.startedAt);
  if (result.recording) {
    status.textContent = result.tabId === tab.id
      ? 'This tab is recording.'
      : 'Another tab is already recording. Stop it before starting a new recording.';
  }
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
      tab: { id: tab.id, title: tab.title, url: tab.url },
    });
    status.textContent = result.ok
      ? result.alreadyRecording
        ? 'This tab is already recording. Click Stop when finished.'
        : 'Recording. You should still hear the tab.'
      : `Could not start: ${result.error}`;
    if (result.ok) showRecordingState(true, Date.now());
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
    ? 'Recording stopped and saved. Open History to play it.'
    : `Could not stop: ${result.error}`;
  if (result.ok) showRecordingState(false);
});

document.querySelector('#open-spike').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') });
});

document.querySelector('#open-history').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

refreshStatus().catch((error) => {
  status.textContent = `Could not check recording status: ${error.message}`;
});
