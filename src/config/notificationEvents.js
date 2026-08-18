'use strict';

/**
 * Central enum of notification events (design.md D9). Phase 1 ships a single
 * admin-triggered test event so the whole bus (rule -> recipients ->
 * preferences -> persistence -> socket emit) can be validated end-to-end
 * without depending on a business event.
 *
 * Future phases append event strings here as features wire calls to
 * `notificationService.emit(tenantId, event, payload)` (design.md D7) — no
 * migration needed, this is just a validation allow-list consumed by the
 * NotificationRule / NotificationPreference DTOs and exposed read-only via
 * GET /api/v1/notifications/events for the settings UI.
 *
 * `sheet.signed` (openspec/changes/notify-on-sheet-signed) is the first
 * real business event — fired from the 4 sheet-signing flows
 * (client-portal batch, client-portal late-sign, remote-sign link, panel
 * sign-in-place) via `services/notifications/sheetSignedPayload.util.js`.
 *
 * `ot.responsible.assigned` (openspec/changes/ot-responsables-programacion-trazable)
 * fires once per newly-added userId when an OT's programación roster grows —
 * see `services/notifications/otResponsibleAssignedPayload.util.js` and
 * `ot.service.js#setProgramacion` (design D10).
 */
export const NOTIFICATION_EVENTS = ['system.test', 'sheet.signed', 'ot.responsible.assigned',
  'ot.note.added'];
