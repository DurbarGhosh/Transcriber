import { openDB } from 'idb';

const DATABASE_NAME = 'tab-recorder';
const DATABASE_VERSION = 3;

const databasePromise = openDB(DATABASE_NAME, DATABASE_VERSION, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) {
      const recordings = database.createObjectStore('recordings', { keyPath: 'id' });
      recordings.createIndex('date', 'date');

      const chunks = database.createObjectStore('chunks', {
        keyPath: ['recordingId', 'part', 'index'],
      });
      chunks.createIndex('recordingId', 'recordingId');
    }
    if (oldVersion < 2) {
      const parts = database.createObjectStore('parts', {
        keyPath: ['recordingId', 'part'],
      });
      parts.createIndex('recordingId', 'recordingId');
    }
    if (oldVersion < 3) {
      const jobs = database.createObjectStore('jobs', { keyPath: 'recordingId' });
      jobs.createIndex('status', 'status');
      database.createObjectStore('transcripts', { keyPath: 'recordingId' });
    }
  },
});

export async function createRecording(recording) {
  const database = await databasePromise;
  await database.add('recordings', recording);
}

export async function saveChunk(chunk, partOffset, duration) {
  const database = await databasePromise;
  const transaction = database.transaction(['chunks', 'parts', 'recordings'], 'readwrite');
  await transaction.objectStore('chunks').put(chunk);
  const partKey = [chunk.recordingId, chunk.part];
  const existingPart = await transaction.objectStore('parts').get(partKey);
  if (!existingPart) {
    await transaction.objectStore('parts').put({
      recordingId: chunk.recordingId,
      part: chunk.part,
      offset: partOffset,
    });
  }
  const recording = await transaction.objectStore('recordings').get(chunk.recordingId);
  if (recording) {
    recording.duration = duration;
    await transaction.objectStore('recordings').put(recording);
  }
  await transaction.done;
}

export async function finishRecording(id, duration) {
  const database = await databasePromise;
  const recording = await database.get('recordings', id);
  if (!recording) throw new Error('The recording could not be found in storage.');
  recording.status = 'complete';
  recording.duration = duration;
  await database.put('recordings', recording);
}

export async function listRecordings() {
  const database = await databasePromise;
  const recordings = await database.getAllFromIndex('recordings', 'date');
  return recordings.reverse();
}

export async function getRecording(id) {
  const database = await databasePromise;
  return database.get('recordings', id);
}

export async function getTranscript(recordingId) {
  const database = await databasePromise;
  return database.get('transcripts', recordingId);
}

export async function listTranscripts() {
  const database = await databasePromise;
  return database.getAll('transcripts');
}

export async function getRecordingChunks(recordingId) {
  const database = await databasePromise;
  return database.getAllFromIndex('chunks', 'recordingId', recordingId);
}

export async function getRecordingParts(recordingId) {
  const database = await databasePromise;
  return database.getAllFromIndex('parts', 'recordingId', recordingId);
}

export async function interruptActiveRecordings() {
  const database = await databasePromise;
  const transaction = database.transaction('recordings', 'readwrite');
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    if (cursor.value.status === 'recording') {
      await cursor.update({ ...cursor.value, status: 'interrupted' });
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function recoverRecording(id) {
  const database = await databasePromise;
  const recording = await database.get('recordings', id);
  if (!recording) throw new Error('The recording could not be found in storage.');
  recording.status = 'complete';
  await database.put('recordings', recording);
}

export async function discardRecording(id) {
  const database = await databasePromise;
  const transaction = database.transaction(['recordings', 'chunks', 'parts'], 'readwrite');
  await transaction.objectStore('recordings').delete(id);

  for (const storeName of ['chunks', 'parts']) {
    const index = transaction.objectStore(storeName).index('recordingId');
    let cursor = await index.openCursor(id);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await transaction.done;
}

export async function deleteTranscript(recordingId) {
  const database = await databasePromise;
  const transaction = database.transaction(['transcripts', 'jobs'], 'readwrite');
  await transaction.objectStore('transcripts').delete(recordingId);
  await transaction.objectStore('jobs').delete(recordingId);
  await transaction.done;
}

export async function queueTranscription(recordingId, language) {
  const database = await databasePromise;
  const transaction = database.transaction(['jobs', 'transcripts'], 'readwrite');
  const existing = await transaction.objectStore('jobs').get(recordingId);
  const restart = !existing || existing.language !== language || existing.status === 'complete';
  if (restart) await transaction.objectStore('transcripts').delete(recordingId);
  await transaction.objectStore('jobs').put({
    recordingId,
    language,
    model: language === 'en' ? 'whisper-base.en' : 'whisper-base',
    status: 'queued',
    progressSeconds: restart ? 0 : existing.progressSeconds,
    totalSeconds: existing?.totalSeconds ?? 0,
    created: existing?.created ?? new Date().toISOString(),
    error: '',
  });
  await transaction.done;
}

export async function resetRunningJobs() {
  const database = await databasePromise;
  const transaction = database.transaction('jobs', 'readwrite');
  let cursor = await transaction.store.index('status').openCursor('running');
  while (cursor) {
    await cursor.update({ ...cursor.value, status: 'queued' });
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function claimNextJob() {
  const database = await databasePromise;
  const transaction = database.transaction('jobs', 'readwrite');
  if (await transaction.store.index('status').count('running')) {
    await transaction.done;
    return undefined;
  }
  const cursor = await transaction.store.index('status').openCursor('queued');
  if (!cursor) {
    await transaction.done;
    return undefined;
  }
  const job = { ...cursor.value, status: 'running' };
  await cursor.update(job);
  await transaction.done;
  return job;
}

export async function listTranscriptionJobs() {
  const database = await databasePromise;
  return database.getAll('jobs');
}

export async function updateTranscriptionJob(recordingId, changes) {
  const database = await databasePromise;
  const job = await database.get('jobs', recordingId);
  if (!job) return;
  await database.put('jobs', { ...job, ...changes });
}

export async function appendTranscriptWords(job, newWords, progressSeconds) {
  const database = await databasePromise;
  const transaction = database.transaction(['transcripts', 'jobs'], 'readwrite');
  const existing = await transaction.objectStore('transcripts').get(job.recordingId);
  const words = existing?.words ?? [];
  for (const candidate of newWords) {
    const duplicate = words.slice(-8).some((word) => (
      word.word.toLowerCase() === candidate.word.toLowerCase()
      && Math.abs(word.start - candidate.start) < 0.8
    ));
    if (!duplicate) words.push(candidate);
  }
  await transaction.objectStore('transcripts').put({
    recordingId: job.recordingId,
    model: job.model,
    language: job.language,
    created: existing?.created ?? new Date().toISOString(),
    words,
  });
  const storedJob = await transaction.objectStore('jobs').get(job.recordingId);
  if (storedJob) {
    storedJob.progressSeconds = progressSeconds;
    await transaction.objectStore('jobs').put(storedJob);
  }
  await transaction.done;
}
