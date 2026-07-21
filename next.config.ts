import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep native/serverless packages at their installed node_modules paths.
  // Bundling @sparticuz/chromium relocates it away from its bin/ payload.
  serverExternalPackages: [
    '@prisma/client',
    'openai',
    '@anthropic-ai/sdk',
    '@sparticuz/chromium',
    'puppeteer-core',
    'puppeteer',
  ],
  // @sparticuz/chromium resolves its compressed binary at runtime. Explicitly
  // trace the payload into the two server functions that can launch Chromium.
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/cases/*/onepager': [
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
  },
};

export default nextConfig;
