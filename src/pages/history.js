import { getRecordingChunks, listRecordings } from '../storage/database.js';

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
  container.append(article);
}

async function loadHistory() {
  const recordings = await listRecordings();
  status.textContent = recordings.length === 0 ? 'No recordings yet.' : '';
  for (const recording of recordings) await renderRecording(recording);
}

window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
loadHistory().catch((error) => {
  status.textContent = `Could not load recording history: ${error.message}`;
});
