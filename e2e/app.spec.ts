import { test, expect } from '@playwright/test';
import path from 'path';

test('has title and can process files', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  // Expect a title "to contain" a substring.
  await expect(page.getByRole('heading', { name: 'IRS Helper' })).toBeVisible();

  // Pick files
  const xmlPath = path.resolve('./delc-anexo-j.xml');
  const pdfPath = path.resolve('./XTB - IRS 2025 - Capital Gains.pdf');

  // We find the file inputs by id
  await page.setInputFiles('input[id="file-input-1. Base IRS XML File"]', xmlPath);
  await page.setInputFiles('input[id="file-input-2. XTB Capital Gains PDF"]', pdfPath);

  // Click on 'Enrich XML'
  await page.click('button:has-text("Enrich XML")');

  // Verify success message appears
  await expect(page.locator('.status-success')).toContainText('Successfully extracted 24 row(s) and enriched the XML!');

  // Instead of actually downloading in headless, just check if download button appeared
  await expect(page.locator('button:has-text("Download Enriched XML")')).toBeVisible();
});
