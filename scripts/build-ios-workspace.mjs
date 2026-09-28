import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'apps/ios/build/LocalWorkspace');
await mkdir(out, { recursive: true });
await build({ absWorkingDir: path.join(root, 'apps/web'), entryPoints: ['../ios/WebClient/main.tsx'], bundle: true,
  outfile: path.join(out, 'main.js'), platform: 'browser', format: 'iife', target: 'safari17',
  jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(root, 'apps/web/node_modules')],
});
await copyFile(path.join(root, 'apps/ios/WebClient/index.html'), path.join(out, 'index.html'));
console.log('Built installed workspace interface.');
