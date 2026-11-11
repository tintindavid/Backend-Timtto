import sanitizeHtml from 'sanitize-html';

/**
 * Strict allow-list sanitizer for the rich-text "observaciones adicionales" of the informe por OT.
 * Only basic formatting tags survive; no attributes (so no style / href / on*), no URL schemes, and
 * script / style contents are dropped entirely. Returns '' when nothing meaningful is left.
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'];

export function sanitizeRichText(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  const clean = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  }).trim();
  // Blank after sanitizing: only empty tags / <br> / whitespace remain
  const textOnly = clean
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;|&#8203;|&#x200b;|&#65279;|&#xfeff;/gi, '')
    .replace(/[\s ​-‍⁠﻿]/g, '');
  return textOnly ? clean : '';
}
