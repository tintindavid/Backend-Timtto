'use strict';

export const SHEET_SIGN_TOKEN_TTL_DAYS = 7;
export const SHEET_SIGN_TOKEN_TTL_MS = SHEET_SIGN_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export const SHEET_SIGN_MESSAGE_MAX = 500;

export const SHEET_SIGN_CORREOUSADOS_MAX = 20;

export const SHEET_SIGN_TOKEN_LENGTH = 32;

// Share-link download flow (sheetwork-share-and-portal-widening).
export const SHEET_SHARE_DOWNLOAD_TTL_DAYS = 3;
export const SHEET_SHARE_DOWNLOAD_TTL_MS = SHEET_SHARE_DOWNLOAD_TTL_DAYS * 24 * 60 * 60 * 1000;
export const SHEET_SHARE_HT_DOWNLOADS_ALLOWED = 3;
export const SHEET_SHARE_REPORTS_DOWNLOADS_ALLOWED = 2;
export const SHEET_SHARE_TOKEN_LENGTH = 32;
