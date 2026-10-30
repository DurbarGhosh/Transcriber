import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

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

export default defineConfig({
  plugins: [bundledWasmRuntime()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        offscreen: resolve(root, 'offscreen.html'),
        spike: resolve(root, 'spike.html'),
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
