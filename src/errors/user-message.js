export function userMessage(error, fallback = 'Something went wrong.') {
  const raw = error?.message || String(error || '');
  const normalized = `${error?.name || ''} ${raw}`.toLowerCase();
  if (normalized.includes('quota') || normalized.includes('disk') || normalized.includes('storage is full')) {
    return 'Browser storage is full. Delete recordings from History, then try again. Saved transcripts can be kept.';
  }
  if (normalized.includes('codec') || normalized.includes('not supported')) {
    return 'This recording format is not supported by this browser. Update Chrome and try again.';
  }
  return raw || fallback;
}

export function modelErrorMessage(error) {
  const raw = error?.message || String(error || '');
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('fetch')
    || normalized.includes('network')
    || normalized.includes('download')
    || normalized.includes('http')
  ) {
    return 'The Whisper model could not be downloaded. Check your internet connection, then click Retry. Recordings stay on this device.';
  }
  return userMessage(error, 'The transcription model could not start. Click Retry to try again.');
}
