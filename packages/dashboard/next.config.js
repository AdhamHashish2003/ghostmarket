/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@ghostmarket/shared'],
};

export default nextConfig;
