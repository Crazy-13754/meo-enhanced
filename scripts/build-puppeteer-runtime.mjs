import { resolve } from 'node:path';

// Bun folds __dirname/__filename in dependencies to build-machine paths. A
// literal banner preserves Node's installed CommonJS directory for Emscripten.
export const nodeRuntimeBuildOptions = {
  target: 'node',
  format: 'cjs',
  minify: true,
  define: {
    __dirname: '__meoRuntimeDir',
    __filename: '__meoRuntimeFile'
  },
  banner: 'var __meoRuntimeDir = __dirname; var __meoRuntimeFile = __filename;'
};

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const result = await Bun.build({
    ...nodeRuntimeBuildOptions,
    entrypoints: [resolve(root, 'src/export/puppeteerRuntime.ts')]
  });
  if (!result.success) throw new AggregateError(result.logs, 'Puppeteer runtime build failed');
  if (result.outputs.length !== 1) throw new Error('Puppeteer runtime must be one self-contained bundle');
  await Bun.write(resolve(root, 'dist/puppeteer-runtime.js'), result.outputs[0]);
  console.log(`Built relocatable Puppeteer runtime (${result.outputs[0].size} bytes)`);
}
