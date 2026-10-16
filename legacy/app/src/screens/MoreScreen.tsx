import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useMobileAuth } from '../context/MobileAuthContext';
import { apiRequest, pingApiServer } from '../services/api';
import { getTrackingState, subscribeTrackingState, LocationTrackingState } from '../services/locationService';
import { getOutboxQueue } from '../storage/db';
import { config, setCustomApiBaseUrl } from '../config';
import CollectScreen from './CollectScreen';

type MoreSubScreen = 'MENU' | 'COLLECTIONS' | 'ROUTE' | 'ATTENDANCE' | 'NOTIFICATIONS' | 'PROFILE' | 'SERVER';

export default function MoreScreen({
  initialSubScreen = 'MENU',
  onOpenCollectDirect,
}: {
  initialSubScreen?: MoreSubScreen;
  onOpenCollectDirect?: () => void;
}) {
  const { user, dutyStatus, logout, triggerSync, pendingSyncCount } = useMobileAuth();
  const [subScreen, setSubScreen] = useState<MoreSubScreen>(initialSubScreen);

  // Tracking state
  const [trackingState, setTrackingState] = useState<LocationTrackingState>(getTrackingState());

  // Attendance history
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    const unsub = subscribeTrackingState((st) => setTrackingState(st));
    return unsub;
  }, []);

  useEffect(() => {
    getOutboxQueue().then((q) => setQueueCount(q.length));
  }, [pendingSyncCount]);

  // Load Attendance
  const loadAttendance = async () => {
    try {
      setAttendanceLoading(true);
      const res = await apiRequest('/api/attendance/history');
      setAttendanceLogs(res.data || []);
    } catch (err) {
      console.warn('Failed to load attendance:', err);
    } finally {
      setAttendanceLoading(false);
    }
  };

  // Load Notifications
  const loadNotifications = async () => {
    try {
      setNotificationsLoading(true);
      const res = await apiRequest('/api/notifications');
      setNotifications(res.data || []);
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const handleOpenSub = (sub: MoreSubScreen) => {
    setSubScreen(sub);
    if (sub === 'ATTENDANCE') loadAttendance();
    if (sub === 'NOTIFICATIONS') loadNotifications();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await triggerSync();
      Alert.alert('Sync Finished', `Synced: ${res.syncedCount}, Pending/Failed: ${res.failedCount}`);
      const q = await getOutboxQueue();
      setQueueCount(q.length);
    } catch (e: any) {
      Alert.alert('Sync Offline', 'Cannot reach server. Will retry when connection returns.');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Signing out will terminate active duty tracking. Confirm sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  // NESTED: Collections
  if (subScreen === 'COLLECTIONS') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Collections & Receipts</Text>
        </View>
        <CollectScreen />
      </View>
    );
  }

  // NESTED: Today's Route
  if (subScreen === 'ROUTE') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Today's Route & GPS</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Tracking Status Card */}
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>GPS Tracking Status</Text>
              <View
                style={[
                  styles.badge,
                  dutyStatus === 'ON_DUTY' ? styles.badgeGreen : styles.badgeGrey,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    dutyStatus === 'ON_DUTY' ? styles.badgeTextGreen : styles.badgeTextGrey,
                  ]}
                >
                  {dutyStatus === 'ON_DUTY' ? '● RECORDING' : '○ PAUSED'}
                </Text>
              </View>
            </View>

            <View style={styles.gridStats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>ACCURACY</Text>
                <Text style={styles.statValue}>
                  {trackingState.accuracyMeters ? `±${Math.round(trackingState.accuracyMeters)}m` : 'Balanced'}
                </Text>
                <Text style={styles.statSub}>GPS Satellite Lock</Text>
              </View>

              <View style={styles.statBox}>
                <Text style={styles.statLabel}>EST. SPEED</Text>
                <Text style={styles.statValue}>
                  {trackingState.speedKmh ? `${trackingState.speedKmh} km/h` : '0 km/h'}
                </Text>
                <Text style={styles.statSub}>
                  {trackingState.isMoving ? 'Moving (15s ping)' : 'Stationary (60s)'}
                </Text>
              </View>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                Route breadcrumbs are securely collected during active duty sessions and buffered locally in case of cellular dropouts.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // NESTED: Attendance
  if (subScreen === 'ATTENDANCE') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Attendance History</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {attendanceLoading ? (
            <ActivityIndicator size="small" color="#081224" style={{ marginTop: 24 }} />
          ) : attendanceLogs.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No attendance sessions found</Text>
              <Text style={styles.emptySub}>Start your day on the Home tab to log attendance.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {attendanceLogs.map((log) => (
                <View key={log.id} style={styles.card}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardTitle}>
                      {new Date(log.date).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                    <View style={[styles.badge, styles.badgeGreen]}>
                      <Text style={[styles.badgeText, styles.badgeTextGreen]}>{log.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.logDetail}>
                    Start: {log.startTime ? new Date(log.startTime).toLocaleTimeString('en-IN') : 'N/A'}
                  </Text>
                  <Text style={styles.logDetail}>
                    End: {log.endTime ? new Date(log.endTime).toLocaleTimeString('en-IN') : 'In progress'}
                  </Text>
                  {log.totalHours ? (
                    <Text style={styles.logHours}>Total Hours: {log.totalHours.toFixed(1)} hrs</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // NESTED: Notifications
  if (subScreen === 'NOTIFICATIONS') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>In-App Notifications</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {notificationsLoading ? (
            <ActivityIndicator size="small" color="#081224" style={{ marginTop: 24 }} />
          ) : notifications.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySub}>Order approvals and expense alerts will appear here.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {notifications.map((n) => (
                <View key={n.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{n.title}</Text>
                  <Text style={styles.logDetail}>{n.message}</Text>
                  <Text style={styles.notifTime}>
                    {new Date(n.createdAt).toLocaleString('en-IN')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // NESTED: Profile
  if (subScreen === 'PROFILE') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Staff Profile & Session</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Profile Card */}
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.name?.slice(0, 2).toUpperCase() || 'SP'}</Text>
            </View>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userCode}>{user?.employeeCode} • {user?.territory}</Text>
            <Text style={styles.userContact}>{user?.phone} • {user?.email}</Text>
          </View>

          {/* Sync Outbox Card */}
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>Offline Outbox Queue</Text>
              <Text style={styles.queueCountText}>{queueCount} pending</Text>
            </View>
            <Text style={styles.logDetail}>
              Durable offline queue stores orders, payment collections, and GPS breadcrumbs for upload.
            </Text>
            <TouchableOpacity style={styles.syncBtn} onPress={handleSync} disabled={syncing}>
              {syncing ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.syncBtnText}>Force Synchronize Now</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Sign Out Button */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>Sign Out of Mobile App</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // NESTED: Server Settings & Diagnostics
  if (subScreen === 'SERVER') {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSubScreen('MENU')}>
            <Text style={styles.backBtnText}>← Back to More</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Server Connection & Diagnostics</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Active Config Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Active Backend Endpoint</Text>
            <View style={styles.urlBox}>
              <Text style={styles.urlText}>{config.apiBaseUrl}</Text>
            </View>
            <Text style={styles.logDetail}>
              All mobile API requests, GPS sync batches, and media uploads route through this endpoint.
            </Text>

            <TouchableOpacity
              style={[styles.syncBtn, { marginTop: 14 }]}
              onPress={async () => {
                setSyncing(true);
                try {
                  const ping = await pingApiServer();
                  Alert.alert(
                    ping.ok ? '🟢 Server Online' : '🔴 Server Unreachable',
                    `${ping.message}\nVersion: ${ping.version || 'unknown'}`
                  );
                } catch (err: any) {
                  Alert.alert('Connection Failed', err.message);
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.syncBtnText}>Ping Health Check (/api/health)</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Quick Presets */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Switch Environment Preset</Text>
            <Text style={[styles.logDetail, { marginBottom: 12 }]}>
              Change local development target or connect directly to staging/production server.
            </Text>

            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={styles.presetOption}
                onPress={async () => {
                  await setCustomApiBaseUrl('http://localhost:4000');
                  Alert.alert('Server Updated', 'Target set to http://localhost:4000');
                }}
              >
                <Text style={styles.presetOptionTitle}>💻 Local Machine (localhost:4000)</Text>
                <Text style={styles.presetOptionSub}>For Web Browser & iOS Simulator</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.presetOption}
                onPress={async () => {
                  await setCustomApiBaseUrl('http://10.0.2.2:4000');
                  Alert.alert('Server Updated', 'Target set to http://10.0.2.2:4000');
                }}
              >
                <Text style={styles.presetOptionTitle}>🤖 Android Emulator (10.0.2.2:4000)</Text>
                <Text style={styles.presetOptionSub}>Special loopback for Android Studio</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // MAIN MORE MENU
  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>More Actions</Text>
        <Text style={styles.headerSubtitle}>Field Operations & Account Tools</Text>
      </View>

      <ScrollView contentContainerStyle={styles.menuScroll}>
        {/* Menu Items */}
        <View style={styles.menuSection}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleOpenSub('COLLECTIONS')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#E6F4DD' }]}>
                <Text style={styles.menuIcon}>💳</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Collections & Receipts</Text>
                <Text style={styles.menuItemSub}>Cash & UPI verification history</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleOpenSub('ROUTE')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#EFF6FF' }]}>
                <Text style={styles.menuIcon}>📍</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Today's Route & GPS</Text>
                <Text style={styles.menuItemSub}>Breadcrumb log & accuracy status</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleOpenSub('ATTENDANCE')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#FEF3C7' }]}>
                <Text style={styles.menuIcon}>⏱️</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Attendance History</Text>
                <Text style={styles.menuItemSub}>Shift times & total duty hours</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleOpenSub('NOTIFICATIONS')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#F3E8FF' }]}>
                <Text style={styles.menuIcon}>🔔</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Notifications</Text>
                <Text style={styles.menuItemSub}>Approvals, settlements, and alerts</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleOpenSub('SERVER')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#F0FDF4' }]}>
                <Text style={styles.menuIcon}>⚙️</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Server & Diagnostics</Text>
                <Text style={styles.menuItemSub}>Ping health check & endpoints</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { borderBottomWidth: 0 }]}
            onPress={() => handleOpenSub('PROFILE')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconBox, { backgroundColor: '#F5F7F8' }]}>
                <Text style={styles.menuIcon}>👤</Text>
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Staff Profile & Sync</Text>
                <Text style={styles.menuItemSub}>{user?.name} ({user?.employeeCode})</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Duty Status Quick Info Banner */}
        <View style={styles.dutyCard}>
          <View style={styles.cardRow}>
            <Text style={styles.dutyCardTitle}>Active Shift Status</Text>
            <View
              style={[
                styles.badge,
                dutyStatus === 'ON_DUTY' ? styles.badgeGreen : styles.badgeGrey,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  dutyStatus === 'ON_DUTY' ? styles.badgeTextGreen : styles.badgeTextGrey,
                ]}
              >
                {dutyStatus === 'ON_DUTY' ? 'ON DUTY' : 'OFF DUTY'}
              </Text>
            </View>
          </View>
          <Text style={styles.dutyCardSub}>
            Start or End Day controls are available on the Home tab.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F8',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1320',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#586570',
    marginTop: 2,
  },
  subHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
  },
  backBtn: {
    paddingVertical: 4,
  },
  backBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#081224',
  },
  subHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1320',
    marginTop: 4,
  },
  menuScroll: {
    padding: 16,
  },
  menuSection: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    overflow: 'hidden',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F3F5',
    minHeight: 52,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 18,
  },
  menuItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1320',
  },
  menuItemSub: {
    fontSize: 11,
    color: '#586570',
    marginTop: 1,
  },
  chevron: {
    fontSize: 18,
    color: '#8C9BA5',
    fontWeight: '700',
  },
  scroll: {
    padding: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1320',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeGreen: {
    backgroundColor: '#E6F4DD',
    borderColor: '#B4E39C',
  },
  badgeTextGreen: {
    color: '#2E6819',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeGrey: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  badgeTextGrey: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  gridStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F5F7F8',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 10,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#586570',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0B1320',
    marginTop: 2,
  },
  statSub: {
    fontSize: 9,
    color: '#8C9BA5',
    marginTop: 2,
  },
  infoBox: {
    backgroundColor: '#F5F7F8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 10,
    marginTop: 12,
  },
  infoText: {
    fontSize: 11,
    color: '#586570',
    lineHeight: 16,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 30,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1320',
  },
  emptySub: {
    fontSize: 12,
    color: '#586570',
    marginTop: 4,
    textAlign: 'center',
  },
  logDetail: {
    fontSize: 12,
    color: '#586570',
    marginTop: 2,
  },
  logHours: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E6819',
    marginTop: 4,
  },
  notifTime: {
    fontSize: 10,
    color: '#8C9BA5',
    marginTop: 4,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1320',
  },
  userCode: {
    fontSize: 12,
    color: '#586570',
    marginTop: 2,
  },
  userContact: {
    fontSize: 11,
    color: '#8C9BA5',
    marginTop: 2,
  },
  queueCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#081224',
  },
  syncBtn: {
    backgroundColor: '#081224',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  syncBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  logoutBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  logoutBtnText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  dutyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 16,
  },
  dutyCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1320',
  },
  dutyCardSub: {
    fontSize: 11,
    color: '#586570',
    marginTop: 4,
  },
  urlBox: {
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  urlText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1320',
  },
  presetOption: {
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  presetOptionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1320',
  },
  presetOptionSub: {
    fontSize: 11,
    color: '#586570',
    marginTop: 2,
  },
});
