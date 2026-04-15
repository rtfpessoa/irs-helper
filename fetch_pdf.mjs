import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

async function main() {
  const data = fs.readFileSync('XTB - IRS 2025 - Capital Gains.pdf');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ');
    console.log(`Page ${i}:`, text);
  }
}

main().catch(console.error);
