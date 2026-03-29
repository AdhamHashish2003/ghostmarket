/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    GHOSTMARKET_DB: process.env.GHOSTMARKET_DB,
    ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL || 'http://localhost:4000',
  },
  // Rewrite /api/* to orchestrator when ORCHESTRATOR_URL is set and not localhost
  async rewrites() {
    const orchestratorUrl = process.env.ORCHESTRATOR_URL;
    if (orchestratorUrl && !orchestratorUrl.includes('localhost')) {
      return [
        {
          source: '/api/:path*',
          destination: `${orchestratorUrl}/api/:path*`,
        },
      ];
    }
    return [];
  },
};
module.exports = nextConfig;
