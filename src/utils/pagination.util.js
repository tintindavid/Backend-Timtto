'use strict';

/** Standard pagination block of the success envelope. */
export function buildPagination(page, limit, total) {
  const pages = Math.ceil(total / limit);
  return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}
