import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto((process.env.BUGHUNT_TEST_URL || 'http://127.0.0.1:5173'), { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'Enter the arena' }).waitFor();
await page.getByRole('button', { name: 'New team? Create an account' }).click();
await page.getByRole('heading', { name: 'Create your account' }).waitFor();
await page.getByRole('button', { name: 'Forgot password?' }).click();
await page.getByRole('heading', { name: 'Reset your password' }).waitFor();
await page.getByRole('button', { name: 'Back to sign in' }).click();
mkdirSync(new URL('../test-results/', import.meta.url), { recursive: true });
await page.screenshot({
  path: new URL('../test-results/desktop.png', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
  fullPage: true,
});
await page.getByRole('button', { name: 'Mission Control' }).click();
await page.getByRole('heading', { name: 'Mission Control' }).waitFor();
await page.getByText('Leaderboard temporarily hidden', { exact: true })
  .or(page.getByRole('columnheader', { name: 'Team', exact: true }))
  .waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Back to arena' }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('heading', { name: 'Enter the arena' }).waitFor();
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
if (overflow) errors.push('Mobile horizontal overflow');
await page.screenshot({
  path: new URL('../test-results/mobile.png', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
  fullPage: true,
});
await page.getByRole('link', { name: 'Terms of use', exact: true }).click();
await page.getByRole('heading', { name: 'Terms of use', exact: true }).waitFor();
await page.getByRole('link', { name: 'Privacy notice', exact: true }).first().click();
await page.getByRole('heading', { name: 'Privacy notice', exact: true }).waitFor();
await page.getByRole('link', { name: 'Return to the platform', exact: true }).click();
await page.getByRole('heading', { name: 'Enter the arena' }).waitFor();
await page.getByRole('button', { name: 'Explore the platform', exact: true }).click();
await page.getByRole('button', { name: 'Go to account form', exact: true }).click();
if (
  !(await page.getByLabel('Email', { exact: true }).evaluate((el) => el === document.activeElement))
)
  errors.push('Walkthrough did not focus account form');
await page.getByRole('button', { name: '03 Follow the event', exact: true }).click();
await page.getByRole('link', { name: 'Open live Mission Control', exact: true }).click();
await page.getByRole('heading', { name: 'Mission Control' }).waitFor();
await browser.close();
if (errors.length) {
  console.error(errors);
  process.exitCode = 1;
} else
  console.log(
    'PASS desktop/mobile rendering, auth navigation, live Mission Control, walkthrough, legal pages, and no browser exceptions.',
  );
