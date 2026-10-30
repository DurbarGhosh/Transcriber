const status = document.querySelector('#status');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const timer = document.querySelector('#timer');
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
let timerInterval;
let statusInterval;

function showRecordingState(recording, startedAt, orphanedCapture = false) {
  startButton.disabled = recording || orphanedCapture;
  stopButton.disabled = !recording;
  modeInputs.forEach((input) => { input.disabled = recording || orphanedCapture; });
  clearInterval(timerInterval);
  clearInterval(statusInterval);
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
  statusInterval = setInterval(() => refreshStatus().catch(() => {}), 2000);
}

async function refreshStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'GET_RECORDING_STATUS',
  });
  showRecordingState(result.recording, result.startedAt, result.orphanedCapture);
  if (result.recording) {
    status.textContent = result.warning || (result.tabId === tab.id
      ? 'This tab is recording.'
      : 'Another tab is already recording. Stop it before starting a new recording.');
  } else if (result.orphanedCapture) {
    status.textContent = result.capturedTabId === tab.id
      ? 'Chrome still considers this tab captured, but the recorder lost control of it. Close and reopen this tab to release it.'
      : 'Chrome still considers another tab captured, but the recorder lost control of it. Close and reopen that tab to release it.';
  } else if (result.error) {
    status.textContent = `Could not check recording status: ${result.error}`;
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
      mode: document.querySelector('input[name="mode"]:checked').value,
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
  try {
    const result = await chrome.runtime.sendMessage({ target: 'background', type: 'STOP_RECORDING' });
    status.textContent = result.ok
      ? result.warning || 'Recording stopped and saved. Open History to play it.'
      : `Could not stop: ${result.error}`;
    if (result.ok) showRecordingState(false);
  } catch (error) {
    status.textContent = `Could not stop: ${error.message}`;
  }
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
