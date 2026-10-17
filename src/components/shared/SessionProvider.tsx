'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { hasPermission as checkPermission, hasRole as checkRole, type ManagerPermissionKey, type Role } from '@/lib/permissions';
import type { ClientUser } from '@/lib/auth/server';
import DeviceLock from '@/components/native/DeviceLock';
import { clearDeviceSession } from '@/lib/native/deviceSession';

interface SessionContextValue {
  user: ClientUser | null;
  /** Legacy pages used `token` as a "logged in" guard; the real token lives in an httpOnly cookie. */
  token: string | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  /** Ends every session of this user on every device. Throws if the server did not confirm it. */
  logoutEverywhere: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  hasPermission: (perm: ManagerPermissionKey) => boolean;
  refreshUser: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export function SessionProvider({ initialUser, children }: { initialUser: ClientUser | null; children: React.ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(initialUser);

  const refreshUser = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) setUser((await res.json()).user);
    else if (res.status === 401) setUser(null);
  }, []);

  // Sliding session renewal while the app is open.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' }).then((r) => {
        if (r.status === 401) window.location.assign('/login?expired=1');
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user]);

  const userId = user?.id;
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      await clearDeviceSession(userId);
      setUser(null);
      window.location.assign('/login');
    }
  }, [userId]);

  const logoutEverywhere = useCallback(async () => {
    const res = await fetch('/api/auth/logout-all', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok && res.status !== 401) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not sign out of other devices. Please try again.');
    }
    await clearDeviceSession(userId, { everywhere: true });
    setUser(null);
    window.location.assign('/login');
  }, [userId]);

  const value: SessionContextValue = {
    user,
    token: user ? 'session' : null,
    isLoading: false,
    logout,
    logoutEverywhere,
    hasRole: (...roles) => checkRole(user, ...roles),
    hasPermission: (perm) => checkPermission(user, perm),
    refreshUser,
  };
  return (
    <SessionContext.Provider value={value}>
      {children}
      {user && <DeviceLock userId={user.id} onSignOut={logout} />}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

/** Name kept from the legacy admin AuthContext so ported pages read naturally. */
export const useAuth = useSession;
