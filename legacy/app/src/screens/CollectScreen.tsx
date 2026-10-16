import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { apiRequest } from '../services/api';
import { enqueueOperation } from '../storage/db';
import { useMobileAuth } from '../context/MobileAuthContext';

interface CollectScreenProps {
  preselectedClient?: any;
}

export default function CollectScreen({ preselectedClient }: CollectScreenProps) {
  const { user } = useMobileAuth();
  const [payments, setPayments] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Collection Form State
  const [showCollectModal, setShowCollectModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(preselectedClient || null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'>('UPI');
  const [transactionRef, setTransactionRef] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Receipt Modal
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  const fetchPayments = async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        apiRequest('/api/payments'),
        apiRequest('/api/clients'),
      ]);
      setPayments(pRes.data || []);
      setClients(cRes.data || []);
    } catch (e) {
      console.warn('Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
    if (preselectedClient) {
      setSelectedClient(preselectedClient);
      setShowCollectModal(true);
    }
  }, [preselectedClient]);

  const handleCollectPayment = async () => {
    if (!selectedClient) {
      Alert.alert('Error', 'Please select a client');
      return;
    }
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment collection amount');
      return;
    }

    setSubmitting(true);
    const paymentPayload = {
      clientId: selectedClient.id,
      amount: numAmount,
      paymentMethod,
      transactionReference: transactionRef || undefined,
      notes: paymentNotes || undefined,
      collectedAt: new Date().toISOString(),
      idempotencyKey: `payment-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };

    try {
      let createdPayment: any = null;
      try {
        const res = await apiRequest('/api/payments', {
          method: 'POST',
          body: JSON.stringify(paymentPayload),
        });
        createdPayment = res.data;
      } catch (networkErr) {
        // Enqueue offline
        const provisionalReceipt = `PAY-OFFLINE-${Date.now().toString().slice(-5)}`;
        createdPayment = {
          receiptNumber: provisionalReceipt,
          amount: numAmount,
          paymentMethod,
          status: 'PENDING (Offline)',
          collectedAt: paymentPayload.collectedAt,
          client: { name: selectedClient.name },
          salesperson: { user: { name: user?.name } },
        };
        await enqueueOperation('PAYMENT', paymentPayload, paymentPayload.idempotencyKey);
      }

      setShowCollectModal(false);
      setAmount('');
      setTransactionRef('');
      setPaymentNotes('');
      setLastReceipt(createdPayment);
      fetchPayments();
    } catch (err: any) {
      Alert.alert('Collection Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <Text style={styles.title}>Collections ({payments.length})</Text>
        <TouchableOpacity
          style={styles.newCollectBtn}
          onPress={() => {
            setShowCollectModal(true);
            if (!selectedClient && clients.length > 0) {
              setSelectedClient(clients[0]);
            }
          }}
        >
          <Text style={styles.newCollectBtnText}>+ Collect Payment</Text>
        </TouchableOpacity>
      </View>

      {/* List of Payments */}
      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.receiptNo}>{item.receiptNumber}</Text>
              <View
                style={[
                  styles.statusBadge,
                  item.status === 'VERIFIED'
                    ? styles.statusVerified
                    : item.status === 'REJECTED'
                    ? styles.statusRejected
                    : styles.statusPending,
                ]}
              >
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>

            <Text style={styles.clientName}>{item.clientName}</Text>
            <Text style={styles.paymentMeta}>
              {new Date(item.collectedAt).toLocaleDateString('en-IN')} • Mode: {item.paymentMethod}
              {item.transactionReference ? ` • Ref: ${item.transactionReference}` : ''}
            </Text>

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Amount Collected:</Text>
              <Text style={styles.amountVal}>₹{Number(item.amount).toLocaleString('en-IN')}</Text>
            </View>
          </View>
        )}
      />

      {/* Collect Modal */}
      {showCollectModal ? (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>COLLECT PAYMENT</Text>
                <TouchableOpacity onPress={() => setShowCollectModal(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scroll}>
                {/* Client selector */}
                <Text style={styles.label}>Select Client</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {clients.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[
                        styles.clientPill,
                        selectedClient?.id === c.id ? styles.clientPillActive : null,
                      ]}
                      onPress={() => setSelectedClient(c)}
                    >
                      <Text
                        style={[
                          styles.clientPillText,
                          selectedClient?.id === c.id ? styles.clientPillTextActive : null,
                        ]}
                      >
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {selectedClient ? (
                  <View style={styles.outstandingBox}>
                    <Text style={styles.outstandingLabel}>Verified Client Outstanding:</Text>
                    <Text style={styles.outstandingVal}>
                      ₹{(selectedClient.currentOutstanding || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                ) : null}

                {/* Amount input */}
                <Text style={styles.label}>Amount Collected (₹) *</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="e.g. 10000"
                  value={amount}
                  onChangeText={setAmount}
                />

                {/* Payment Method Selector */}
                <Text style={[styles.label, { marginTop: 12 }]}>Payment Method</Text>
                <View style={styles.methodsRow}>
                  {(['UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE'] as const).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[
                        styles.methodBtn,
                        paymentMethod === mode ? styles.methodBtnActive : null,
                      ]}
                      onPress={() => setPaymentMethod(mode)}
                    >
                      <Text
                        style={[
                          styles.methodBtnText,
                          paymentMethod === mode ? styles.methodBtnTextActive : null,
                        ]}
                      >
                        {mode.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Reference Number */}
                <Text style={[styles.label, { marginTop: 12 }]}>
                  Transaction Reference / UTR Number
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. UPI Ref / Cheque No"
                  value={transactionRef}
                  onChangeText={setTransactionRef}
                />

                {/* Remarks */}
                <Text style={[styles.label, { marginTop: 12 }]}>Collection Remarks</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Notes..."
                  value={paymentNotes}
                  onChangeText={setPaymentNotes}
                />
              </ScrollView>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleCollectPayment}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit Collection & Generate Voucher</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Electronic Voucher Receipt Modal (Section 11.4) */}
      {lastReceipt ? (
        <Modal visible transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.receiptBox}>
              <View style={styles.receiptHeaderBanner}>
                <Text style={styles.receiptBannerTitle}>PAYMENT RECEIVED</Text>
                <Text style={styles.receiptBannerSub}>Official Electronic Voucher</Text>
              </View>

              <View style={styles.receiptBody}>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Receipt Number:</Text>
                  <Text style={styles.receiptValBold}>{lastReceipt.receiptNumber}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Client:</Text>
                  <Text style={styles.receiptVal}>{lastReceipt.client?.name || selectedClient?.name}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Amount Received:</Text>
                  <Text style={styles.receiptAmountVal}>
                    ₹{Number(lastReceipt.amount).toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Payment Mode:</Text>
                  <Text style={styles.receiptVal}>{lastReceipt.paymentMethod}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Collected By:</Text>
                  <Text style={styles.receiptVal}>{user?.name}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Status:</Text>
                  <Text style={styles.receiptStatusText}>{lastReceipt.status}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.receiptDoneBtn}
                onPress={() => setLastReceipt(null)}
              >
                <Text style={styles.receiptDoneBtnText}>Dismiss Receipt</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  newCollectBtn: {
    backgroundColor: '#0f766e',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  newCollectBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 14,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptNo: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusVerified: {
    backgroundColor: '#ecfdf5',
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#334155',
  },
  clientName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 6,
  },
  paymentMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  amountLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  amountVal: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#059669',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalBox: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxHeight: '90%',
    borderRadius: 18,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  closeText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 'bold',
  },
  scroll: {
    maxHeight: 450,
  },
  label: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 6,
  },
  clientPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clientPillActive: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  clientPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  clientPillTextActive: {
    color: '#ffffff',
  },
  outstandingBox: {
    backgroundColor: '#fef3c7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  outstandingLabel: {
    fontSize: 11,
    color: '#92400e',
    fontWeight: '600',
  },
  outstandingVal: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#92400e',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  methodsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  methodBtnActive: {
    borderColor: '#0f766e',
    backgroundColor: '#f0fdfa',
  },
  methodBtnText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#475569',
  },
  methodBtnTextActive: {
    color: '#0f766e',
  },
  submitBtn: {
    backgroundColor: '#0f766e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  receiptBox: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    overflow: 'hidden',
  },
  receiptHeaderBanner: {
    backgroundColor: '#0f766e',
    padding: 16,
    alignItems: 'center',
  },
  receiptBannerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  receiptBannerSub: {
    color: '#ccfbf1',
    fontSize: 11,
    marginTop: 2,
  },
  receiptBody: {
    padding: 20,
    gap: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  receiptLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  receiptVal: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '500',
  },
  receiptValBold: {
    fontSize: 12,
    color: '#0f766e',
    fontWeight: 'bold',
  },
  receiptAmountVal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#059669',
  },
  receiptStatusText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#d97706',
  },
  receiptDoneBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 12,
    alignItems: 'center',
  },
  receiptDoneBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#334155',
  },
});
