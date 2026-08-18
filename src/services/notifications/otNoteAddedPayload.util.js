'use strict';

/**
 * Builds the uniform `ot.note.added` payload. Deep-links to the OT's notas
 * modal in the maintenance orders listing (`?open_notas={otId}`), same
 * mechanism as `?open_ot` (design D11 of ot-responsables-programacion-trazable).
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.otId
 * @param {string} params.otConsecutivo
 * @param {string} params.noteAuthor - display name of the user who added the note
 * @param {string} params.notePreview - first ~80 chars of the note body
 */
export function buildOtNoteAddedPayload({ otId, otConsecutivo, noteAuthor, notePreview }) {
  const consecutivo = otConsecutivo || '';
  const author = noteAuthor || 'Usuario';
  const preview = notePreview || '';
  const truncated = preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;

  return {
    otId: otId != null ? String(otId) : null,
    otConsecutivo: consecutivo,
    noteAuthor: author,
    notePreview: truncated,
    title: `Nueva nota en OT ${consecutivo}`,
    body: `${author}: ${truncated}`,
    data: { link: `/maintenance-orders?open_notas=${otId}` },
  };
}
