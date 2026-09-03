/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK is browser-only (WASM); never bundle it on the server.
  serverExternalPackages: ["@fhevm/sdk"],
  eslint: { ignoreDuringBuilds: true },
  // The SDK needs a cross-origin-isolated context for its threaded WASM. `credentialless`
  // rather than `require-corp` so third-party images and fonts still load.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
