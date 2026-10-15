import { init } from '@analytics-platform/browser-sdk';
import { API_BASE_URL } from './api.js';

// One module-level client; App reports router transitions to avoid SDK/router double counts.
export const analytics = init({
  endpoint: `${API_BASE_URL}/api/events`,
  autoTrackPageViews: false
});
