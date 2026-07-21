/**
 * Serverless-friendly Chromium rendering for one-pagers.
 *
 * Production (Vercel): @sparticuz/chromium + puppeteer-core
 * Local: system Chrome / Edge / full `puppeteer` Chrome if installed
 *
 * Vercel: give this route enough resources — chromium is heavy.
 * See vercel.json: maxDuration + memory for the onepager function.
 */
import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync } from 'fs';

export type PngOpts = {
  width?: number;
  height?: number;
  scale?: number;
};

const SLIDE_W = 1280; // 13.333in @ 96dpi
const SLIDE_H = 720; // 7.5in @ 96dpi

let browserPromise: Promise<Browser> | null = null;

function localChromePath(): string | null {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const isServerless =
    Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      // @sparticuz/chromium v149 ships Chromium Headless Shell and no longer
      // exposes the legacy chromium.headless property.
      headless: true,
    });
  }

  // Local: prefer system Chrome/Edge, else full puppeteer package
  const exe = localChromePath();
  if (exe) {
    return puppeteer.launch({
      executablePath: exe,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
      defaultViewport: { width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 },
    });
  }

  try {
    // Optional local dep — npm i -D puppeteer (bundles Chromium)
    const puppeteerFull = await import('puppeteer');
    return puppeteerFull.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
      defaultViewport: { width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 },
    });
  } catch {
    throw new Error(
      'No Chromium found for one-pager rendering. Install Chrome/Edge, set CHROME_PATH, ' +
        'or `npm i -D puppeteer` for a local Chromium. On Vercel, @sparticuz/chromium is used.',
    );
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function loadHtml(page: Page, html: string): Promise<void> {
  await page.setContent(html, {
    waitUntil: 'networkidle0',
    timeout: 60_000,
  } as unknown as Parameters<Page['setContent']>[1]);
  await page.evaluate(async () => {
    // Wait for webfonts (Montserrat) when a network link is used
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonts = (document as any).fonts;
    if (fonts?.ready) await fonts.ready;
  });
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  return withPage(async (page) => {
    await loadHtml(page, html);
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  });
}

export async function renderHtmlToPng(
  html: string,
  opts?: PngOpts,
): Promise<Buffer> {
  const width = opts?.width ?? SLIDE_W;
  const height = opts?.height ?? SLIDE_H;
  const scale = opts?.scale ?? 2;

  return withPage(async (page) => {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });
    await loadHtml(page, html);
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });
    return Buffer.from(png);
  });
}

/** Optional: close the shared browser (tests / shutdown). */
export async function closeDocgenBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    // ignore
  } finally {
    browserPromise = null;
  }
}
