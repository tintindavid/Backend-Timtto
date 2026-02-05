'use strict';

export function successResponse(data = null, message = 'OK', status = 200, pagination = undefined) {
  const res = { success: true, message, data };
  if (pagination) res.pagination = pagination;
  return res;
}

export function errorResponse(message = 'Error', code = 'INTERNAL_ERROR', details = {}) {
  return {
    success: false,
    message,
    error: { code, details },
  };
}
