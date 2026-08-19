// We use a symlink at apps/web/.env.local → ../../.env so Next.js picks up
// the monorepo-root env file natively. That is more reliable than
// loadEnvConfig() — Next's static page collection step doesn't always honor
// programmatic env loading. See apps/web/.env.local.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Build/runtime provenance for the Settings footer. Captured when the server
// process starts (dev) or the build runs (prod) — which is exactly the
// useful semantic: it identifies the code that is actually RUNNING, so a
// dev server that predates a `git pull` is visible at a glance. Git being
// absent (e.g. a Docker build from a tarball) degrades to "unknown".
function gitMeta() {
  const run = (cmd) => execSync(cmd, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return {
      commit: run('git rev-parse --short HEAD'),
      branch: run('git rev-parse --abbrev-ref HEAD'),
      commitDate: run('git log -1 --format=%cs'),
    };
  } catch {
    return { commit: 'unknown', branch: '', commitDate: '' };
  }
}
const { commit, branch, commitDate } = gitMeta();
const { version } = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jevi-ops/shared'],

  // Inlined at build/boot — read by the Settings footer (see gitMeta above).
  env: {
    APP_VERSION: version,
    APP_COMMIT: commit,
    APP_BRANCH: branch,
    APP_COMMIT_DATE: commitDate,
  },

  // Self-contained server bundle for the Docker image (node server.js).
  // outputFileTracingRoot points at the monorepo root so workspace deps
  // (@jevi-ops/shared) get traced into .next/standalone — without it,
  // tracing stops at apps/web and the container crashes on import.
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '../../'),
  // typedRoutes is incompatible with dynamic `redirect(target)` calls from
  // server actions where the path comes from a request param.

  // Skip type-checking and lint during the production build. We run both
  // explicitly via `pnpm --filter web typecheck` / lint scripts before
  // each commit, so running them again in `next build` is redundant —
  // and was OOM-killing the XCloud build container after the 5-min
  // webpack compile. Build-time correctness still rests on the
  // pre-commit checks; this just lets the deploy server focus on
  // bundling.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Server Actions cap request bodies at 1MB by default — fine for
  // typical form posts but kills image uploads (phone photos are 5-12MB).
  // Bump to 25MB to match the multipart limit on the API. Anything over
  // 25MB gets rejected at the API layer with a clean 413 instead of a
  // generic Next.js exception.
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },

  // packages/shared uses TypeScript's "import './x.js'" convention required
  // by NodeNext resolution (the API). Webpack's default resolver doesn't
  // know to also try '.ts' for those imports — extensionAlias fixes it.
  // See https://webpack.js.org/configuration/resolve/#resolveextensionalias
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
