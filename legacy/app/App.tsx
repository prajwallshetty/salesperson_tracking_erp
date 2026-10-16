import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Platform,
} from 'react-native';
import { MobileAuthProvider, useMobileAuth } from './src/context/MobileAuthContext';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ExpensesScreen from './src/screens/ExpensesScreen';
import MoreScreen from './src/screens/MoreScreen';
import CollectScreen from './src/screens/CollectScreen';

type TabType = 'Home' | 'Clients' | 'Orders' | 'Expenses' | 'More' | 'Collect';

function MainApp() {
  const { user, isLoading, dutyStatus, pendingSyncCount } = useMobileAuth();
  const [activeTab, setActiveTab] = useState<TabType>('Home');
  const [preselectedClientForOrder, setPreselectedClientForOrder] = useState<any>(null);
  const [preselectedClientForPayment, setPreselectedClientForPayment] = useState<any>(null);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#081224" />
        <Text style={styles.loadingText}>Initializing FieldTrack ERP...</Text>
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  const navigateToTab = (tab: TabType) => {
    setActiveTab(tab);
  };

  const handleSelectClientForOrder = (client: any) => {
    setPreselectedClientForOrder(client);
    setActiveTab('Orders');
  };

  const handleSelectClientForPayment = (client: any) => {
    setPreselectedClientForPayment(client);
    setActiveTab('Collect');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* Top App Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.brandIcon}>
            <View style={styles.brandInner}>
              <View style={styles.brandDot} />
            </View>
          </View>
          <View>
            <Text style={styles.headerTitle}>FieldTrack</Text>
            <Text style={styles.headerSubtitle}>
              {user.name} • {user.employeeCode || 'Sales'}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {pendingSyncCount > 0 && (
            <View style={styles.syncBadge}>
              <Text style={styles.syncBadgeText}>{pendingSyncCount} offline</Text>
            </View>
          )}
          <View
            style={[
              styles.dutyBadge,
              dutyStatus === 'ON_DUTY' ? styles.dutyOn : styles.dutyOff,
            ]}
          >
            <View
              style={[
                styles.dutyDot,
                { backgroundColor: dutyStatus === 'ON_DUTY' ? '#2E6819' : '#80909D' },
              ]}
            />
            <Text
              style={[
                styles.dutyText,
                { color: dutyStatus === 'ON_DUTY' ? '#2E6819' : '#586570' },
              ]}
            >
              {dutyStatus === 'ON_DUTY' ? 'ON DUTY' : 'OFF DUTY'}
            </Text>
          </View>
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {activeTab === 'Home' && <HomeScreen onNavigateTab={navigateToTab} />}
        {activeTab === 'Clients' && (
          <ClientsScreen
            onSelectClientForOrder={handleSelectClientForOrder}
            onSelectClientForPayment={handleSelectClientForPayment}
          />
        )}
        {activeTab === 'Orders' && (
          <OrdersScreen preselectedClient={preselectedClientForOrder} />
        )}
        {activeTab === 'Expenses' && <ExpensesScreen />}
        {activeTab === 'More' && (
          <MoreScreen onOpenCollectDirect={() => setActiveTab('Collect')} />
        )}
        {activeTab === 'Collect' && (
          <View style={{ flex: 1 }}>
            <View style={styles.directSubHeader}>
              <TouchableOpacity onPress={() => setActiveTab('Home')} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Back to Home</Text>
              </TouchableOpacity>
              <Text style={styles.directSubTitle}>Collect Customer Payment</Text>
            </View>
            <CollectScreen preselectedClient={preselectedClientForPayment} />
          </View>
        )}
      </View>

      {/* Mobile Bottom Navigation Bar: Home | Clients | Orders | Expenses | More */}
      <View style={styles.bottomNav}>
        {[
          { id: 'Home', label: 'Home', icon: '🏠' },
          { id: 'Clients', label: 'Clients', icon: '👥' },
          { id: 'Orders', label: 'Orders', icon: '📦' },
          { id: 'Expenses', label: 'Expenses', icon: '🧾' },
          { id: 'More', label: 'More', icon: '☰' },
        ].map((t) => {
          const isActive = activeTab === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.tabButton, isActive && styles.activeTabButton]}
              onPress={() => setActiveTab(t.id as TabType)}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabIcon, isActive && styles.activeTabIcon]}>{t.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.activeTabLabel]}>{t.label}</Text>
              {isActive && <View style={styles.activeTabIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <MobileAuthProvider>
      <MainApp />
    </MobileAuthProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F7F8',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#586570',
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
    backgroundColor: '#ffffff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandInner: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandDot: {
    width: 5,
    height: 5,
    backgroundColor: '#B4E39C',
    borderRadius: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1320',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#586570',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncBadge: {
    backgroundColor: '#CFDDE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  syncBadgeText: {
    color: '#2C4656',
    fontSize: 10,
    fontWeight: '700',
  },
  dutyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  dutyOn: {
    backgroundColor: '#E6F4DD',
    borderColor: '#B4E39C',
  },
  dutyOff: {
    backgroundColor: '#F3F5F6',
    borderColor: '#CBD2D7',
  },
  dutyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dutyText: {
    fontSize: 10,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    backgroundColor: '#F5F7F8',
  },
  directSubHeader: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
  },
  backLink: {
    paddingVertical: 2,
  },
  backLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#081224',
  },
  directSubTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1320',
    marginTop: 2,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#E8EDEF',
    borderTopWidth: 1,
    borderTopColor: '#D8DFE4',
    paddingVertical: 4,
    paddingHorizontal: 6,
    paddingBottom: Platform.OS === 'ios' ? 22 : 6,
    gap: 4,
    minHeight: 56,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 10,
    minHeight: 46,
    position: 'relative',
  },
  activeTabButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  tabIcon: {
    fontSize: 16,
    marginBottom: 2,
    opacity: 0.6,
  },
  activeTabIcon: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#586570',
  },
  activeTabLabel: {
    color: '#0B1320',
    fontWeight: '700',
  },
  activeTabIndicator: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 2.5,
    backgroundColor: '#B4E39C',
    borderRadius: 2,
  },
});
