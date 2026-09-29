import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'apps/web');
const out = path.join(root, 'apps/ios/build/LocalWorkspace');
const requireWeb = createRequire(path.join(web, 'package.json'));
const postcss = requireWeb('postcss');
const tailwind = requireWeb('tailwindcss');
const loadConfig = requireWeb('tailwindcss/loadConfig');
const config = loadConfig(path.join(web, 'tailwind.config.ts'));
// Consume the existing design tokens and component utilities. Absolute paths
// make this independent of whether the build runs from the repo or apps/ios.
config.content = [path.join(web, 'src/**/*.{ts,tsx}'), path.join(root, 'apps/ios/WebClient/*.tsx')];
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: web, entryPoints: ['../ios/WebClient/main.tsx'], bundle: true,
  outfile: path.join(out, 'main.js'), platform: 'browser', format: 'iife', target: 'safari17',
  jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(web, 'node_modules')],
  loader: { '.woff2': 'file', '.woff': 'file' }, assetNames: 'fonts/[name]-[hash]',
});
const cssPath = path.join(out, 'main.css');
const css = await postcss([tailwind(config), requireWeb('autoprefixer')]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
await writeFile(cssPath, css.css);
await copyFile(path.join(root, 'apps/ios/WebClient/index.html'), path.join(out, 'index.html'));
for (const family of ['newsreader', 'geist', 'geist-mono']) {
  await copyFile(requireWeb.resolve(`@fontsource/${family}/LICENSE`), path.join(out, `FONT-LICENSE-${family}.txt`));
}
console.log('Built installed workspace with the shared web design and bundled fonts.');
