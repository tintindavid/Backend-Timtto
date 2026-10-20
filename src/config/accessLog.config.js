'use strict';
import morgan from 'morgan';
import { redactSensitiveUrl } from '../utils/redactUrl.util.js';

// Same fields as morgan's `combined` preset, but URL and referrer go through the redactor so
// reset tokens, portal/sign/download tokens and `token`-like query values never reach the logs.
// The Authorization header is not part of the line (spec: token-log-hygiene).
morgan.token('safe-url', (req) => redactSensitiveUrl(req.originalUrl || req.url));
morgan.token('safe-referrer', (req) => redactSensitiveUrl(req.headers?.referer || req.headers?.referrer));

export const ACCESS_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":safe-referrer" ":user-agent"';
