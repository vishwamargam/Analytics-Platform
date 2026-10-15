import { insertBrowserEvent } from '../services/eventService.js';
import { validateBrowserEvent } from '../validation/events.js';
import { validateServerEvent } from '../validation/events.js';
import { config } from '../config/env.js';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

function requireInternalWriteKey(req) {
  const authorization = req.get('Authorization');
  if (authorization === undefined) return false;
  const match = /^Bearer (.+)$/.exec(authorization);
  const expected = req.app.locals.internalIngestionKey ?? config.internalIngestionKey;
  if (!match || !expected) throw new HttpError(401, 'UNAUTHORIZED', 'Valid server ingestion credentials are required');
  const actualBuffer = Buffer.from(match[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Valid server ingestion credentials are required');
  }
  return true;
}

export async function ingestEvent(req, res) {
  const event = requireInternalWriteKey(req) ? validateServerEvent(req.body) : validateBrowserEvent(req.body);
  const result = await insertBrowserEvent(event);
  res.status(result.duplicate ? 200 : 202).json({
    data: { eventId: event.eventId, status: result.duplicate ? 'duplicate' : 'accepted' }
  });
}
