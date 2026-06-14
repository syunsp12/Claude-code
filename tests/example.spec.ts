import { test, expect } from '@playwright/test';

test('basic DOM interaction', async ({ page }) => {
  await page.setContent('<h1>Hello Playwright</h1><button id="btn">Click me</button>');
  await expect(page.locator('h1')).toHaveText('Hello Playwright');
  await page.click('#btn');
});

test('form input', async ({ page }) => {
  await page.setContent('<input id="name" type="text" /><span id="output"></span>');
  await page.fill('#name', 'Playwright');
  const value = await page.inputValue('#name');
  expect(value).toBe('Playwright');
});
