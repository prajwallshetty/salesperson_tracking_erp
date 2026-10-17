'use client';

import { closeTopOverlay, hasOverlay } from '@/lib/client/overlayStack';
import { decideBack } from './logic';

/** Lifecycle events the lock screen listens to (dispatched on window). */
export const APP_PAUSE_EVENT = 'salesgrid:app-pause';
export const APP_RESUME_EVENT = 'salesgrid:app-resume';

let started = false;

/** Android shell wiring. Called once, only inside the native app. */
export async function startNativeBridge(): Promise<{ build: string; version: string }> {
  const [{ App }, { SplashScreen }] = await Promise.all([import('@capacitor/app'), import('@capacitor/splash-screen')]);

  if (!started) {
    started = true;
    // Registering a listener replaces Android's default (which would exit the app on the first page).
    await App.addListener('backButton', ({ canGoBack }) => {
      const action = decideBack({ pathname: window.location.pathname, overlayOpen: hasOverlay(), canGoBack });
      if (action === 'close-overlay') closeTopOverlay();
      else if (action === 'history-back') window.history.back();
      else void App.minimizeApp(); // minimise, never exit: an open shift keeps tracking
    });
    await App.addListener('pause', () => window.dispatchEvent(new Event(APP_PAUSE_EVENT)));
    await App.addListener('resume', () => window.dispatchEvent(new Event(APP_RESUME_EVENT)));
  }
  await SplashScreen.hide().catch(() => undefined);
  const info = await App.getInfo();
  return { build: info.build, version: info.version };
}
