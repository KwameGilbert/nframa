import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Used as pino-http's `genReqId`: respects an incoming request id (e.g. from
// a reverse proxy) so logs correlate across services, generates one
// otherwise, and echoes it back so clients can quote it when reporting an
// issue. This is the single source of truth for the request id — every log
// line and the AllExceptionsFilter both read it via `req.id`, which pino-http
// sets from this function's return value.
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
