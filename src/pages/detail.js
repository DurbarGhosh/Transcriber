import {
  getRecording,
  getRecordingChunks,
  getTranscript,
} from '../storage/database.js';
import {
  makeCsv,
  makeJson,
  makeSrt,
  makeTxt,
  makeVtt,
} from '../export/formats.js';

const recordingId = new URLSearchParams(location.search).get('recordingId');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const playerContainer = document.querySelector('#player');
const transcriptContainer = document.querySelector('#transcript');
const exportsContainer = document.querySelector('#exports');
const recordingDownloads = document.querySelector('#recording-downloads');
let objectUrl;
let player;
let activeWordIndex = -1;
const wordButtons = [];

function safeFileName(value) {
  return value.replaceAll(/[^a-z0-9._-]+/gi, '-').replaceAll(/^-|-$/g, '') || 'transcript';
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(contents, fileName, type) {
  downloadBlob(new Blob([contents], { type }), fileName);
}

function recordingPartGroups(chunks) {
  const groups = new Map();
  for (const chunk of chunks) {
    if (!groups.has(chunk.part)) groups.set(chunk.part, []);
    groups.get(chunk.part).push(chunk);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([part, partChunks]) => ({
      part,
      chunks: partChunks.sort((left, right) => left.index - right.index),
    }));
}

function addRecordingDownloads(recording, chunks, fileBase) {
  const groups = recordingPartGroups(chunks);
  if (!recording || !groups.length) return;
  const heading = document.createElement('h3');
  heading.textContent = 'Recording';
  recordingDownloads.append(heading);
  const extension = 'webm';
  const downloadPart = ({ part, chunks: partChunks }) => {
    const type = partChunks[0].blob.type || (recording.mode === 'video' ? 'video/webm' : 'audio/webm');
    downloadBlob(
      new Blob(partChunks.map(({ blob }) => blob), { type }),
      `${fileBase}-part-${part + 1}.${extension}`,
    );
  };
  for (const group of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Download recording part ${group.part + 1}`;
    button.addEventListener('click', () => downloadPart(group));
    recordingDownloads.append(button, ' ');
  }
  if (groups.length > 1) {
    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.textContent = 'Download all recording parts';
    allButton.addEventListener('click', () => groups.forEach(downloadPart));
    recordingDownloads.append(allButton);
  }
}

function prepareExports(recording, transcript, chunks) {
  const fileBase = safeFileName(recording?.title || `transcript-${transcript.recordingId}`);
  const exporters = {
    txt: () => [
      makeTxt(transcript.words, document.querySelector('#txt-timestamps').checked),
      'text/plain;charset=utf-8',
    ],
    json: () => [makeJson(transcript), 'application/json'],
    srt: () => [makeSrt(transcript.words), 'application/x-subrip;charset=utf-8'],
    vtt: () => [makeVtt(transcript.words), 'text/vtt;charset=utf-8'],
    csv: () => [makeCsv(transcript.words), 'text/csv;charset=utf-8'],
  };
  for (const button of exportsContainer.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => {
      const format = button.dataset.export;
      const [contents, type] = exporters[format]();
      downloadText(contents, `${fileBase}.${format}`, type);
    });
  }
  addRecordingDownloads(recording, chunks, fileBase);
  exportsContainer.hidden = false;
}

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
  prepareExports(recording, transcript, chunks);

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
