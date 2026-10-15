import { randomUUID } from 'node:crypto';

const EVENT_NAMES = new Set(['order_created', 'add_to_cart', 'checkout_started']);
const PROPERTY_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SENSITIVE_KEYS = new Set(['email', 'name', 'phone', 'password', 'token', 'card', 'address', 'ip']);
const MAX_PROPERTIES_BYTES = 4096;
const MAX_EVENT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RETRIES = 2;

function validateProperties(properties = {}) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)
      || (Object.getPrototypeOf(properties) !== Object.prototype && Object.getPrototypeOf(properties) !== null)) {
    throw new TypeError('properties must be a plain object');
  }
  const entries = Object.entries(properties);
  if (entries.length > 30) throw new TypeError('properties must contain at most 30 keys');
  for (const [key, value] of entries) {
    if (!PROPERTY_KEY.test(key) || SENSITIVE_KEYS.has(key.toLowerCase())) throw new TypeError(`property key is not permitted: ${key}`);
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError(`property ${key} must be a scalar value`);
    if (typeof value === 'string' && value.length > 500) throw new TypeError(`property ${key} is too long`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`property ${key} must be finite`);
  }
  const normalized = Object.fromEntries(entries);
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_PROPERTIES_BYTES) {
    throw new TypeError('properties must not exceed 4096 bytes');
  }
  return normalized;
}

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new TypeError('endpoint is required');
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('endpoint must be an absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('endpoint must be an HTTP(S) URL without embedded credentials or fragment');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new TypeError('writeKey may only be sent to HTTPS endpoints (HTTP is allowed on loopback)');
  return url.toString();
}

function normalizeContext(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('context must be an object');
  const timestampValue = context.timestamp ?? new Date();
  const timestamp = timestampValue instanceof Date ? timestampValue : new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError('context.timestamp must be a valid datetime');
  const eventId = context.eventId ?? randomUUID();
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 100) throw new TypeError('context.eventId must contain 1 to 100 characters');
  const identity = {};
  for (const key of ['visitorId', 'sessionId']) {
    const value = context[key] ?? null;
    if (value !== null && (typeof value !== 'string' || value.length > 100)) throw new TypeError(`context.${key} must be a string of at most 100 characters`);
    identity[key] = value;
  }
  return { eventId, timestamp: timestamp.toISOString(), ...identity };
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultError(code, message) {
  return { code, message };
}

/**
 * Create a backend-compatible server event client. `transport` is an optional
 * in-process adapter used by this monolith; without it, events use HTTP.
 */
export function createAnalyticsClient({
  endpoint,
  writeKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_RETRIES,
  retryDelayMs = 100,
  onError,
  transport,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!transport && (typeof writeKey !== 'string' || writeKey.length < 16 || writeKey.length > 512)) {
    throw new TypeError('writeKey must contain 16 to 512 characters');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('timeoutMs must be an integer from 1 to 60000');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new TypeError('maxRetries must be an integer from 0 to 5');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10_000) throw new TypeError('retryDelayMs must be an integer from 0 to 10000');
  if (onError !== undefined && typeof onError !== 'function') throw new TypeError('onError must be a function');
  if (transport !== undefined && typeof transport !== 'function') throw new TypeError('transport must be a function');
  const url = transport ? (endpoint ? normalizeEndpoint(endpoint) : null) : normalizeEndpoint(endpoint);
  if (!transport && typeof fetchImpl !== 'function') throw new TypeError('global fetch is required or provide a transport');

  async function deliver(event) {
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body, 'utf8') > MAX_EVENT_BYTES) throw new TypeError('event payload must not exceed 16 KB');
    let attempts = 0;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attempts += 1;
      try {
        if (transport) {
          const outcome = await transport(event);
          return {
            ok: true,
            eventId: event.eventId,
            eventName: event.eventName,
            status: outcome?.duplicate ? 'duplicate' : 'sent',
            attempts
          };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${writeKey}`
            },
            body,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response || typeof response.status !== 'number') {
          return finishFailure(event, attempts, 'INVALID_RESPONSE', 'Analytics endpoint returned an invalid response');
        }
        if (retryableStatus(response.status)) {
          lastError = resultError(response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', `Analytics endpoint returned HTTP ${response.status}`);
        } else if (!response.ok) {
          return finishFailure(event, attempts, 'REJECTED', `Analytics endpoint rejected the event with HTTP ${response.status}`);
        } else {
          let payload;
          try { payload = await response.json(); } catch {
            return finishFailure(event, attempts, 'INVALID_RESPONSE', 'Analytics endpoint returned invalid JSON');
          }
          const status = payload?.data?.status;
          if (payload?.data?.eventId !== event.eventId || !['accepted', 'duplicate'].includes(status)) {
            return finishFailure(event, attempts, 'INVALID_RESPONSE', 'Analytics endpoint returned an unexpected success response');
          }
          return { ok: true, eventId: event.eventId, eventName: event.eventName, status: status === 'duplicate' ? 'duplicate' : 'sent', attempts };
        }
      } catch (error) {
        lastError = resultError(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
          error?.name === 'AbortError' ? 'Analytics request timed out' : 'Analytics request failed');
      }
      if (attempt < maxRetries) await sleep(retryDelayMs * (2 ** attempt));
    }
    return finishFailure(event, attempts, lastError?.code || 'DELIVERY_FAILED', lastError?.message || 'Analytics delivery failed');
  }

  function finishFailure(event, attempts, code, message) {
    const failure = { ok: false, eventId: event.eventId, eventName: event.eventName, status: 'failed', attempts, error: resultError(code, message) };
    try { onError?.({ eventId: event.eventId, eventName: event.eventName, attempts, code, message }); } catch { /* Observability hooks must not interrupt business code. */ }
    return failure;
  }

  async function track(eventName, properties = {}, context = {}) {
    if (typeof eventName !== 'string' || !EVENT_NAMES.has(eventName)) throw new TypeError('eventName is not permitted for server events');
    const normalizedProperties = validateProperties(properties);
    if (eventName === 'order_created') {
      if (typeof normalizedProperties.orderId !== 'string' || normalizedProperties.orderId.length < 1 || normalizedProperties.orderId.length > 100) {
        throw new TypeError('order_created properties.orderId is required');
      }
      if (!Number.isInteger(normalizedProperties.itemCount) || normalizedProperties.itemCount < 1) {
        throw new TypeError('order_created properties.itemCount must be a positive integer');
      }
      if (typeof normalizedProperties.totalAmount !== 'number' || normalizedProperties.totalAmount < 0) {
        throw new TypeError('order_created properties.totalAmount must be a non-negative number');
      }
    }
    const normalizedContext = normalizeContext(context);
    const event = {
      eventId: normalizedContext.eventId,
      eventName,
      eventSource: 'server',
      timestamp: normalizedContext.timestamp,
      visitorId: normalizedContext.visitorId,
      sessionId: normalizedContext.sessionId,
      pageUrl: null,
      referrer: null,
      properties: normalizedProperties,
      schemaVersion: 1
    };
    return deliver(event);
  }

  return Object.freeze({
    track,
    close: async () => {}
  });
}
