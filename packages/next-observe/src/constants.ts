// 127.0.0.1, not localhost: Node may resolve localhost to ::1 while the collector listens on IPv4.
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
export const DEFAULT_SERVICE_NAME = 'next-app'
/** Same-origin path the browser exports to; withObserve() rewrites it to the collector. */
export const BROWSER_PROXY_PATH = '/__observe'
/** Where withObserve() sends /__observe/* when the app has the opt-in proxy route (next-observe/proxy). */
export const PROXY_ROUTE_PATH = '/api/next-observe'
