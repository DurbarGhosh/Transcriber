import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname);

function bundledWasmRuntime() {
  const runtimeFiles = [
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ];

  return {
    name: 'bundled-wasm-runtime',
    async generateBundle() {
      for (const fileName of runtimeFiles) {
        const source = await readFile(
          resolve(root, 'node_modules/@huggingface/transformers/dist', fileName),
        );
        this.emitFile({ type: 'asset', fileName: `wasm/${fileName}`, source });
      }
    },
  };
}

function bundledVadRuntime() {
  return {
    name: 'bundled-vad-runtime',
    async generateBundle() {
      const assets = [
        ['node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx', 'vad/silero_vad_legacy.onnx'],
        ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'vad/ort-wasm-simd-threaded.mjs'],
        ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'vad/ort-wasm-simd-threaded.wasm'],
      ];
      for (const [sourcePath, fileName] of assets) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: await readFile(resolve(root, sourcePath)),
        });
      }
    },
  };
}

function versionStamp() {
  return {
    name: 'version-stamp',
    async closeBundle() {
      const manifestPath = resolve(root, 'dist/manifest.json');
      const contents = JSON.parse(await readFile(manifestPath, 'utf8'));
      contents.version_name = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      await writeFile(manifestPath, `${JSON.stringify(contents, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [bundledWasmRuntime(), bundledVadRuntime(), versionStamp()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        offscreen: resolve(root, 'offscreen.html'),
        spike: resolve(root, 'spike.html'),
        history: resolve(root, 'history.html'),
        transcription: resolve(root, 'transcription.html'),
        background: resolve(root, 'src/background/background.js'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
