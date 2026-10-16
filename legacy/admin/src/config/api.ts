/**
 * Centralized API and Real-time configuration for Admin Frontend
 */

const sanitizeUrl = (url?: string): string => {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
};

// In Next.js, if API_URL or NEXT_PUBLIC_API_URL is configured, rewrites proxy /api requests.
// For direct cross-origin calls, NEXT_PUBLIC_API_URL provides the explicit base origin.
export const API_BASE_URL = sanitizeUrl(process.env.NEXT_PUBLIC_API_URL);

// Socket.IO server URL (typically identical to API host, but can be a dedicated real-time cluster)
export const SOCKET_URL =
  sanitizeUrl(process.env.NEXT_PUBLIC_SOCKET_URL) ||
  API_BASE_URL ||
  'http://localhost:4000';

/**
 * Returns a fully resolved URL or normalized path for API requests.
 * By default, uses relative '/api' paths to leverage Next.js reverse proxy rewrites,
 * or prepends API_BASE_URL if direct cross-origin communication is desired.
 */
export function getApiUrl(path: string, options?: { direct?: boolean }): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (options?.direct && API_BASE_URL) {
    return `${API_BASE_URL}${normalizedPath}`;
  }

  return normalizedPath;
}
