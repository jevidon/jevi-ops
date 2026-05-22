// We use a symlink at apps/web/.env.local → ../../.env so Next.js picks up
// the monorepo-root env file natively. That is more reliable than
// loadEnvConfig() — Next's static page collection step doesn't always honor
// programmatic env loading. See apps/web/.env.local.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jerad-ops/shared'],
  // typedRoutes is incompatible with dynamic `redirect(target)` calls from
  // server actions where the path comes from a request param.

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
