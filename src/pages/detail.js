import {
  getRecording,
  getRecordingChunks,
  getTranscript,
} from '../storage/database.js';

const recordingId = new URLSearchParams(location.search).get('recordingId');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const playerContainer = document.querySelector('#player');
const transcriptContainer = document.querySelector('#transcript');
let objectUrl;
let player;
let activeWordIndex = -1;
const wordButtons = [];

function markActiveWord(index) {
  if (index === activeWordIndex) return;
  if (activeWordIndex >= 0) {
    wordButtons[activeWordIndex].replaceChildren(wordButtons[activeWordIndex].textContent);
  }
  activeWordIndex = index;
  if (index >= 0) {
    const strong = document.createElement('strong');
    strong.textContent = wordButtons[index].textContent;
    wordButtons[index].replaceChildren(strong);
  }
}

function findCurrentWord(words, currentTime) {
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (currentTime < words[middle].start) high = middle - 1;
    else if (currentTime > words[middle].end) low = middle + 1;
    else return middle;
  }
  return -1;
}

async function loadDetail() {
  if (!recordingId) {
    status.textContent = 'No transcript was selected.';
    return;
  }
  const [recording, transcript, chunks] = await Promise.all([
    getRecording(recordingId),
    getTranscript(recordingId),
    getRecordingChunks(recordingId),
  ]);
  if (!transcript) {
    status.textContent = 'This transcript could not be found.';
    return;
  }
  title.textContent = recording?.title || 'Transcript for a deleted recording';
  status.textContent = '';

  chunks.sort((left, right) => left.part - right.part || left.index - right.index);
  if (recording && chunks.length) {
    const mimeType = chunks[0].blob.type || (recording.mode === 'video' ? 'video/webm' : 'audio/webm');
    objectUrl = URL.createObjectURL(new Blob(chunks.map(({ blob }) => blob), { type: mimeType }));
    player = document.createElement(recording.mode === 'video' ? 'video' : 'audio');
    player.controls = true;
    player.src = objectUrl;
    playerContainer.append(player);
  } else {
    playerContainer.textContent = 'The recording was deleted. The transcript is still available.';
  }

  const paragraph = document.createElement('p');
  for (const [index, word] of transcript.words.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = word.word;
    button.title = `${word.start.toFixed(2)} seconds`;
    button.disabled = !player;
    button.addEventListener('click', () => {
      player.currentTime = word.start;
      player.play().catch(() => {});
      markActiveWord(index);
    });
    wordButtons.push(button);
    paragraph.append(button, ' ');
  }
  transcriptContainer.append(paragraph);
  player?.addEventListener('timeupdate', () => {
    markActiveWord(findCurrentWord(transcript.words, player.currentTime));
  });
}

window.addEventListener('pagehide', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

loadDetail().catch((error) => {
  status.textContent = `Could not open the transcript: ${error.message}`;
});
