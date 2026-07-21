import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@prisma/client',
    'openai',
    '@anthropic-ai/sdk',
    '@sparticuz/chromium',
    'puppeteer-core',
    'puppeteer',
  ],
};

export default nextConfig;
