# Testing checklist

Use this checklist after loading the latest `dist/` folder in Chrome.

## Before testing

- [ ] Run `npm run build`.
- [ ] Open `chrome://extensions`.
- [ ] Turn on **Developer mode**.
- [ ] Find **Tab Recorder + Local Transcriber** and click its reload button.
- [ ] Confirm the displayed version matches the latest Git commit.
- [ ] Keep the extension service-worker console open during tests and note any red errors.

## 1. Audio recording and recovery

- [ ] Open a tab playing audible speech.
- [ ] Click the extension icon, choose **Audio only**, then click **Start recording this tab**.
- [ ] Confirm the tab remains audible and the timer advances.
- [ ] Record for at least ten minutes, click **Stop recording**, and open **Recording history**.
- [ ] Confirm the title, date, duration, mode, status, and size appear.
- [ ] Play the recording and confirm the complete recording has sound.
- [ ] Start another recording, close the recorded tab before pressing Stop, then open History.
- [ ] Confirm the saved portion remains playable.

## 2. Crash recovery and recording parts

- [ ] Start a recording, force-quit Chrome while it is recording, then reopen Chrome.
- [ ] Open History and confirm the recording is marked interrupted.
- [ ] Click **Recover** and confirm the saved portion plays.
- [ ] Open History with `?rolloverMinutes=1` added to its address to activate one-minute test parts.
- [ ] Record for just over three minutes.
- [ ] Confirm History reports parts with offsets near 0, 60, and 120 seconds.
- [ ] Play across the part boundaries and confirm audio continues.
- [ ] Reset the setting by changing the address ending to `?rolloverMinutes=30` and opening it once.

## 3. Video recording

- [ ] Choose **Video + audio** and record a playing video for at least five minutes.
- [ ] Resize the recorded tab once while recording.
- [ ] Stop and open History.
- [ ] Confirm the entry says video and shows its size.
- [ ] Play it and confirm both picture and sound work across the generated parts.
- [ ] Try a protected streaming-video page. If Chrome captures silence or a black picture, confirm the extension shows a clear warning.

## 4. Transcription

- [ ] Record or use a ten-minute podcast with a known spoken word near 3:15.
- [ ] Click **Transcribe**, choose **English**, and add it to the queue.
- [ ] On the first run, confirm model-download progress appears.
- [ ] Confirm later runs use the cached model rather than downloading it again.
- [ ] If WebGPU is unavailable, confirm a clear WASM-fallback message appears.
- [ ] Close the transcription page midway, reopen the queue, and confirm it resumes rather than restarting.
- [ ] Confirm only one queued recording runs at a time.
- [ ] Test **Cancel** and **Retry**.
- [ ] After completion, confirm the known word near 3:15 is within about 0.5 seconds of the correct time.
- [ ] Confirm words in later recording parts have absolute times from the start of the full recording.
- [ ] Confirm a silent section produces no invented transcript text.
- [ ] Transcribe one non-English recording using **Multilingual**.

## 5. History, transcript, and playback

- [ ] Confirm History shows recorded, transcribing, and done statuses correctly.
- [ ] Search for a word from a completed transcript.
- [ ] Open the result and confirm the player appears above the transcript.
- [ ] Click a word in the middle and confirm playback jumps to that word.
- [ ] Play normally and confirm the current word becomes bold.
- [ ] Delete only a transcript and confirm its recording remains.
- [ ] Delete only a recording and confirm its transcript remains visible as a transcript-only History entry.

## 6. Exports

- [ ] Download TXT without timestamps and confirm it contains readable paragraphs.
- [ ] Download TXT with paragraph timestamps and confirm markers such as `[00:01:23]` appear.
- [ ] Download JSON and confirm it contains every word with start and end times.
- [ ] Download CSV and open it in Excel. Confirm the columns are `word`, `start`, and `end`.
- [ ] Download SRT and VTT and confirm subtitle lines contain roughly 7–10 words and split at pauses.
- [ ] Load the SRT in VLC with the recording and confirm the subtitles match the speech.
- [ ] Download each recording part separately.
- [ ] For a multi-part recording, click **Download all recording parts** and confirm every part downloads.

## 7. Keep choices and storage

- [ ] After a video transcription finishes, choose **Video + transcript** and confirm both remain.
- [ ] On another video, choose **Audio + transcript** and confirm History changes it to audio-only and playback works.
- [ ] On another recording, choose **Transcript only** and confirm the transcript remains visible and exportable.
- [ ] Note the History storage number, delete a large recording, and confirm the number decreases.
- [ ] Enable automatic deletion, save a number of days, reload History, and confirm the setting persists.
- [ ] Confirm automatic deletion never removes transcripts.

## 8. Hardening test set

For every item below, confirm recording, transcription, timestamps, playback, and exports complete without a crash. Record the duration and any error in `LOG.md`.

- [ ] Five-minute podcast.
- [ ] Noisy video.
- [ ] Fully silent video.
- [ ] Fast speaker.
- [ ] One non-English video using the multilingual model.
- [ ] Two-hour lecture.
- [ ] During the two-hour test, confirm Chrome does not run out of memory.
- [ ] Confirm no unhandled red errors appear in the popup, page, or service-worker consoles during normal use.

## 9. Error messages

- [ ] Disconnect the internet before the first model download and confirm the message explains how to retry.
- [ ] Confirm an unsupported recording format or codec produces a readable message.
- [ ] If practical, test with nearly full browser storage and confirm the message explains that recordings can be deleted while transcripts are kept.

## 10. Visual review

- [ ] Review the popup at its normal extension-popup size.
- [ ] Review History with zero, one, and several recordings.
- [ ] Review a transcript-only History entry.
- [ ] Review the transcription queue while queued, running, failed, and complete.
- [ ] Review a long transcript with audio and video playback.
- [ ] Review export controls, keep-choice controls, progress messages, and error messages.
- [ ] Resize full pages to a narrow window and confirm nothing overlaps or becomes unusable.
- [ ] Confirm the extension icon looks clear at toolbar size.
