import { randomUUID } from 'node:crypto';

export function requestContext(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.log = {
    error: (details, message) => console.error(JSON.stringify({ level: 'error', ...details, message }))
  };
  next();
}
