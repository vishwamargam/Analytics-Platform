const SCHEMA_VERSION = 1;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_PROPERTIES_BYTES = 4096;
const MAX_PROPERTIES = 30;
const VISITOR_STORAGE_KEY = 'analytics:visitor:v1';
const SESSION_STORAGE_KEY = 'analytics:session:v1';
const SENSITIVE_KEYS = new Set(['email', 'name', 'phone', 'password', 'token', 'card', 'address', 'ip']);
const SAFE_EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_PROPERTY_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

let singleton;

function byteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function randomId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error('A cryptographically secure browser crypto API is required');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readOrCreateId(storage, key, fallback) {
  try {
    const existing = storage?.getItem(key);
    if (typeof existing === 'string' && existing.length > 0 && existing.length <= 100) return existing;
  } catch { /* Private browsing or browser policy can disable storage. */ }
  const id = randomId();
  try { storage?.setItem(key, id); } catch { /* Keep the generated ID in memory for this page. */ }
  return id || fallback();
}

function browserStorage(name) {
  try { return globalThis[name]; } catch { return null; }
}

function sanitizeUrl(value, required = false) {
  if (!value) {
    if (required) throw new TypeError('A current page URL is required');
    return null;
  }
  if (typeof value !== 'string') throw new TypeError('Page URL must be a string');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Page URL must be an absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Page URL must use HTTP or HTTPS');
  url.search = '';
  url.hash = '';
  const result = url.toString();
  if (result.length > 2048) throw new TypeError('Page URL must not exceed 2048 characters');
  return result;
}

function validateProperties(properties = {}) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new TypeError('Event properties must be a plain object');
  }
  const prototype = Object.getPrototypeOf(properties);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Event properties must be a plain object');
  const entries = Object.entries(properties);
  if (entries.length > MAX_PROPERTIES) throw new TypeError(`Event properties must contain at most ${MAX_PROPERTIES} keys`);
  for (const [key, value] of entries) {
    if (!SAFE_PROPERTY_KEY.test(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      throw new TypeError(`Event property key is not permitted: ${key}`);
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`Event property ${key} must be a scalar value`);
    }
    if (typeof value === 'string' && value.length > 500) throw new TypeError(`Event property ${key} is too long`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`Event property ${key} must be finite`);
  }
  const result = Object.fromEntries(entries);
  if (byteLength(JSON.stringify(result)) > MAX_PROPERTIES_BYTES) throw new TypeError('Event properties must not exceed 4096 bytes');
  return result;
}

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new TypeError('endpoint is required');
  let url;
  try { url = new URL(endpoint, globalThis.location?.href); } catch { throw new TypeError('endpoint must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('endpoint must use HTTP or HTTPS');
  if (url.username || url.password || url.hash) throw new TypeError('endpoint cannot contain credentials or a fragment');
  return url.toString();
}

function retryDelay(attempt) {
  const base = Math.min(250 * (2 ** attempt), 1000);
  return base + Math.floor(Math.random() * 100);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSdk(options) {
  const endpoint = normalizeEndpoint(options.endpoint);
  // The backend has no public write-key contract. Never put this value on the wire.
  if (options.writeKey !== undefined && options.writeKey !== null && options.writeKey !== '') {
    throw new TypeError('This backend does not support a public writeKey');
  }

  const visitorId = readOrCreateId(browserStorage('localStorage'), VISITOR_STORAGE_KEY, randomId);
  const sessionId = readOrCreateId(browserStorage('sessionStorage'), SESSION_STORAGE_KEY, randomId);
  const pending = [];
  let activeWorker = null;
  let destroyed = false;
  let lastPageUrl = null;
  let flushScheduled = false;

  function currentLocation() {
    const location = globalThis.window?.location || globalThis.location;
    if (!location?.href) throw new TypeError('A browser location is required to track events');
    return {
      pageUrl: sanitizeUrl(location.href, true),
      referrer: sanitizeUrl(globalThis.document?.referrer || '', false)
    };
  }

  function createEvent(eventName, properties = {}) {
    if (typeof eventName !== 'string' || !SAFE_EVENT_NAME.test(eventName)) {
      throw new TypeError('eventName must start with a lowercase letter and contain only lowercase letters, digits, and underscores');
    }
    const page = currentLocation();
    const event = {
      eventId: randomId(),
      eventName,
      eventSource: 'browser',
      timestamp: new Date().toISOString(),
      visitorId,
      sessionId,
      pageUrl: page.pageUrl,
      referrer: page.referrer,
      properties: validateProperties(properties),
      schemaVersion: SCHEMA_VERSION
    };
    if (byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) throw new TypeError('Event payload must not exceed 16 KB');
    return event;
  }

  async function send(event, { keepalive = false, retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await globalThis.fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: controller.signal,
          keepalive
        });
        if (response.ok) return { eventId: event.eventId, status: 'sent' };
        if (response.status < 500 && response.status !== 429) {
          return { eventId: event.eventId, status: 'rejected', statusCode: response.status };
        }
        lastError = new Error(`Analytics endpoint returned ${response.status}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < retries) await wait(retryDelay(attempt));
    }
    return { eventId: event.eventId, status: 'failed', error: lastError };
  }

  async function flush({ keepalive = false, retries = 2 } = {}) {
    const outcomes = [];
    while (activeWorker || pending.length > 0) {
      if (!activeWorker) {
        const batch = pending.splice(0, pending.length);
        activeWorker = Promise.all(batch.map((event) => send(event, { keepalive, retries })));
      }
      const worker = activeWorker;
      outcomes.push(...await worker);
      if (activeWorker === worker) activeWorker = null;
    }
    return outcomes;
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      void flush().catch(() => {});
    });
  }

  function track(eventName, properties = {}) {
    if (destroyed) return null;
    const event = createEvent(eventName, properties);
    pending.push(event);
    // Fire-and-forget: host interaction does not wait on network or retry delays.
    scheduleFlush();
    return event.eventId;
  }

  function trackPageView() {
    if (destroyed) return null;
    const page = currentLocation();
    if (page.pageUrl === lastPageUrl) return null;
    lastPageUrl = page.pageUrl;
    const event = createEvent('page_view');
    // Use the same captured location used for deduplication to avoid a navigation race.
    event.pageUrl = page.pageUrl;
    event.referrer = page.referrer;
    pending.push(event);
    scheduleFlush();
    return event.eventId;
  }

  function onPageHide() {
    // Keepalive allows the browser to finish a JSON fetch when possible; delivery is best effort.
    void flush({ keepalive: true, retries: 0 }).catch(() => {});
  }

  const sdk = {
    track,
    trackPageView,
    flush: () => flush(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      globalThis.window?.removeEventListener?.('pagehide', onPageHide);
      pending.length = 0;
      if (singleton === sdk) singleton = null;
    }
  };

  globalThis.window?.addEventListener?.('pagehide', onPageHide);
  if (options.autoTrackPageViews) sdk.trackPageView();
  return sdk;
}

export function init(options = {}) {
  if (singleton) return singleton;
  singleton = createSdk(options);
  return singleton;
}

export function trackPageView() {
  if (!singleton) throw new Error('Initialize the analytics SDK before tracking');
  return singleton.trackPageView();
}

export function track(eventName, properties) {
  if (!singleton) throw new Error('Initialize the analytics SDK before tracking');
  return singleton.track(eventName, properties);
}

export async function flush() {
  if (!singleton) return [];
  return singleton.flush();
}

export function destroy() {
  singleton?.destroy();
}

const Analytics = { init, trackPageView, track, flush, destroy };
export default Analytics;
