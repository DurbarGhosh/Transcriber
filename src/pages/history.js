import {
  deleteExpiredRecordings,
  deleteTranscript,
  discardRecording,
  getRecordingChunks,
  getRecordingParts,
  listRecordings,
  listTranscriptionJobs,
  listTranscripts,
  recoverRecording,
} from '../storage/database.js';
import { userMessage } from '../errors/user-message.js';

const container = document.querySelector('#recordings');
const status = document.querySelector('#status');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search');
const searchResults = document.querySelector('#search-results');
const searchResultList = document.querySelector('#search-result-list');
const storageMeter = document.querySelector('#storage-meter');
const retentionForm = document.querySelector('#retention-form');
const autoDeleteEnabled = document.querySelector('#auto-delete-enabled');
const autoDeleteDays = document.querySelector('#auto-delete-days');
const objectUrls = [];
let recordingsById = new Map();
let transcripts = [];
let jobsById = new Map();

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function refreshStorageMeter() {
  const { usage, quota } = await navigator.storage.estimate();
  storageMeter.textContent = `${formatBytes(usage)} used out of ${formatBytes(quota)} available to this browser profile.`;
}

function formatDuration(duration) {
  const seconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function displayStatus(recordingId) {
  const job = jobsById.get(recordingId);
  if (transcripts.some((item) => item.recordingId === recordingId) && job?.status === 'complete') return 'done';
  if (['queued', 'running'].includes(job?.status)) return 'transcribing';
  return 'recorded';
}

function recordingDetails(recording) {
  return `${new Date(recording.date).toLocaleString()} — ${formatDuration(recording.duration)} — ${recording.mode} — ${displayStatus(recording.id)}`;
}

async function renderRecording(recording) {
  const article = document.createElement('article');
  article.className = 'recording-card';
  const heading = document.createElement('h2');
  heading.textContent = recording.title;
  const details = document.createElement('p');
  details.className = 'meta';
  details.textContent = recordingDetails(recording);
  article.append(heading, details);

  if (recording.status === 'complete') {
    const transcribeButton = document.createElement('button');
    transcribeButton.type = 'button';
    transcribeButton.textContent = 'Transcribe';
    transcribeButton.addEventListener('click', () => {
      location.href = `transcription.html?recordingId=${encodeURIComponent(recording.id)}`;
    });
    article.append(transcribeButton);
  }

  const transcript = transcripts.find((item) => item.recordingId === recording.id);
  if (transcript) {
    const openTranscript = document.createElement('a');
    openTranscript.href = `detail.html?recordingId=${encodeURIComponent(recording.id)}`;
    openTranscript.textContent = 'Open transcript';
    openTranscript.className = 'button-link secondary';
    article.append(' ', openTranscript);
  }

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
    const totalBytes = chunks.reduce((sum, { blob }) => sum + blob.size, 0);
    const size = document.createElement('p');
    size.textContent = `Size: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    article.append(size);
    const mimeType = chunks[0].blob.type || (recording.mode === 'video' ? 'video/webm' : 'audio/webm');
    const url = URL.createObjectURL(new Blob(chunks.map(({ blob }) => blob), { type: mimeType }));
    objectUrls.push(url);
    const player = document.createElement(recording.mode === 'video' ? 'video' : 'audio');
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
    const discardButton = document.createElement('button');
    discardButton.type = 'button';
    discardButton.textContent = 'Discard';
    recoverButton.addEventListener('click', async () => {
      recoverButton.disabled = true;
      try {
        await recoverRecording(recording.id);
        interruptedMessage.textContent = 'Recording recovered.';
        recoverButton.remove();
        discardButton.remove();
      } catch (error) {
        interruptedMessage.textContent = `Could not recover the recording: ${userMessage(error)}`;
        recoverButton.disabled = false;
      }
    });
    discardButton.addEventListener('click', async () => {
      discardButton.disabled = true;
      try {
        await discardRecording(recording.id);
        article.remove();
        recordingsById.delete(recording.id);
        await refreshStorageMeter();
      } catch (error) {
        interruptedMessage.textContent = `Could not discard the recording: ${userMessage(error)}`;
        discardButton.disabled = false;
      }
    });
    article.append(interruptedMessage, recoverButton, discardButton);
  }

  const actions = document.createElement('p');
  actions.className = 'action-row';
  const deleteRecordingButton = document.createElement('button');
  deleteRecordingButton.type = 'button';
  deleteRecordingButton.textContent = 'Delete recording';
  deleteRecordingButton.className = 'danger';
  deleteRecordingButton.addEventListener('click', async () => {
    deleteRecordingButton.disabled = true;
    try {
      await discardRecording(recording.id);
      article.remove();
      recordingsById.delete(recording.id);
      await refreshStorageMeter();
    } catch (error) {
      status.textContent = `Could not delete the recording: ${userMessage(error)}`;
      deleteRecordingButton.disabled = false;
    }
  });
  actions.append(deleteRecordingButton);

  if (transcript) {
    const deleteTranscriptButton = document.createElement('button');
    deleteTranscriptButton.type = 'button';
    deleteTranscriptButton.textContent = 'Delete transcript';
    deleteTranscriptButton.className = 'danger';
    deleteTranscriptButton.addEventListener('click', async () => {
      deleteTranscriptButton.disabled = true;
      try {
        await deleteTranscript(recording.id);
        transcripts = transcripts.filter((item) => item.recordingId !== recording.id);
        jobsById.delete(recording.id);
        deleteTranscriptButton.remove();
        article.querySelector('a[href^="detail.html"]')?.remove();
        details.textContent = recordingDetails(recording);
      } catch (error) {
        status.textContent = `Could not delete the transcript: ${userMessage(error)}`;
        deleteTranscriptButton.disabled = false;
      }
    });
    actions.append(' ', deleteTranscriptButton);
  }
  article.append(actions);
  container.append(article);
}

function renderTranscriptOnly(transcript) {
  const article = document.createElement('article');
  article.className = 'recording-card';
  const heading = document.createElement('h2');
  heading.textContent = transcript.recordingTitle || 'Transcript from a deleted recording';
  const details = document.createElement('p');
  details.className = 'meta';
  const date = transcript.recordingDate || transcript.created;
  details.textContent = `${date ? new Date(date).toLocaleString() : 'Date unavailable'} — transcript only`;
  const actions = document.createElement('p');
  actions.className = 'action-row';
  const openTranscript = document.createElement('a');
  openTranscript.href = `detail.html?recordingId=${encodeURIComponent(transcript.recordingId)}`;
  openTranscript.textContent = 'Open transcript';
  openTranscript.className = 'button-link secondary';
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = 'Delete transcript';
  deleteButton.className = 'danger';
  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true;
    try {
      await deleteTranscript(transcript.recordingId);
      transcripts = transcripts.filter((item) => item.recordingId !== transcript.recordingId);
      jobsById.delete(transcript.recordingId);
      article.remove();
    } catch (error) {
      status.textContent = `Could not delete the transcript: ${userMessage(error)}`;
      deleteButton.disabled = false;
    }
  });
  actions.append(openTranscript, deleteButton);
  article.append(heading, details, actions);
  container.append(article);
}

function runSearch() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  searchResults.hidden = false;
  searchResultList.replaceChildren();
  if (!query) {
    searchResultList.textContent = 'Enter a word or phrase to search.';
    return;
  }
  const matches = transcripts.filter(({ words }) => (
    words.map(({ word }) => word).join(' ').toLocaleLowerCase().includes(query)
  ));
  if (!matches.length) {
    searchResultList.textContent = 'No matching transcripts found.';
    return;
  }
  for (const transcript of matches) {
    const recording = recordingsById.get(transcript.recordingId);
    const result = document.createElement('p');
    const link = document.createElement('a');
    link.href = `detail.html?recordingId=${encodeURIComponent(transcript.recordingId)}`;
    link.textContent = recording?.title || transcript.recordingTitle || 'Transcript for a deleted recording';
    result.append(link);
    searchResultList.append(result);
  }
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
  const { autoDeleteDays: savedAutoDeleteDays } = await chrome.storage.local.get({ autoDeleteDays: 0 });
  const retentionDays = Number(savedAutoDeleteDays);
  autoDeleteEnabled.checked = retentionDays > 0;
  autoDeleteDays.disabled = retentionDays <= 0;
  if (retentionDays > 0) autoDeleteDays.value = String(retentionDays);
  const deletedCount = await deleteExpiredRecordings(retentionDays);
  if (deletedCount > 0) status.textContent = `Automatically deleted ${deletedCount} old recording${deletedCount === 1 ? '' : 's'}. Transcripts were kept.`;

  const [recordings, storedTranscripts, jobs] = await Promise.all([
    listRecordings(),
    listTranscripts(),
    listTranscriptionJobs(),
  ]);
  recordingsById = new Map(recordings.map((recording) => [recording.id, recording]));
  transcripts = storedTranscripts;
  jobsById = new Map(jobs.map((job) => [job.recordingId, job]));
  const hasStatusMessage = status.textContent !== 'Loading recordings…';
  if (recordings.length === 0 && transcripts.length === 0 && !hasStatusMessage) {
    status.textContent = 'No recordings yet.';
  } else if (!hasStatusMessage) {
    status.textContent = '';
  }
  for (const recording of recordings) await renderRecording(recording);
  for (const transcript of transcripts) {
    if (!recordingsById.has(transcript.recordingId)) renderTranscriptOnly(transcript);
  }
  await refreshStorageMeter();
}

window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});
autoDeleteEnabled.addEventListener('change', () => {
  autoDeleteDays.disabled = !autoDeleteEnabled.checked;
});
retentionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const days = autoDeleteEnabled.checked ? Number(autoDeleteDays.value) : 0;
  if (autoDeleteEnabled.checked && (!Number.isInteger(days) || days < 1)) {
    status.textContent = 'Enter a whole number of days greater than zero.';
    return;
  }
  try {
    await chrome.storage.local.set({ autoDeleteDays: days });
    location.reload();
  } catch (error) {
    status.textContent = `Could not save the setting: ${userMessage(error)}`;
  }
});
loadHistory().catch((error) => {
  status.textContent = `Could not load recording history: ${userMessage(error)}`;
});
