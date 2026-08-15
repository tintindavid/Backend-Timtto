'use strict';

/**
 * Spanish translation of `signedVia`, used only to compose the `body`
 * string below (design.md D4, notify-on-sheet-signed).
 */
const SIGNED_VIA_ES = {
  portal: 'portal cliente',
  'remote-sign': 'enlace remoto',
  'in-place': 'presencial',
};

/**
 * Builds the uniform `sheet.signed` payload shared by the 4 sign flows
 * (client-portal batch sign, client-portal late-sign, remote-sign link,
 * panel sign-in-place). Centralizing this in one place keeps the 4
 * callsites identical and avoids title/body wording drift
 * (openspec/changes/notify-on-sheet-signed/tasks.md 1.2).
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.sheetId
 * @param {string} params.sheetNumero
 * @param {string|import('mongoose').Types.ObjectId} params.otId
 * @param {string} params.otConsecutivo
 * @param {string} params.customerName
 * @param {'portal'|'remote-sign'|'in-place'} params.signedVia
 * @returns {{sheetId: string, sheetNumero: string, otId: string, otConsecutivo: string, customerName: string, signedVia: string, title: string, body: string, data: {link: string}}}
 */
export function buildSheetSignedPayload({
  sheetId,
  sheetNumero,
  otId,
  otConsecutivo,
  customerName,
  signedVia,
}) {
  const signedViaEs = SIGNED_VIA_ES[signedVia] || signedVia;
  const numero = sheetNumero || '';
  const consecutivo = otConsecutivo || '';
  const cliente = customerName || 'Cliente';

  return {
    sheetId: sheetId != null ? String(sheetId) : null,
    sheetNumero: numero,
    otId: otId != null ? String(otId) : null,
    otConsecutivo: consecutivo,
    customerName: cliente,
    signedVia,
    title: `HT ${numero} firmada`,
    body: `OT ${consecutivo} · ${cliente} · vía ${signedViaEs}`,
    // Deep-link opens the OT detail with a query param so the OtDetailPage
    // auto-opens PreviewSheetWorkModal for the specific signed HT.
    // WorkSheets reads `?preview_sheet={sheetId}` and mounts the modal.
    data: { link: `/ots/${otId}?preview_sheet=${sheetId}` },
  };
}
