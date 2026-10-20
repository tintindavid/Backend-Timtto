import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stickerHtml, singleHtml, bulkHtml } from '../../src/services/equipmentQrPdf.service.js';
import { STICKER_BRAND_TEXT } from '../../src/constants/equipmentQr.constants.js';

const DATA_URI = 'data:image/png;base64,AAAA';

describe('equipment QR sticker design', () => {
  for (const [name, build] of [['bulk sticker', stickerHtml], ['single sticker', singleHtml]]) {
    it(`${name}: client name, inventory and the brand address, no old fixed lines`, () => {
      const html = build(DATA_URI, 'INV-77', 'Hospital San Rafael');
      assert.match(html, /class="cliente">Hospital San Rafael</);
      assert.match(html, /class="label">INV-77</);
      assert.match(html, new RegExp(`class="brand">${STICKER_BRAND_TEXT.replace(/\./g, '\\.')}<`));
      assert.equal(html.includes('Mantenimiento'), false);
      assert.equal(html.includes('Información'), false);
    });

    it(`${name}: the brand address is the last element of the label column`, () => {
      const html = build(DATA_URI, 'INV-77', 'Hospital San Rafael');
      assert.ok(html.indexOf('class="brand"') > html.indexOf('class="label"'));
      assert.ok(html.indexOf('class="label"') > html.indexOf('class="cliente"'));
    });

    it(`${name}: falls back to a dash when the client or the inventory is missing`, () => {
      const html = build(DATA_URI, null, undefined);
      assert.match(html, /class="cliente">—</);
      assert.match(html, /class="label">—</);
    });

    it(`${name}: escapes HTML in the client name`, () => {
      const html = build(DATA_URI, 'INV', '<img src=x onerror=alert(1)>');
      assert.equal(html.includes('<img src=x'), false);
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    });
  }

  it('the brand text is www.timtto.com', () => {
    assert.equal(STICKER_BRAND_TEXT, 'www.timtto.com');
  });
});

describe('bulk sticker PDF page geometry', () => {
  const html = bulkHtml('<div class="page"></div>');

  it('uses A4 portrait: 190 x 277mm printable holds exactly 2 columns x 5 rows of 80 x 40mm', () => {
    assert.match(html, /@page \{ size: A4 portrait; margin: 10mm; \}/);
    assert.match(html, /grid-template-columns: repeat\(2, 80mm\)/);
    assert.match(html, /grid-template-rows: repeat\(5, 40mm\)/);
    // 5 x 40 + 4 x 4 = 216mm <= 276mm and 2 x 80 + 4 = 164mm <= 190mm
    assert.match(html, /height: 276mm/);
  });

  it('never splits a sticker between pages', () => {
    assert.match(html, /\.sticker \{[^}]*break-inside: avoid/);
    assert.match(html, /\.sticker \{[^}]*page-break-inside: avoid/);
  });

  it('breaks after every page except the last', () => {
    assert.match(html, /\.page \{[^}]*page-break-after: always/);
    assert.match(html, /\.page:last-child \{ page-break-after: auto/);
  });
});
