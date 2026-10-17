import type { CapacitorConfig } from '@capacitor/cli';

/**
 * SalesGrid Android shell — "hosted" mode: the WebView loads the deployed SalesGrid server
 * (SALESGRID_SERVER_URL), so web UI changes ship by deploying the server, without a new APK.
 * The server URL is baked into the APK at `cap sync` time; changing it needs a new build.
 */
const raw = process.env.SALESGRID_SERVER_URL;
if (!raw) {
  throw new Error('Set SALESGRID_SERVER_URL to the deployed SalesGrid URL, e.g. SALESGRID_SERVER_URL=https://salesgrid.yourcompany.com');
}
const server = new URL(raw);
const allowHttp = process.env.SALESGRID_ALLOW_HTTP === 'true';
if (server.protocol !== 'https:' && !allowHttp) {
  throw new Error('SALESGRID_SERVER_URL must use https:// (set SALESGRID_ALLOW_HTTP=true only for a local development build).');
}

const config: CapacitorConfig = {
  appId: 'com.salesgrid.app',
  appName: 'SalesGrid',
  webDir: 'www',
  server: {
    url: `${server.origin}/`,
    androidScheme: 'https',
    // Cleartext only for an explicit local development build against http://<LAN-IP>:3000.
    cleartext: server.protocol === 'http:' && allowHttp,
    // Shown (without plugin access) when the server cannot be reached at launch.
    errorPath: 'offline.html',
  },
  android: {
    appendUserAgent: 'SalesGridAndroid',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: '#081224',
      showSpinner: false,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
};

export default config;
