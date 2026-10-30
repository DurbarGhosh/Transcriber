import { openDB } from 'idb';

const DATABASE_NAME = 'tab-recorder';
const DATABASE_VERSION = 1;

const databasePromise = openDB(DATABASE_NAME, DATABASE_VERSION, {
  upgrade(database) {
    const recordings = database.createObjectStore('recordings', { keyPath: 'id' });
    recordings.createIndex('date', 'date');

    const chunks = database.createObjectStore('chunks', {
      keyPath: ['recordingId', 'part', 'index'],
    });
    chunks.createIndex('recordingId', 'recordingId');
  },
});

export async function createRecording(recording) {
  const database = await databasePromise;
  await database.add('recordings', recording);
}

export async function saveChunk(chunk) {
  const database = await databasePromise;
  await database.put('chunks', chunk);
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
