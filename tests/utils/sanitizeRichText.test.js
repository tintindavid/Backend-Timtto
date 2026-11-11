import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichText } from '../../src/utils/sanitizeRichText.util.js';

describe('sanitizeRichText', () => {
  it('keeps allowed formatting tags', () => {
    const input = '<h2>Titulo</h2><p><strong>negrita</strong> <em>x</em></p><ul><li>a</li></ul>';
    assert.equal(sanitizeRichText(input), input);
  });

  it('drops script tags and their content', () => {
    assert.equal(sanitizeRichText('<p>ok</p><script>alert(1)</script>'), '<p>ok</p>');
  });

  it('strips attributes (onerror, style, href) and disallowed tags', () => {
    const out = sanitizeRichText('<p style="color:red" onclick="x()">hola</p><a href="javascript:alert(1)">l</a><img src=x onerror=alert(1)>');
    assert.ok(!/style|onclick|href|onerror|<a|<img/i.test(out));
    assert.match(out, /<p>hola<\/p>/);
  });

  it('returns empty string when blank after sanitizing', () => {
    assert.equal(sanitizeRichText('<script>x</script>'), '');
    assert.equal(sanitizeRichText('<p><br></p>'), '');
    assert.equal(sanitizeRichText('   '), '');
    assert.equal(sanitizeRichText('<p>&nbsp;</p>'), '');
    assert.equal(sanitizeRichText('<p>​ ﻿</p>'), '');
    assert.equal(sanitizeRichText(undefined), '');
  });
});
