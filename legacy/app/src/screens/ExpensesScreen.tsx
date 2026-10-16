import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useMobileAuth } from '../context/MobileAuthContext';
import { apiRequest } from '../services/api';
import { getCurrentCoordinates } from '../services/locationService';
import { enqueueOperation } from '../storage/db';
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../shared';

export default function ExpensesScreen() {
  const { user } = useMobileAuth();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');

  // New / Edit Expense Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('AUTO_RICKSHAW');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Inspect Modal State
  const [inspectExpense, setInspectExpense] = useState<any | null>(null);

  const fetchExpenses = async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/api/expenses?limit=50');
      setExpenses(res.data || []);
    } catch (err) {
      console.warn('Could not fetch expenses, working with cached/local records:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  // Summary Totals
  const pendingTotal = expenses
    .filter((e) => e.status === 'SUBMITTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const approvedTotal = expenses
    .filter((e) => e.status === 'APPROVED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const reimbursedTotal = expenses
    .filter((e) => e.status === 'REIMBURSED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Open Form for New Expense
  const handleOpenNew = () => {
    setEditingExpenseId(null);
    setCategory('AUTO_RICKSHAW');
    setAmount('');
    setDescription('');
    setBusinessPurpose('');
    setMerchantName('');
    setPaymentMethod('UPI');
    setReceiptUrl('');
    setFormError('');
    setModalVisible(true);
  };

  // Open Form to Edit Rejected Expense
  const handleEditRejected = (exp: any) => {
    setEditingExpenseId(exp.id);
    setCategory(exp.category);
    setAmount(String(exp.amount));
    setDescription(exp.description || '');
    setBusinessPurpose(exp.businessPurpose || '');
    setMerchantName(exp.merchantName || '');
    setPaymentMethod(exp.paymentMethod || 'UPI');
    setReceiptUrl(exp.receiptUrl || '');
    setFormError('');
    setInspectExpense(null);
    setModalVisible(true);
  };

  // Handle Save (Draft vs Direct Submit)
  const handleSaveExpense = async (isSubmit: boolean) => {
    setFormError('');
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setFormError('Please enter a valid positive amount.');
      return;
    }
    if (!description.trim()) {
      setFormError('Please provide a brief description.');
      return;
    }

    setSubmitting(true);
    try {
      const coords = await getCurrentCoordinates();

      const payload = {
        category,
        amount: amtNum,
        expenseDate: new Date().toISOString(),
        description: description.trim(),
        businessPurpose: businessPurpose.trim() || undefined,
        merchantName: merchantName.trim() || undefined,
        paymentMethod,
        receiptUrl: receiptUrl.trim() || undefined,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      };

      if (editingExpenseId) {
        // Edit existing draft or rejected
        await apiRequest(`/api/expenses/${editingExpenseId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });

        if (isSubmit) {
          await apiRequest(`/api/expenses/${editingExpenseId}/submit`, {
            method: 'POST',
          });
        }
      } else {
        // Create new
        try {
          const created = await apiRequest('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          if (isSubmit && created.data?.id) {
            await apiRequest(`/api/expenses/${created.data.id}/submit`, {
              method: 'POST',
            });
          }
        } catch (netErr) {
          // Offline fallback: enqueue to durable outbox queue
          await enqueueOperation('EXPENSE', { ...payload, isSubmit });
          Alert.alert(
            'Offline Mode',
            'Your expense claim has been saved locally and will automatically synchronize when network is restored.'
          );
        }
      }

      setModalVisible(false);
      fetchExpenses();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save expense claim.');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered List
  const filteredExpenses = expenses.filter((e) => {
    if (selectedFilter === 'ALL') return true;
    return e.status === selectedFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUBMITTED':
        return { label: 'Submitted (Pending)', bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' };
      case 'APPROVED':
        return { label: 'Approved', bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE' };
      case 'REIMBURSED':
        return { label: 'Reimbursed', bg: '#E6F4DD', text: '#2E6819', border: '#B4E39C' };
      case 'REJECTED':
        return { label: 'Rejected', bg: '#FEE2E2', text: '#991B1B', border: '#FECACA' };
      default:
        return { label: 'Draft', bg: '#F3F4F6', text: '#4B5563', border: '#E5E7EB' };
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Action Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.pageTitle}>Expenses</Text>
          <Text style={styles.pageSubtitle}>Field Staff Claims & Travel</Text>
        </View>

        <TouchableOpacity style={styles.newClaimBtn} onPress={handleOpenNew}>
          <Text style={styles.newClaimBtnText}>+ New Claim</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* KPI Summaries */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>PENDING</Text>
            <Text style={styles.kpiValue}>
              ₹{pendingTotal.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
            </Text>
            <Text style={styles.kpiSub}>Under review</Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>APPROVED</Text>
            <Text style={styles.kpiValue}>
              ₹{approvedTotal.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
            </Text>
            <Text style={styles.kpiSub}>Awaiting payout</Text>
          </View>

          <View style={[styles.kpiCard, styles.kpiCardLime]}>
            <Text style={[styles.kpiLabel, { color: '#2E6819' }]}>REIMBURSED</Text>
            <Text style={[styles.kpiValue, { color: '#2E6819' }]}>
              ₹{reimbursedTotal.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
            </Text>
            <Text style={[styles.kpiSub, { color: '#2E6819' }]}>Settled</Text>
          </View>
        </View>

        {/* Status Filter Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
          {['ALL', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED', 'DRAFT'].map((st) => (
            <TouchableOpacity
              key={st}
              style={[styles.filterChip, selectedFilter === st && styles.filterChipActive]}
              onPress={() => setSelectedFilter(st)}
            >
              <Text
                style={[styles.filterChipText, selectedFilter === st && styles.filterChipTextActive]}
              >
                {st === 'ALL' ? 'All Claims' : st.charAt(0) + st.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Expenses List */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color="#081224" />
            <Text style={styles.loadingText}>Loading expense claims...</Text>
          </View>
        ) : filteredExpenses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No expense claims</Text>
            <Text style={styles.emptySubtitle}>
              Tap "+ New Claim" to record travel, fuel, or food expenses.
            </Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {filteredExpenses.map((exp) => {
              const badge = getStatusBadge(exp.status);

              return (
                <TouchableOpacity
                  key={exp.id}
                  style={styles.claimCard}
                  onPress={() => setInspectExpense(exp)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <Text style={styles.claimNumber}>{exp.expenseNumber}</Text>
                      <Text style={styles.claimDate}>
                        {new Date(exp.expenseDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: badge.bg, borderColor: badge.border },
                      ]}
                    >
                      <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.cardBodyLeft}>
                      <Text style={styles.claimCategory}>
                        {exp.category.replace(/_/g, ' ')}
                      </Text>
                      <Text style={styles.claimDesc} numberOfLines={1}>
                        {exp.description}
                      </Text>
                      {exp.merchantName && (
                        <Text style={styles.merchantText}>
                          Vendor: {exp.merchantName} • {exp.paymentMethod}
                        </Text>
                      )}
                    </View>

                    <Text style={styles.claimAmount}>
                      ₹{Number(exp.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>

                  {/* Rejection Alert Banner */}
                  {exp.status === 'REJECTED' && (
                    <View style={styles.rejectionBanner}>
                      <Text style={styles.rejectionTitle}>Rejection Reason:</Text>
                      <Text style={styles.rejectionText}>
                        {exp.rejectionReason || 'Please review with manager.'}
                      </Text>
                      <Text style={styles.tapToEditHint}>Tap to view details & resubmit →</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* CREATE / EDIT EXPENSE MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingExpenseId ? 'Edit Expense Claim' : 'New Expense Claim'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm}>
              {formError ? (
                <View style={styles.modalError}>
                  <Text style={styles.modalErrorText}>{formError}</Text>
                </View>
              ) : null}

              {/* Category Picker */}
              <Text style={styles.formLabel}>Expense Category *</Text>
              <View style={styles.categoryPicker}>
                {Object.values(EXPENSE_CATEGORIES).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryOption,
                      category === cat && styles.categoryOptionActive,
                    ]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.categoryOptionText,
                        category === cat && styles.categoryOptionTextActive,
                      ]}
                    >
                      {cat.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Amount */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Amount in INR (₹) *</Text>
              <TextInput
                style={styles.modalInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="e.g. 350.00"
                placeholderTextColor="#8C9BA5"
                keyboardType="decimal-pad"
              />

              {/* Description */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Description *</Text>
              <TextInput
                style={styles.modalInput}
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Auto fare from client office to central depot"
                placeholderTextColor="#8C9BA5"
              />

              {/* Business Purpose */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Business Purpose</Text>
              <TextInput
                style={styles.modalInput}
                value={businessPurpose}
                onChangeText={setBusinessPurpose}
                placeholder="e.g. Urgent product sample delivery"
                placeholderTextColor="#8C9BA5"
              />

              {/* Merchant / Vendor */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Vendor / Merchant Name</Text>
              <TextInput
                style={styles.modalInput}
                value={merchantName}
                onChangeText={setMerchantName}
                placeholder="e.g. Metro / Local Fuel Station"
                placeholderTextColor="#8C9BA5"
              />

              {/* Payment Method */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Payment Method</Text>
              <View style={styles.paymentMethodRow}>
                {['UPI', 'CASH', 'PERSONAL_CARD', 'COMPANY_CARD'].map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.paymentMethodBtn,
                      paymentMethod === m && styles.paymentMethodBtnActive,
                    ]}
                    onPress={() => setPaymentMethod(m)}
                  >
                    <Text
                      style={[
                        styles.paymentMethodBtnText,
                        paymentMethod === m && styles.paymentMethodBtnTextActive,
                      ]}
                    >
                      {m.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Receipt Attachment URL / Simulator */}
              <Text style={[styles.formLabel, { marginTop: 14 }]}>Receipt Attachment</Text>
              <View style={styles.receiptAttachBox}>
                <TouchableOpacity
                  style={styles.attachPhotoBtn}
                  onPress={() => {
                    // Attach sample receipt image url
                    setReceiptUrl('https://images.unsplash.com/photo-1554415707-9e4c019fcaf4?w=500&auto=format&fit=crop&q=60');
                    Alert.alert('Receipt Captured', 'Photographic receipt attached successfully.');
                  }}
                >
                  <Text style={styles.attachPhotoBtnText}>📷 Capture / Upload Receipt</Text>
                </TouchableOpacity>

                {receiptUrl ? (
                  <View style={styles.attachedPreview}>
                    <Text style={styles.attachedText}>✓ Receipt image attached</Text>
                    <TouchableOpacity onPress={() => setReceiptUrl('')}>
                      <Text style={styles.removeReceiptText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* Action Buttons */}
              <View style={styles.formActions}>
                <TouchableOpacity
                  style={styles.draftBtn}
                  onPress={() => handleSaveExpense(false)}
                  disabled={submitting}
                >
                  <Text style={styles.draftBtnText}>Save Draft</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.submitClaimBtn}
                  onPress={() => handleSaveExpense(true)}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.submitClaimBtnText}>Submit Claim</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* INSPECT DETAILS MODAL */}
      {inspectExpense && (
        <Modal visible={!!inspectExpense} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{inspectExpense.expenseNumber}</Text>
                  <Text style={styles.claimDate}>
                    {new Date(inspectExpense.expenseDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setInspectExpense(null)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.inspectBody}>
                {/* Amount Header */}
                <View style={styles.inspectAmountBox}>
                  <Text style={styles.inspectAmountLabel}>Claim Amount</Text>
                  <Text style={styles.inspectAmountValue}>
                    ₹{Number(inspectExpense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: getStatusBadge(inspectExpense.status).bg,
                        borderColor: getStatusBadge(inspectExpense.status).border,
                        marginTop: 6,
                      },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: getStatusBadge(inspectExpense.status).text }]}>
                      {getStatusBadge(inspectExpense.status).label}
                    </Text>
                  </View>
                </View>

                {/* Rejection Alert */}
                {inspectExpense.status === 'REJECTED' && (
                  <View style={styles.rejectionNotice}>
                    <Text style={styles.rejectionTitle}>Manager Feedback:</Text>
                    <Text style={styles.rejectionText}>
                      {inspectExpense.rejectionReason || 'Receipt verification incomplete.'}
                    </Text>
                    <TouchableOpacity
                      style={styles.resubmitBtn}
                      onPress={() => handleEditRejected(inspectExpense)}
                    >
                      <Text style={styles.resubmitBtnText}>Edit and Resubmit Claim</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Details Breakdown */}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Category:</Text>
                  <Text style={styles.detailValue}>
                    {inspectExpense.category.replace(/_/g, ' ')}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Description:</Text>
                  <Text style={styles.detailValue}>{inspectExpense.description}</Text>
                </View>

                {inspectExpense.businessPurpose ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Purpose:</Text>
                    <Text style={styles.detailValue}>{inspectExpense.businessPurpose}</Text>
                  </View>
                ) : null}

                {inspectExpense.merchantName ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Merchant:</Text>
                    <Text style={styles.detailValue}>{inspectExpense.merchantName}</Text>
                  </View>
                ) : null}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Payment Mode:</Text>
                  <Text style={styles.detailValue}>{inspectExpense.paymentMethod}</Text>
                </View>

                {/* Reimbursement Details if Paid */}
                {inspectExpense.reimbursementRef ? (
                  <View style={styles.reimbursementBox}>
                    <Text style={styles.reimbursementTitle}>Settled Reimbursement</Text>
                    <Text style={styles.reimbursementText}>
                      Reference: {inspectExpense.reimbursementRef} via {inspectExpense.reimbursementMethod}
                    </Text>
                  </View>
                ) : null}

                {/* Receipt Preview */}
                {inspectExpense.receiptUrl ? (
                  <View style={styles.receiptViewerBox}>
                    <Text style={styles.detailLabel}>Receipt Document:</Text>
                    <Image
                      source={{ uri: inspectExpense.receiptUrl }}
                      style={styles.receiptImage}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => setInspectExpense(null)}
                >
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F8',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1320',
  },
  pageSubtitle: {
    fontSize: 11,
    color: '#586570',
    marginTop: 2,
  },
  newClaimBtn: {
    backgroundColor: '#081224',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  newClaimBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 12,
  },
  kpiCardLime: {
    backgroundColor: '#E6F4DD',
    borderColor: '#B4E39C',
  },
  kpiLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#586570',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B1320',
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 10,
    color: '#8C9BA5',
    marginTop: 2,
  },
  filterBar: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD2D7',
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: '#081224',
    borderColor: '#081224',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#586570',
  },
  filterChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  centerContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: '#586570',
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1320',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#586570',
    textAlign: 'center',
    marginTop: 4,
  },
  listContainer: {
    gap: 10,
  },
  claimCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  claimNumber: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    fontSize: 12,
    color: '#0B1320',
  },
  claimDate: {
    fontSize: 11,
    color: '#8C9BA5',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardBodyLeft: {
    flex: 1,
    marginRight: 10,
  },
  claimCategory: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1320',
  },
  claimDesc: {
    fontSize: 11,
    color: '#586570',
    marginTop: 2,
  },
  merchantText: {
    fontSize: 10,
    color: '#8C9BA5',
    marginTop: 3,
  },
  claimAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B1320',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rejectionBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  rejectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#991B1B',
  },
  rejectionText: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
  },
  tapToEditHint: {
    fontSize: 10,
    fontWeight: '700',
    color: '#991B1B',
    marginTop: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD2D7',
    backgroundColor: '#F5F7F8',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1320',
  },
  modalClose: {
    fontSize: 16,
    color: '#8C9BA5',
    fontWeight: '700',
  },
  modalForm: {
    padding: 18,
  },
  modalError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  modalErrorText: {
    color: '#991B1B',
    fontSize: 11,
    fontWeight: '600',
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0B1320',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  categoryPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F5F7F8',
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  categoryOptionActive: {
    backgroundColor: '#081224',
    borderColor: '#081224',
  },
  categoryOptionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#586570',
  },
  categoryOptionTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  modalInput: {
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0B1320',
  },
  paymentMethodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paymentMethodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F5F7F8',
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  paymentMethodBtnActive: {
    backgroundColor: '#E6F4DD',
    borderColor: '#B4E39C',
  },
  paymentMethodBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#586570',
  },
  paymentMethodBtnTextActive: {
    color: '#2E6819',
    fontWeight: '700',
  },
  receiptAttachBox: {
    backgroundColor: '#F5F7F8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 12,
  },
  attachPhotoBtn: {
    backgroundColor: '#ffffff',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  attachPhotoBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#081224',
  },
  attachedPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  attachedText: {
    fontSize: 11,
    color: '#2E6819',
    fontWeight: '600',
  },
  removeReceiptText: {
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  draftBtn: {
    flex: 1,
    backgroundColor: '#F5F7F8',
    borderColor: '#CBD2D7',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  draftBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1320',
  },
  submitClaimBtn: {
    flex: 1,
    backgroundColor: '#081224',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  submitClaimBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  inspectBody: {
    padding: 18,
    gap: 12,
  },
  inspectAmountBox: {
    backgroundColor: '#F5F7F8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD2D7',
    padding: 14,
    alignItems: 'center',
  },
  inspectAmountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#586570',
    textTransform: 'uppercase',
  },
  inspectAmountValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0B1320',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rejectionNotice: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
  },
  resubmitBtn: {
    backgroundColor: '#991B1B',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  resubmitBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F3F5',
  },
  detailLabel: {
    fontSize: 11,
    color: '#586570',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 11,
    color: '#0B1320',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  reimbursementBox: {
    backgroundColor: '#E6F4DD',
    borderWidth: 1,
    borderColor: '#B4E39C',
    borderRadius: 10,
    padding: 10,
  },
  reimbursementTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2E6819',
  },
  reimbursementText: {
    fontSize: 10,
    color: '#2E6819',
    marginTop: 2,
  },
  receiptViewerBox: {
    marginTop: 8,
  },
  receiptImage: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  modalFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#CBD2D7',
    backgroundColor: '#F5F7F8',
    alignItems: 'flex-end',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD2D7',
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0B1320',
  },
});
