import { HttpError } from '../utils/httpError.js';

const BROWSER_EVENT_NAMES = new Set(['page_view', 'menu_item_clicked', 'add_to_cart', 'checkout_started']);
const ALLOWED_EVENT_NAMES = new Set([...BROWSER_EVENT_NAMES, 'order_created']);
const SERVER_EVENT_NAMES = new Set(['order_created', 'add_to_cart', 'checkout_started']);
const TOP_LEVEL_FIELDS = new Set([
  'eventId', 'eventName', 'eventSource', 'timestamp', 'visitorId', 'sessionId',
  'pageUrl', 'referrer', 'properties', 'schemaVersion'
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SENSITIVE_KEYS = new Set(['email', 'name', 'phone', 'password', 'token', 'card', 'address', 'ip']);

function invalid(message) {
  throw new HttpError(400, 'INVALID_EVENT', message);
}

function validateOptionalId(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) invalid(`${field} must be a string of at most 100 characters`);
  return value;
}

function sanitizeUrl(value, field, required) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || value.length > 2048) invalid(`${field} must be a URL of at most 2048 characters`);
  let url;
  try { url = new URL(value); } catch { invalid(`${field} must be a valid absolute URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) invalid(`${field} must use HTTP or HTTPS`);
  url.hash = '';
  url.search = '';
  return url.toString();
}

function hasValidCalendarDate(value) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateProperties(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('properties must be a JSON object');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 4096) invalid('properties must not exceed 4096 bytes');
  const keys = Object.keys(value);
  if (keys.length > 30) invalid('properties must contain at most 30 keys');
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_KEY_RE.test(key) || SENSITIVE_KEYS.has(key.toLowerCase())) invalid(`properties contains a disallowed key: ${key}`);
    if (item && typeof item === 'object') invalid(`property ${key} must be a scalar value`);
    if (!['string', 'number', 'boolean'].includes(typeof item) && item !== null) invalid(`property ${key} must be a scalar value`);
    if (typeof item === 'string' && item.length > 500) invalid(`property ${key} is too long`);
    if (typeof item === 'number' && !Number.isFinite(item)) invalid(`property ${key} must be finite`);
  }
  return value;
}

export function validateBrowserEvent(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('request body must be a JSON object');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 16 * 1024) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'event payload must not exceed 16 KB');
  for (const key of Object.keys(input)) if (!TOP_LEVEL_FIELDS.has(key)) invalid(`unknown event field: ${key}`);
  if (typeof input.eventId !== 'string' || !UUID_RE.test(input.eventId)) invalid('eventId must be a UUID');
  if (typeof input.eventName !== 'string' || !ALLOWED_EVENT_NAMES.has(input.eventName) || !BROWSER_EVENT_NAMES.has(input.eventName)) {
    invalid('eventName is not permitted for browser events');
  }
  if (input.timestamp === undefined || typeof input.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(input.timestamp)
      || !hasValidCalendarDate(input.timestamp)) invalid('timestamp must be an ISO 8601 datetime with timezone');
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) invalid('timestamp must be a valid datetime');
  if (Math.abs(timestamp.getTime() - now) > 24 * 60 * 60 * 1000) invalid('timestamp must be within 24 hours of server time');
  if (input.schemaVersion !== 1) invalid('schemaVersion must be 1');
  const visitorId = validateOptionalId(input.visitorId, 'visitorId');
  const sessionId = validateOptionalId(input.sessionId, 'sessionId');
  if (!visitorId || !sessionId) invalid('visitorId and sessionId are required for browser events');
  const pageUrl = sanitizeUrl(input.pageUrl, 'pageUrl', true);
  const referrer = sanitizeUrl(input.referrer, 'referrer', false);
  const properties = validateProperties(input.properties);
  return {
    eventId: input.eventId,
    eventName: input.eventName,
    eventSource: 'browser',
    timestamp,
    visitorId,
    sessionId,
    pageUrl,
    referrer,
    properties,
    schemaVersion: 1
  };
}

export function validateServerEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('request body must be a JSON object');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 16 * 1024) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'event payload must not exceed 16 KB');
  for (const key of Object.keys(input)) if (!TOP_LEVEL_FIELDS.has(key)) invalid(`unknown event field: ${key}`);
  if (typeof input.eventId !== 'string' || input.eventId.length < 1 || input.eventId.length > 100) invalid('eventId must contain 1 to 100 characters');
  if (typeof input.eventName !== 'string' || !SERVER_EVENT_NAMES.has(input.eventName)) invalid('eventName is not permitted for server events');
  if (typeof input.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.timestamp)
      || !hasValidCalendarDate(input.timestamp)) invalid('timestamp must be a UTC ISO 8601 datetime');
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) invalid('timestamp must be a valid datetime');
  if (input.schemaVersion !== 1) invalid('schemaVersion must be 1');
  const visitorId = validateOptionalId(input.visitorId, 'visitorId');
  const sessionId = validateOptionalId(input.sessionId, 'sessionId');
  const properties = validateProperties(input.properties);
  if (input.eventName === 'order_created') {
    if (typeof properties.orderId !== 'string' || properties.orderId.length < 1) invalid('order_created requires properties.orderId');
    if (!Number.isInteger(properties.itemCount) || properties.itemCount < 1) invalid('order_created requires a positive integer properties.itemCount');
    if (typeof properties.totalAmount !== 'number' || properties.totalAmount < 0) invalid('order_created requires non-negative numeric properties.totalAmount');
  }
  return {
    eventId: input.eventId,
    eventName: input.eventName,
    eventSource: 'server',
    timestamp,
    visitorId,
    sessionId,
    pageUrl: null,
    referrer: null,
    properties,
    schemaVersion: 1
  };
}

export function buildServerEvent({ eventId, eventName, timestamp = new Date(), visitorId = null, sessionId = null, properties }) {
  if (!ALLOWED_EVENT_NAMES.has(eventName) || eventName === 'page_view') throw new Error('Invalid trusted server event name');
  if (eventName === 'order_created' && (!properties || typeof properties.orderId !== 'string')) {
    throw new Error('order_created requires an orderId');
  }
  return {
    eventId,
    eventName,
    eventSource: 'server',
    timestamp,
    visitorId,
    sessionId,
    pageUrl: null,
    referrer: null,
    properties,
    schemaVersion: 1
  };
}
