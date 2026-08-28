import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader'],
});

const results = [];
for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const canvasBox = await page.locator('#scene').boundingBox();
  let canvasImage;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    canvasImage = await page.locator('#scene').screenshot();
    if (canvasImage.byteLength >= 10000) break;
    await page.waitForTimeout(400);
  }
  const entryVisible = await page.locator('#entry').isVisible();

  if (viewport.name === 'desktop') {
    await page.locator('#enter').click();
    await page.waitForTimeout(300);
  }

  results.push({
    viewport: viewport.name,
    canvas: `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}`,
    screenshotBytes: canvasImage.byteLength,
    entryVisible,
    entered: viewport.name === 'desktop' ? await page.locator('#entry').evaluate(node => node.classList.contains('is-hidden')) : null,
    errors,
  });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

if (results.some(result => result.errors.length || result.screenshotBytes < 10000 || !result.entryVisible || result.entered === false)) {
  process.exitCode = 1;
}
