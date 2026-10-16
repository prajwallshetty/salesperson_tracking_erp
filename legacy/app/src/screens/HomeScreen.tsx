import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { useMobileAuth } from '../context/MobileAuthContext';
import { apiRequest } from '../services/api';
import { getCurrentCoordinates } from '../services/locationService';
import { enqueueOperation } from '../storage/db';

interface HomeScreenProps {
  onNavigateTab: (tab: 'Home' | 'Clients' | 'Orders' | 'Expenses' | 'More' | 'Collect') => void;
}

export default function HomeScreen({ onNavigateTab }: HomeScreenProps) {
  const { user, dutyStatus, setDutyStatus, pendingSyncCount, triggerSync } = useMobileAuth();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dutyActionLoading, setDutyActionLoading] = useState(false);

  // Daily Summary Modal (Section 34)
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [dailySummary, setDailySummary] = useState<any>(null);

  const fetchDashboard = async () => {
    try {
      const res = await apiRequest('/api/salespersons/dashboard');
      setDashboardData(res);
      if (res.dutyStatus && res.dutyStatus !== dutyStatus) {
        setDutyStatus(res.dutyStatus);
      }
    } catch (e) {
      console.warn('Dashboard fetch offline fallback');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleStartDay = async () => {
    setDutyActionLoading(true);
    try {
      const coords = await getCurrentCoordinates();
      try {
        await apiRequest('/api/attendance/start', {
          method: 'POST',
          body: JSON.stringify({
            latitude: coords?.latitude,
            longitude: coords?.longitude,
            idempotencyKey: `start-day-${Date.now()}`,
          }),
        });
      } catch (networkErr) {
        // Enqueue offline START_DAY
        await enqueueOperation('START_DAY', {
          latitude: coords?.latitude,
          longitude: coords?.longitude,
          timestamp: new Date().toISOString(),
        });
      }

      await setDutyStatus('ON_DUTY');
      Alert.alert('Duty Started', 'You are now ON DUTY. Background route tracking is activated.');
      fetchDashboard();
    } catch (err: any) {
      Alert.alert('Start Day Error', err.message || 'Unable to start shift');
    } finally {
      setDutyActionLoading(false);
    }
  };

  const handleEndDay = async () => {
    setDutyActionLoading(true);
    try {
      const coords = await getCurrentCoordinates();
      let summaryData: any = null;

      try {
        const res = await apiRequest('/api/attendance/end', {
          method: 'POST',
          body: JSON.stringify({
            latitude: coords?.latitude,
            longitude: coords?.longitude,
          }),
        });
        summaryData = res.data;
      } catch (networkErr) {
        // Fallback summary if offline
        summaryData = {
          workingTimeFormatted: 'Session Ended Offline',
          distanceKm: 0,
          clientsVisited: dashboardData?.clientsVisited || 0,
          ordersCount: dashboardData?.ordersCount || 0,
          totalSales: dashboardData?.todaySales || 0,
          verifiedCollections: dashboardData?.verifiedCollections || 0,
          pendingCollections: dashboardData?.pendingCollections || 0,
        };
        await enqueueOperation('END_DAY', {
          latitude: coords?.latitude,
          longitude: coords?.longitude,
          timestamp: new Date().toISOString(),
        });
      }

      await setDutyStatus('OFF_DUTY');
      setDailySummary(summaryData);
      setShowSummaryModal(true);
      fetchDashboard();
    } catch (err: any) {
      Alert.alert('End Day Error', err.message || 'Unable to end shift');
    } finally {
      setDutyActionLoading(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const { syncedCount, failedCount } = await triggerSync();
      Alert.alert('Sync Finished', `Synced: ${syncedCount}, Pending/Failed: ${failedCount}`);
      fetchDashboard();
    } catch (err: any) {
      Alert.alert('Sync Offline', 'Network unavailable. Offline records remain securely queued.');
    } finally {
      setSyncing(false);
    }
  };

  const isOnDuty = dutyStatus === 'ON_DUTY';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Greeting */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good Morning, {user?.name?.split(' ')[0] || 'Rahul'}</Text>
          <Text style={styles.territory}>
            {user?.employeeCode || 'EMP-001'} • {user?.territory || 'Mangalore North'}
          </Text>
        </View>
        <View style={[styles.dutyPill, isOnDuty ? styles.dutyPillOn : styles.dutyPillOff]}>
          <View style={[styles.dutyDot, isOnDuty ? styles.dutyDotOn : styles.dutyDotOff]} />
          <Text style={[styles.dutyText, isOnDuty ? styles.dutyTextOn : styles.dutyTextOff]}>
            {isOnDuty ? 'ON DUTY' : 'OFF DUTY'}
          </Text>
        </View>
      </View>

      {/* Sync Status Alert Banner */}
      {pendingSyncCount > 0 ? (
        <View style={styles.syncBanner}>
          <Text style={styles.syncBannerText}>
            {pendingSyncCount} record{pendingSyncCount > 1 ? 's' : ''} queued offline
          </Text>
          <TouchableOpacity onPress={handleManualSync} disabled={syncing} style={styles.syncBtn}>
            {syncing ? (
              <ActivityIndicator size="small" color="#0f766e" />
            ) : (
              <Text style={styles.syncBtnText}>Sync Now</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Today's Metrics Card (Section 4) */}
      <View style={styles.metricsCard}>
        <Text style={styles.sectionTitle}>TODAY'S FIELD PERFORMANCE</Text>

        <View style={styles.metricRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Today's Sales</Text>
            <Text style={styles.metricValueLarge}>
              ₹{(dashboardData?.todaySales || 0).toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Orders</Text>
            <Text style={styles.metricValueLarge}>{dashboardData?.ordersCount || 0}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.gridRow}>
          <View style={styles.gridCol}>
            <Text style={styles.gridLabel}>Verified Collections</Text>
            <Text style={styles.gridValueGreen}>
              ₹{(dashboardData?.verifiedCollections || 0).toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.gridCol}>
            <Text style={styles.gridLabel}>Clients Visited</Text>
            <Text style={styles.gridValue}>
              {dashboardData?.clientsVisited || 0} / {dashboardData?.totalAssignedClients || 0}
            </Text>
          </View>
          <View style={styles.gridCol}>
            <Text style={styles.gridLabel}>Pending Coll.</Text>
            <Text style={styles.gridValueAmber}>
              ₹{(dashboardData?.pendingCollections || 0).toLocaleString('en-IN')}
            </Text>
          </View>
        </View>
      </View>

      {/* Primary Action Buttons (Start / End Day and Collect Payment) */}
      <View style={{ gap: 10 }}>
        <TouchableOpacity
          style={[styles.primaryActionBtn, isOnDuty ? styles.endDayBtn : styles.startDayBtn]}
          onPress={isOnDuty ? handleEndDay : handleStartDay}
          disabled={dutyActionLoading}
        >
          {dutyActionLoading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.primaryActionBtnText}>
              {isOnDuty ? 'End Day & Close Shift' : 'Start Day (Enable GPS Tracking)'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.collectPaymentActionBtn}
          onPress={() => onNavigateTab('Collect')}
          activeOpacity={0.8}
        >
          <Text style={styles.collectPaymentActionBtnText}>💳 Collect Customer Payment</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Action Buttons (Section 4) */}
      <Text style={[styles.sectionTitle, { marginTop: 24, marginBottom: 12 }]}>QUICK ACTIONS</Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity style={styles.actionCard} onPress={() => onNavigateTab('Clients')}>
          <Text style={styles.actionCardTitle}>My Clients</Text>
          <Text style={styles.actionCardSub}>
            {dashboardData?.totalAssignedClients || 0} assigned accounts
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => onNavigateTab('Orders')}>
          <Text style={styles.actionCardTitle}>New Order</Text>
          <Text style={styles.actionCardSub}>Product catalog & cart</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => onNavigateTab('Expenses')}>
          <Text style={styles.actionCardTitle}>Staff Expenses</Text>
          <Text style={styles.actionCardSub}>Travel, meals, fuel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => onNavigateTab('More')}>
          <Text style={styles.actionCardTitle}>More Tools</Text>
          <Text style={styles.actionCardSub}>Route, attendance, settings</Text>
        </TouchableOpacity>
      </View>

      {/* Daily Summary Modal (Section 34) */}
      <Modal visible={showSummaryModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>TODAY'S SUMMARY</Text>
            <Text style={styles.summarySubtitle}>Official shift work achievements</Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Working Time</Text>
              <Text style={styles.summaryValue}>{dailySummary?.workingTimeFormatted || '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Distance Travelled</Text>
              <Text style={styles.summaryValue}>{dailySummary?.distanceKm || 0} KM</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Clients Visited</Text>
              <Text style={styles.summaryValue}>{dailySummary?.clientsVisited || 0}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Orders Booked</Text>
              <Text style={styles.summaryValue}>{dailySummary?.ordersCount || 0}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Sales</Text>
              <Text style={styles.summaryValueBold}>₹{(dailySummary?.totalSales || 0).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Verified Collection</Text>
              <Text style={styles.summaryValueGreen}>₹{(dailySummary?.verifiedCollections || 0).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Pending Collection</Text>
              <Text style={styles.summaryValueAmber}>₹{(dailySummary?.pendingCollections || 0).toLocaleString('en-IN')}</Text>
            </View>

            <TouchableOpacity
              style={styles.summaryCloseBtn}
              onPress={() => setShowSummaryModal(false)}
            >
              <Text style={styles.summaryCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greeting: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  territory: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  dutyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  dutyPillOn: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
  },
  dutyPillOff: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
  },
  dutyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dutyDotOn: {
    backgroundColor: '#10b981',
  },
  dutyDotOff: {
    backgroundColor: '#94a3b8',
  },
  dutyText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  dutyTextOn: {
    color: '#065f46',
  },
  dutyTextOff: {
    color: '#64748b',
  },
  syncBanner: {
    backgroundColor: '#f0fdfa',
    borderColor: '#99f6e4',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  syncBannerText: {
    fontSize: 11,
    color: '#0f766e',
    fontWeight: '600',
  },
  syncBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#2dd4bf',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  syncBtnText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  metricsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#94a3b8',
    letterSpacing: 1,
  },
  metricRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  metricValueLarge: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 14,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
  },
  gridLabel: {
    fontSize: 10,
    color: '#64748b',
  },
  gridValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 2,
  },
  gridValueGreen: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#059669',
    marginTop: 2,
  },
  gridValueAmber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#b45309',
    marginTop: 2,
  },
  primaryActionBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  startDayBtn: {
    backgroundColor: '#0f766e',
  },
  endDayBtn: {
    backgroundColor: '#dc2626',
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  collectPaymentActionBtn: {
    backgroundColor: '#ffffff',
    borderColor: '#CBD2D7',
    borderWidth: 1.5,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  collectPaymentActionBtnText: {
    color: '#081224',
    fontSize: 13,
    fontWeight: '700',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionCardTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  actionCardSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  summaryBox: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
  },
  summarySubtitle: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  summaryValueBold: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  summaryValueGreen: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#059669',
  },
  summaryValueAmber: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#b45309',
  },
  summaryCloseBtn: {
    backgroundColor: '#0f766e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  summaryCloseBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
