// We use a symlink at apps/web/.env.local → ../../.env so Next.js picks up
// the monorepo-root env file natively. That is more reliable than
// loadEnvConfig() — Next's static page collection step doesn't always honor
// programmatic env loading. See apps/web/.env.local.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jevi-ops/shared'],
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
