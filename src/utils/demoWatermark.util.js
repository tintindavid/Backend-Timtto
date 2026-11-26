import { DEMO_WATERMARK_TEXT } from '../constants/demo.constants.js';
import { getDemoConfig } from '../services/demo/demoContext.service.js';

// position:fixed elements repeat on every printed page in Chromium.
const BLOCK = `<div data-demo-watermark style="position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2147483647;">
  <span style="transform:rotate(-35deg);font:700 54px Arial,sans-serif;color:rgba(200,0,0,0.22);white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${DEMO_WATERMARK_TEXT}</span>
</div>`;

/**
 * Adds the demo watermark to an HTML document (idempotent). Nothing found in the content can switch it off: any copy of
 * the block is removed and the real one is appended at the end of the body.
 */
export function applyDemoWatermark(html) {
  const source = String(html).split(BLOCK).join('');
  const at = source.lastIndexOf('</body>');
  return at === -1 ? source + BLOCK : source.slice(0, at) + BLOCK + source.slice(at);
}

/** Watermarks the HTML only when the tenant is a demo account. */
export async function watermarkIfDemo(html, tenantId) {
  return (await getDemoConfig(tenantId)) ? applyDemoWatermark(html) : html;
}
