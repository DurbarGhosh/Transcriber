import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

export async function extractAudioWebm(videoBlob) {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track was found in this video part.');
    const codec = await track.getCodec();
    if (!codec) throw new Error('The video audio codec could not be read.');

    const target = new BufferTarget();
    const source = new EncodedAudioPacketSource(codec);
    const output = new Output({ format: new WebMOutputFormat(), target });
    output.addAudioTrack(source);
    await output.start();

    const decoderConfig = await track.getDecoderConfig();
    const sink = new EncodedPacketSink(track);
    for await (const packet of sink.packets()) {
      await source.add(packet, { decoderConfig: decoderConfig ?? undefined });
    }
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error('The audio-only recording could not be created.');
    return new Blob([target.buffer], { type: await output.getMimeType() });
  } finally {
    input.dispose();
  }
}
