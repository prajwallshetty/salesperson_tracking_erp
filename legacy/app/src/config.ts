import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Strip trailing slashes to prevent malformed endpoint paths
export const sanitizeUrl = (url?: string): string => {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
};

const rawEnvUrl = process.env.EXPO_PUBLIC_API_URL;
const defaultHost = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
let activeApiUrl = sanitizeUrl(rawEnvUrl) || defaultHost;

// In web production builds, alert if client bundle references localhost on a public domain
if (
  typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'
) {
  if (
    activeApiUrl.includes('localhost') ||
    activeApiUrl.includes('127.0.0.1') ||
    activeApiUrl.includes('10.0.2.2')
  ) {
    console.warn(
      `[APP CONFIG WARNING] Running on remote origin (${window.location.origin}), but EXPO_PUBLIC_API_URL points to "${activeApiUrl}". Set EXPO_PUBLIC_API_URL in your production hosting settings or configure server URL in-app.`
    );
  }
}

export async function initApiBaseUrl(): Promise<string> {
  try {
    const customUrl = await AsyncStorage.getItem('@erp_custom_api_url');
    if (customUrl) {
      activeApiUrl = sanitizeUrl(customUrl);
    }
  } catch (e) {
    // Ignore storage errors on initial boot
  }
  return activeApiUrl;
}

export async function setCustomApiBaseUrl(url: string): Promise<string> {
  const sanitized = sanitizeUrl(url);
  if (!sanitized) {
    await AsyncStorage.removeItem('@erp_custom_api_url');
    activeApiUrl = sanitizeUrl(rawEnvUrl) || defaultHost;
  } else {
    await AsyncStorage.setItem('@erp_custom_api_url', sanitized);
    activeApiUrl = sanitized;
  }
  return activeApiUrl;
}

export async function getApiBaseUrl(): Promise<string> {
  return activeApiUrl;
}

export const config = {
  get apiBaseUrl() {
    return activeApiUrl;
  },
  set apiBaseUrl(val: string) {
    activeApiUrl = sanitizeUrl(val);
  },
  defaultHost,
  rawEnvUrl: sanitizeUrl(rawEnvUrl),
  defaultTimezone: process.env.EXPO_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata',
  trackingIntervalMs: 60 * 1000,
  minTrackingDistanceMeters: 10,
  visitRadiusMeters: 100,
};


