import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useMobileAuth } from '../context/MobileAuthContext';
import { getOutboxQueue } from '../storage/db';
import { SyncQueueItem } from '../shared';

export default function ProfileScreen() {
  const { user, dutyStatus, logout, triggerSync, pendingSyncCount } = useMobileAuth();
  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadQueue = async () => {
    const q = await getOutboxQueue();
    setQueueItems(q);
  };

  useEffect(() => {
    loadQueue();
  }, [pendingSyncCount]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await triggerSync();
      Alert.alert('Sync Finished', `Synced: ${res.syncedCount}, Pending/Failed: ${res.failedCount}`);
      loadQueue();
    } catch (e: any) {
      Alert.alert('Sync Offline', 'Cannot reach server. Will retry when connection returns.');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Signing out will terminate active tracking. Confirm sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const isOnDuty = dutyStatus === 'ON_DUTY';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.slice(0, 2).toUpperCase() || 'SP'}</Text>
        </View>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userCode}>{user?.employeeCode} • {user?.territory}</Text>
        <Text style={styles.userContact}>{user?.phone} • {user?.email}</Text>

        <View style={[styles.dutyBadge, isOnDuty ? styles.dutyOn : styles.dutyOff]}>
          <Text style={[styles.dutyText, isOnDuty ? styles.dutyTextOn : styles.dutyTextOff]}>
            STATUS: {dutyStatus}
          </Text>
        </View>
      </View>

      {/* Offline Outbox Queue Section (Section 28) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>DURABLE OFFLINE SYNC QUEUE</Text>
          <TouchableOpacity onPress={handleSync} disabled={syncing} style={styles.syncBtn}>
            {syncing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.syncBtnText}>Sync All ({queueItems.length})</Text>
            )}
          </TouchableOpacity>
        </View>

        {queueItems.length === 0 ? (
          <Text style={styles.emptyText}>All field records synchronized with server.</Text>
        ) : (
          <View style={styles.queueList}>
            {queueItems.map((item) => (
              <View key={item.id} style={styles.queueItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.queueType}>{item.type}</Text>
                  <Text style={styles.queueMeta}>
                    {new Date(item.createdAt).toLocaleTimeString()} • Retries: {item.retryCount}
                  </Text>
                  {item.lastError ? (
                    <Text style={styles.queueError} numberOfLines={1}>
                      {item.lastError}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    item.status === 'SYNCED'
                      ? styles.statusSynced
                      : item.status === 'FAILED'
                      ? styles.statusFailed
                      : styles.statusPending,
                  ]}
                >
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Location Transparency Disclosure (Section 26) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>GPS TRACKING & PRIVACY POLICY</Text>
        <Text style={styles.policyText}>
          • FieldTrack records periodic GPS coordinates only while you are actively ON DUTY.{'\n'}
          • When you tap "End Day", active location tracking terminates immediately.{'\n'}
          • Locations are used solely for route distance calculation, client visit verification, and territory operations.
        </Text>
      </View>

      {/* Sign Out Button */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutBtnText}>Sign Out of Field Device</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0f766e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  userCode: {
    fontSize: 12,
    color: '#0f766e',
    fontWeight: '600',
    marginTop: 2,
  },
  userContact: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  dutyBadge: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  dutyOn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  dutyOff: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  dutyText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  dutyTextOn: {
    color: '#065f46',
  },
  dutyTextOff: {
    color: '#64748b',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  syncBtn: {
    backgroundColor: '#0f766e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  syncBtnText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  emptyText: {
    fontSize: 12,
    color: '#059669',
    fontStyle: 'italic',
  },
  queueList: {
    gap: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  queueType: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  queueMeta: {
    fontSize: 10,
    color: '#64748b',
  },
  queueError: {
    fontSize: 10,
    color: '#dc2626',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusSynced: {
    backgroundColor: '#ecfdf5',
  },
  statusFailed: {
    backgroundColor: '#fee2e2',
  },
  statusText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#334155',
  },
  policyText: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 18,
    marginTop: 6,
  },
  logoutBtn: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
