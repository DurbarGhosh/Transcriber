import { openDB } from 'idb';

const DATABASE_NAME = 'tab-recorder';
const DATABASE_VERSION = 2;

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
