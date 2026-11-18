# Tab Recorder + Local Transcriber

A private Chrome extension for recording one browser tab and transcribing it locally with Whisper. Record audio only or video with audio. Transcripts include word-level timestamps and can be searched, played back, and exported.

## Privacy

Recordings and transcripts stay in the browser and are stored locally. They are not uploaded to a server. The extension downloads model files once for local transcription; the ONNX/WASM runtime is bundled with the extension.

## Features

- Record a tab as audio or video with audio while keeping tab audio audible.
- Save recordings in chunks and split long sessions into parts for recovery.
- Transcribe locally with Whisper, with WebGPU and WASM support.
- Search transcription history and click transcript words to seek playback.
- Export transcripts as TXT, JSON, SRT, VTT, or CSV.
- Keep a recording with its transcript, keep an audio-only copy, or keep only the transcript.

## Install for development

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. In this folder, run `npm install`.
3. Run `npm run build` to create the `dist/` folder.
4. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
5. Click **Load unpacked** and select this project's `dist/` folder.
6. After rebuilding, return to `chrome://extensions` and click the extension's reload button.

## Use

1. Open the tab you want to record.
2. Click the extension icon, choose audio-only or video-with-audio, then start recording.
3. Stop the recording from the extension popup.
4. Open History to play, transcribe, search, or export recordings and transcripts.

Transcription runs in the browser and may take longer than the recording, especially without WebGPU. The first transcription downloads the selected model; later transcriptions can use the cached model.

## Build

```sh
npm install
npm run build
```

The built unpacked extension is in `dist/`.

## Project status

This project is intended for private use and is not currently prepared for Chrome Web Store release.
