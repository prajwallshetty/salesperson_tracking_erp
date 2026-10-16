import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { useMobileAuth } from '../context/MobileAuthContext';
import { apiRequest, pingApiServer } from '../services/api';
import { requestLocationPermissions } from '../services/locationService';
import { config, setCustomApiBaseUrl, getApiBaseUrl } from '../config';

type LoginMode = 'ACCESS_CODE' | 'PASSWORD';

export default function LoginScreen() {
  const { login } = useMobileAuth();
  const [loginMode, setLoginMode] = useState<LoginMode>('ACCESS_CODE');

  // Form states
  const [identifier, setIdentifier] = useState('EMP-001');
  const [accessCode, setAccessCode] = useState('');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Server Settings Modal State
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(config.apiBaseUrl);
  const [pingStatus, setPingStatus] = useState<{
    testing: boolean;
    result?: { ok: boolean; message: string; version?: string };
  }>({ testing: false });

  useEffect(() => {
    getApiBaseUrl().then((url) => {
      setServerUrlInput(url);
    });
  }, []);

  const handleTestPing = async (urlToTest?: string) => {
    const target = urlToTest || serverUrlInput;
    setPingStatus({ testing: true });
    try {
      const res = await pingApiServer(target);
      setPingStatus({ testing: false, result: res });
    } catch (e: any) {
      setPingStatus({
        testing: false,
        result: { ok: false, message: e.message || 'Connection failed' },
      });
    }
  };

  const handleSaveServerUrl = async (urlToSave?: string) => {
    const target = (urlToSave !== undefined ? urlToSave : serverUrlInput).trim();
    try {
      const updated = await setCustomApiBaseUrl(target);
      setServerUrlInput(updated);
      setShowServerModal(false);
      setPingStatus({ testing: false });
      Alert.alert('Server Configured', `API URL set to:\n${updated}`);
    } catch (e: any) {
      Alert.alert('Error', 'Failed to save server URL.');
    }
  };

  const handleLogin = async (idToUse?: string) => {
    setError('');
    setLoading(true);

    const targetIdentifier = (idToUse || identifier).trim();

    try {
      // 1. Request location permissions on onboarding (non-blocking)
      try {
        await requestLocationPermissions();
      } catch (locErr) {
        console.warn('Location permission request skipped:', locErr);
      }

      let res;
      if (loginMode === 'ACCESS_CODE') {
        if (!targetIdentifier || !accessCode.trim()) {
          throw new Error('Please enter both your Employee ID / Phone and Personal Access Code.');
        }

        res = await apiRequest('/api/auth/access-code-login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: targetIdentifier,
            accessCode: accessCode.trim().toUpperCase(),
          }),
        });
      } else {
        if (!targetIdentifier || !password) {
          throw new Error('Please enter both your identifier and password.');
        }

        res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: targetIdentifier, password }),
        });
      }

      const initialDuty = res.user?.dutyStatus === 'ON_DUTY' ? 'ON_DUTY' : 'OFF_DUTY';
      await login(res.token, res.user, initialDuty);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Top Server Connection Badge */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.serverBadge}
            onPress={() => {
              setServerUrlInput(config.apiBaseUrl);
              setPingStatus({ testing: false });
              setShowServerModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.serverBadgeDot} />
            <Text style={styles.serverBadgeText} numberOfLines={1}>
              API: {config.apiBaseUrl}
            </Text>
            <Text style={styles.serverBadgeEdit}>⚙️ Change</Text>
          </TouchableOpacity>
        </View>

        {/* Brand Banner */}
        <View style={styles.brandContainer}>
          <View style={styles.iconBox}>
            <View style={styles.iconInner}>
              <View style={styles.iconDot} />
            </View>
          </View>
          <Text style={styles.brandTitle}>FieldTrack</Text>
          <Text style={styles.brandSubtitle}>Sales Representative Companion</Text>
        </View>

        {/* Login Method Toggle */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleBtn, loginMode === 'ACCESS_CODE' && styles.toggleBtnActive]}
            onPress={() => {
              setLoginMode('ACCESS_CODE');
              setError('');
            }}
          >
            <Text
              style={[
                styles.toggleBtnText,
                loginMode === 'ACCESS_CODE' && styles.toggleBtnTextActive,
              ]}
            >
              Access Code
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toggleBtn, loginMode === 'PASSWORD' && styles.toggleBtnActive]}
            onPress={() => {
              setLoginMode('PASSWORD');
              setError('');
            }}
          >
            <Text
              style={[
                styles.toggleBtnText,
                loginMode === 'PASSWORD' && styles.toggleBtnTextActive,
              ]}
            >
              Password
            </Text>
          </TouchableOpacity>
        </View>

        {/* Error message */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Form Fields */}
        <View style={styles.card}>
          <Text style={styles.label}>
            {loginMode === 'ACCESS_CODE' ? 'Employee ID or Mobile Number' : 'Employee ID, Phone, or Email'}
          </Text>
          <TextInput
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={loginMode === 'ACCESS_CODE' ? 'e.g. EMP-001 or 9876543212' : 'e.g. rahul@erp.com'}
            placeholderTextColor="#8C9BA5"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {loginMode === 'ACCESS_CODE' ? (
            <>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { marginTop: 14 }]}>Personal Access Code</Text>
                <Text style={styles.hintText}>Issued by Admin</Text>
              </View>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={accessCode}
                onChangeText={(val) => setAccessCode(val.toUpperCase())}
                placeholder="e.g. RAHUL12345"
                placeholderTextColor="#8C9BA5"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Text style={styles.securityNote}>
                Your individual code locks automatically after 5 consecutive failed attempts.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#8C9BA5"
                secureTextEntry
              />
            </>
          )}

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => handleLogin()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {loginMode === 'ACCESS_CODE' ? 'Sign In with Access Code' : 'Sign In with Password'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Quick Demo Sign-in Helper */}
        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>QUICK DEMO CREDENTIALS</Text>
          <View style={styles.demoRow}>
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={() => {
                setLoginMode('ACCESS_CODE');
                setIdentifier('EMP-001');
                setAccessCode('RAHUL12345');
                setError('');
              }}
            >
              <Text style={styles.demoBtnText}>⚡ Pre-fill Rahul Code (RAHUL12345)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoBtn}
              onPress={() => {
                setLoginMode('PASSWORD');
                setIdentifier('rahul@erp.com');
                setPassword('Password123!');
                setError('');
              }}
            >
              <Text style={styles.demoBtnText}>🔑 Pre-fill Rahul Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Server Settings Modal */}
      <Modal visible={showServerModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Server Connection Settings</Text>
              <TouchableOpacity onPress={() => setShowServerModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Configure the API endpoint URL for your development or live production environment.
            </Text>

            <Text style={styles.label}>Backend API URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="http://localhost:4000 or https://api..."
              placeholderTextColor="#8C9BA5"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Quick Preset Buttons */}
            <Text style={[styles.label, { marginTop: 12, fontSize: 11 }]}>QUICK PRESETS</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={styles.presetBtn}
                onPress={() => setServerUrlInput('http://localhost:4000')}
              >
                <Text style={styles.presetBtnText}>Local (localhost:4000)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.presetBtn}
                onPress={() => setServerUrlInput('http://10.0.2.2:4000')}
              >
                <Text style={styles.presetBtnText}>Android (10.0.2.2:4000)</Text>
              </TouchableOpacity>
            </View>

            {/* Ping Status Banner */}
            {pingStatus.testing ? (
              <View style={styles.pingBox}>
                <ActivityIndicator size="small" color="#081224" />
                <Text style={styles.pingText}>Testing connection to /api/health...</Text>
              </View>
            ) : pingStatus.result ? (
              <View
                style={[
                  styles.pingBox,
                  pingStatus.result.ok ? styles.pingBoxOk : styles.pingBoxFail,
                ]}
              >
                <Text
                  style={[
                    styles.pingResultText,
                    pingStatus.result.ok ? styles.pingTextOk : styles.pingTextFail,
                  ]}
                >
                  {pingStatus.result.ok ? '🟢' : '🔴'} {pingStatus.result.message}
                </Text>
              </View>
            ) : null}

            {/* Modal Actions */}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.testBtn}
                onPress={() => handleTestPing()}
                disabled={pingStatus.testing}
              >
                <Text style={styles.testBtnText}>Test Health Ping</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => handleSaveServerUrl()}
              >
                <Text style={styles.saveBtnText}>Save & Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F8',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  topBar: {
    alignItems: 'center',
    marginBottom: 16,
  },
  serverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 6,
    maxWidth: '90%',
  },
  serverBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2E6819',
  },
  serverBadgeText: {
    fontSize: 10,
    color: '#586570',
    fontWeight: '600',
    flexShrink: 1,
  },
  serverBadgeEdit: {
    fontSize: 10,
    color: '#081224',
    fontWeight: '700',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconInner: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDot: {
    width: 8,
    height: 8,
    backgroundColor: '#B4E39C',
    borderRadius: 2,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0B1320',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#586570',
    marginTop: 4,
    fontWeight: '500',
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#E8EDEF',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#586570',
  },
  toggleBtnTextActive: {
    color: '#0B1320',
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 20,
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0B1320',
    marginBottom: 6,
  },
  hintText: {
    fontSize: 11,
    color: '#8C9BA5',
  },
  input: {
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0B1320',
  },
  codeInput: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    letterSpacing: 2,
  },
  securityNote: {
    fontSize: 11,
    color: '#586570',
    marginTop: 6,
    lineHeight: 15,
  },
  submitBtn: {
    backgroundColor: '#081224',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 18,
    minHeight: 46,
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  demoBox: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD2D7',
    borderRadius: 12,
    padding: 14,
  },
  demoTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8C9BA5',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  demoRow: {
    gap: 8,
  },
  demoBtn: {
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  demoBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#081224',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 18, 36, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1320',
  },
  modalCloseText: {
    fontSize: 18,
    color: '#586570',
    fontWeight: '700',
    padding: 4,
  },
  modalDesc: {
    fontSize: 11,
    color: '#586570',
    marginBottom: 14,
    lineHeight: 16,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#0B1320',
  },
  pingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F5F7F8',
    marginBottom: 14,
  },
  pingBoxOk: {
    backgroundColor: '#E6F4DD',
    borderColor: '#B4E39C',
    borderWidth: 1,
  },
  pingBoxFail: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  pingText: {
    fontSize: 11,
    color: '#586570',
  },
  pingResultText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pingTextOk: {
    color: '#2E6819',
  },
  pingTextFail: {
    color: '#991B1B',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  testBtn: {
    flex: 1,
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1320',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#081224',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
});
