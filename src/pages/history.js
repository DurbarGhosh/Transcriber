import {
  discardRecording,
  getRecordingChunks,
  getRecordingParts,
  listRecordings,
  recoverRecording,
} from '../storage/database.js';

const container = document.querySelector('#recordings');
const status = document.querySelector('#status');
const objectUrls = [];

function formatDuration(duration) {
  const seconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

async function renderRecording(recording) {
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = recording.title;
  const details = document.createElement('p');
  details.textContent = `${new Date(recording.date).toLocaleString()} — ${formatDuration(recording.duration)}`;
  article.append(heading, details);

  const parts = await getRecordingParts(recording.id);
  parts.sort((left, right) => left.part - right.part);
  if (parts.length > 1) {
    const partDetails = document.createElement('p');
    partDetails.textContent = `Parts: ${parts.map(({ offset }) => `${offset} seconds`).join(', ')}`;
    article.append(partDetails);
  }

  const chunks = await getRecordingChunks(recording.id);
  chunks.sort((left, right) => left.part - right.part || left.index - right.index);
  if (chunks.length > 0) {
    const mimeType = chunks[0].blob.type || 'audio/webm';
    const url = URL.createObjectURL(new Blob(chunks.map(({ blob }) => blob), { type: mimeType }));
    objectUrls.push(url);
    const player = document.createElement('audio');
    player.controls = true;
    player.src = url;
    article.append(player);
  } else {
    const message = document.createElement('p');
    message.textContent = 'No saved audio chunks were found.';
    article.append(message);
  }

  if (recording.status === 'interrupted') {
    const interruptedMessage = document.createElement('p');
    interruptedMessage.textContent = 'This recording was interrupted.';
    const recoverButton = document.createElement('button');
    recoverButton.type = 'button';
    recoverButton.textContent = 'Recover';
    recoverButton.addEventListener('click', async () => {
      recoverButton.disabled = true;
      try {
        await recoverRecording(recording.id);
        interruptedMessage.textContent = 'Recording recovered.';
        recoverButton.remove();
        discardButton.remove();
      } catch (error) {
        interruptedMessage.textContent = `Could not recover the recording: ${error.message}`;
        recoverButton.disabled = false;
      }
    });
    const discardButton = document.createElement('button');
    discardButton.type = 'button';
    discardButton.textContent = 'Discard';
    discardButton.addEventListener('click', async () => {
      discardButton.disabled = true;
      try {
        await discardRecording(recording.id);
        const playerUrl = article.querySelector('audio')?.src;
        if (playerUrl) URL.revokeObjectURL(playerUrl);
        article.remove();
      } catch (error) {
        interruptedMessage.textContent = `Could not discard the recording: ${error.message}`;
        discardButton.disabled = false;
      }
    });
    article.append(interruptedMessage, recoverButton, discardButton);
  }
  container.append(article);
}

async function loadHistory() {
  const testMinutes = new URLSearchParams(location.search).get('rolloverMinutes');
  if (testMinutes === '1') {
    await chrome.storage.local.set({ rolloverMinutes: 1 });
    status.textContent = 'One-minute rollover test setting is active.';
  } else if (testMinutes === '30') {
    await chrome.storage.local.set({ rolloverMinutes: 30 });
    status.textContent = 'Rollover setting reset to 30 minutes.';
  }
  const recordings = await listRecordings();
  if (recordings.length === 0 && !status.textContent.includes('setting')) {
    status.textContent = 'No recordings yet.';
  } else if (!status.textContent.includes('setting')) {
    status.textContent = '';
  }
  for (const recording of recordings) await renderRecording(recording);
}

window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
loadHistory().catch((error) => {
  status.textContent = `Could not load recording history: ${error.message}`;
});
