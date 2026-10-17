import { describe, it, expect } from 'vitest';
import { decideBack, shouldLock, isBelowMinimumBuild, LOCK_AFTER_BACKGROUND_MS } from '@/lib/native/logic';
import { pushOverlay, hasOverlay, closeTopOverlay } from '@/lib/client/overlayStack';
import { devQuickLoginEnabled } from '@/lib/auth/devLogin';

describe('Android back button', () => {
  it('closes an open sheet before anything else', () => {
    expect(decideBack({ pathname: '/field', overlayOpen: true, canGoBack: true })).toBe('close-overlay');
  });
  it('minimises (never exits) on home screens so an open shift keeps tracking', () => {
    for (const p of ['/', '/login', '/field', '/field/', '/dashboard']) {
      expect(decideBack({ pathname: p, overlayOpen: false, canGoBack: true })).toBe('minimize');
    }
  });
  it('navigates back inside the app, and minimises when there is no history', () => {
    expect(decideBack({ pathname: '/field/orders', overlayOpen: false, canGoBack: true })).toBe('history-back');
    expect(decideBack({ pathname: '/orders', overlayOpen: false, canGoBack: false })).toBe('minimize');
  });
});

describe('overlay stack', () => {
  it('closes the topmost overlay first and unregisters cleanly', () => {
    const closed: string[] = [];
    const popA = pushOverlay(() => closed.push('a'));
    const popB = pushOverlay(() => closed.push('b'));
    expect(hasOverlay()).toBe(true);
    expect(closeTopOverlay()).toBe(true);
    expect(closed).toEqual(['b']);
    popB();
    popA();
    expect(hasOverlay()).toBe(false);
    expect(closeTopOverlay()).toBe(false);
  });
});

describe('biometric lock timing', () => {
  const now = 10_000_000;
  it('never locks when the user has not enabled it', () => {
    expect(shouldLock({ enabled: false, coldStart: true, backgroundedAt: 0, now })).toBe(false);
  });
  it('locks on a cold start and after 5 minutes in the background only', () => {
    expect(shouldLock({ enabled: true, coldStart: true, backgroundedAt: null, now })).toBe(true);
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - LOCK_AFTER_BACKGROUND_MS + 1000, now })).toBe(false);
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - LOCK_AFTER_BACKGROUND_MS, now })).toBe(true);
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: null, now })).toBe(false);
  });
});

describe('update-required gate', () => {
  it('blocks only builds known to be older than the configured minimum', () => {
    expect(isBelowMinimumBuild('3', 5)).toBe(true);
    expect(isBelowMinimumBuild('5', 5)).toBe(false);
    expect(isBelowMinimumBuild('7', null)).toBe(false);
    expect(isBelowMinimumBuild(undefined, 5)).toBe(false);
    expect(isBelowMinimumBuild('not-a-number', 5)).toBe(false);
  });
});

describe('development quick login', () => {
  it('requires DEV_QUICK_LOGIN=true and is always off in production', () => {
    expect(devQuickLoginEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(devQuickLoginEnabled({ NODE_ENV: 'development', DEV_QUICK_LOGIN: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(devQuickLoginEnabled({ NODE_ENV: 'production', DEV_QUICK_LOGIN: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
