import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, syncOutbox } from '../services/api';
import { startDutyTracking, stopDutyTracking } from '../services/locationService';
import { clearUserSessionData, getOutboxQueue } from '../storage/db';

export interface MobileUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  salespersonId?: string;
  employeeCode?: string;
  territory?: string;
}

interface MobileAuthContextType {
  user: MobileUser | null;
  token: string | null;
  dutyStatus: 'ON_DUTY' | 'OFF_DUTY';
  pendingSyncCount: number;
  isLoading: boolean;
  login: (token: string, user: MobileUser, initialDuty?: 'ON_DUTY' | 'OFF_DUTY') => Promise<void>;
  logout: () => Promise<void>;
  setDutyStatus: (status: 'ON_DUTY' | 'OFF_DUTY') => Promise<void>;
  triggerSync: () => Promise<{ syncedCount: number; failedCount: number }>;
}

const MobileAuthContext = createContext<MobileAuthContextType | undefined>(undefined);

export function MobileAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [dutyStatus, setDutyStatusState] = useState<'ON_DUTY' | 'OFF_DUTY'>('OFF_DUTY');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const refreshPendingCount = async () => {
    const queue = await getOutboxQueue();
    const count = queue.filter((i) => i.status === 'PENDING' || i.status === 'FAILED').length;
    setPendingSyncCount(count);
  };

  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const storedToken = await AsyncStorage.getItem('@erp_auth_token');
        const storedUser = await AsyncStorage.getItem('@erp_user_profile');
        const storedDuty = await AsyncStorage.getItem('@erp_duty_status');

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          const duty = (storedDuty as any) || 'OFF_DUTY';
          setDutyStatusState(duty);

          if (duty === 'ON_DUTY') {
            startDutyTracking();
          }
        }
        await refreshPendingCount();
      } catch (e) {
        console.error('Failed to load mobile auth:', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadStoredAuth();
  }, []);

  const login = async (newToken: string, newUser: MobileUser, initialDuty: 'ON_DUTY' | 'OFF_DUTY' = 'OFF_DUTY') => {
    setToken(newToken);
    setUser(newUser);
    setDutyStatusState(initialDuty);

    await AsyncStorage.setItem('@erp_auth_token', newToken);
    await AsyncStorage.setItem('@erp_user_profile', JSON.stringify(newUser));
    await AsyncStorage.setItem('@erp_duty_status', initialDuty);

    if (initialDuty === 'ON_DUTY') {
      startDutyTracking();
    }
    await refreshPendingCount();
  };

  const logout = async () => {
    stopDutyTracking();
    await clearUserSessionData();
    setToken(null);
    setUser(null);
    setDutyStatusState('OFF_DUTY');
    setPendingSyncCount(0);
  };

  const setDutyStatus = async (status: 'ON_DUTY' | 'OFF_DUTY') => {
    setDutyStatusState(status);
    await AsyncStorage.setItem('@erp_duty_status', status);

    if (status === 'ON_DUTY') {
      startDutyTracking();
    } else {
      stopDutyTracking();
    }
  };

  const triggerSync = async () => {
    const result = await syncOutbox();
    await refreshPendingCount();
    return result;
  };

  return (
    <MobileAuthContext.Provider
      value={{
        user,
        token,
        dutyStatus,
        pendingSyncCount,
        isLoading,
        login,
        logout,
        setDutyStatus,
        triggerSync,
      }}
    >
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const context = useContext(MobileAuthContext);
  if (!context) throw new Error('useMobileAuth must be used within MobileAuthProvider');
  return context;
}
