import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { apiRequest } from '../services/api';
import { getCurrentCoordinates } from '../services/locationService';
import { enqueueOperation, cacheClients, getCachedClients } from '../storage/db';

interface ClientsScreenProps {
  onSelectClientForOrder?: (client: any) => void;
  onSelectClientForPayment?: (client: any) => void;
}

export default function ClientsScreen({
  onSelectClientForOrder,
  onSelectClientForPayment,
}: ClientsScreenProps) {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState(false);
  const [loading, setLoading] = useState(true);

  // Visit Modal State
  const [activeVisitClient, setActiveVisitClient] = useState<any>(null);
  const [visitDistance, setVisitDistance] = useState<number | null>(null);
  const [isRadiusBreach, setIsRadiusBreach] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [visitOutcome, setVisitOutcome] = useState('ORDER_TAKEN');
  const [visitNotes, setVisitNotes] = useState('');
  const [currentVisitId, setCurrentVisitId] = useState<string | null>(null);
  const [visitStep, setVisitStep] = useState<'START' | 'IN_PROGRESS'>('START');
  const [submittingVisit, setSubmittingVisit] = useState(false);

  const fetchClients = async () => {
    try {
      const coords = await getCurrentCoordinates();
      let url = '/api/clients';
      if (coords) url += `?lat=${coords.latitude}&lng=${coords.longitude}`;

      const res = await apiRequest(url);
      setClients(res.data || []);
      await cacheClients(res.data || []);
    } catch (e) {
      // Fallback to local cache
      const cached = await getCachedClients();
      if (cached.length > 0) setClients(cached);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleStartVisitClick = async (client: any) => {
    setActiveVisitClient(client);
    setVisitStep('START');
    setExceptionReason('');
    setVisitNotes('');
    setCurrentVisitId(null);

    const coords = await getCurrentCoordinates();
    if (!coords) {
      setVisitDistance(null);
      setIsRadiusBreach(true);
      setExceptionReason('GPS coordinates unavailable at visit time');
      return;
    }

    // Distance calculation
    const R = 6371e3;
    const phi1 = (coords.latitude * Math.PI) / 180;
    const phi2 = (client.latitude * Math.PI) / 180;
    const deltaPhi = ((client.latitude - coords.latitude) * Math.PI) / 180;
    const deltaLambda = ((client.longitude - coords.longitude) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

    setVisitDistance(dist);
    setIsRadiusBreach(dist > 100);
  };

  const handleConfirmStartVisit = async () => {
    if (!activeVisitClient) return;
    setSubmittingVisit(true);

    try {
      const coords = (await getCurrentCoordinates()) || {
        latitude: activeVisitClient.latitude,
        longitude: activeVisitClient.longitude,
      };

      try {
        const res = await apiRequest('/api/visits/start', {
          method: 'POST',
          body: JSON.stringify({
            clientId: activeVisitClient.id,
            latitude: coords.latitude,
            longitude: coords.longitude,
            isException: isRadiusBreach,
            exceptionReason: isRadiusBreach ? exceptionReason || 'Out of 100m radius' : undefined,
            idempotencyKey: `visit-start-${Date.now()}`,
          }),
        });
        setCurrentVisitId(res.data.visitId);
      } catch (netErr) {
        // Enqueue offline
        const localId = `local-visit-${Date.now()}`;
        setCurrentVisitId(localId);
        await enqueueOperation('VISIT_START', {
          clientId: activeVisitClient.id,
          latitude: coords.latitude,
          longitude: coords.longitude,
          distanceFromClient: visitDistance || 0,
          isException: isRadiusBreach,
          exceptionReason: isRadiusBreach ? exceptionReason || 'Out of radius' : null,
          startedAt: new Date().toISOString(),
        });
      }

      setVisitStep('IN_PROGRESS');
    } catch (err: any) {
      Alert.alert('Visit Error', err.message);
    } finally {
      setSubmittingVisit(false);
    }
  };

  const handleCompleteVisit = async () => {
    if (!currentVisitId) return;
    setSubmittingVisit(true);

    try {
      try {
        await apiRequest(`/api/visits/${currentVisitId}/end`, {
          method: 'POST',
          body: JSON.stringify({
            outcome: visitOutcome,
            notes: visitNotes,
          }),
        });
      } catch (netErr) {
        await enqueueOperation('VISIT_END', {
          visitId: currentVisitId,
          outcome: visitOutcome,
          notes: visitNotes,
          endedAt: new Date().toISOString(),
        });
      }

      Alert.alert('Visit Completed', `Visit to ${activeVisitClient.name} recorded successfully.`);
      setActiveVisitClient(null);
      fetchClients();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmittingVisit(false);
    }
  };

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const match = c.name.toLowerCase().includes(q) || c.contactPerson.toLowerCase().includes(q);
    if (filterPending) return match && c.currentOutstanding > 0;
    return match;
  });

  return (
    <View style={styles.container}>
      {/* Top Search & Filter */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search assigned clients..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#94a3b8"
        />
        <TouchableOpacity
          style={[styles.filterBtn, filterPending ? styles.filterBtnActive : null]}
          onPress={() => setFilterPending(!filterPending)}
        >
          <Text style={[styles.filterBtnText, filterPending ? styles.filterBtnTextActive : null]}>
            Due Balances
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clientName}>{item.name}</Text>
                <Text style={styles.contactPerson}>
                  {item.contactPerson} • {item.phone}
                </Text>
              </View>
              {item.distanceMeters !== undefined ? (
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceText}>
                    {item.distanceMeters < 1000
                      ? `${item.distanceMeters}m`
                      : `${(item.distanceMeters / 1000).toFixed(1)}km`}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.address}>{item.address}, {item.city}</Text>

            {/* Balances */}
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Outstanding Balance:</Text>
              <Text
                style={[
                  styles.balanceValue,
                  item.currentOutstanding > 0 ? styles.balanceValueDue : null,
                ]}
              >
                ₹{(item.currentOutstanding || 0).toLocaleString('en-IN')}
              </Text>
            </View>

            {/* Quick Action buttons */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() => Linking.openURL(`tel:${item.phone}`)}
              >
                <Text style={styles.btnSecondaryText}>Call</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`
                  )
                }
              >
                <Text style={styles.btnSecondaryText}>Navigate</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => handleStartVisitClick(item)}
              >
                <Text style={styles.btnPrimaryText}>Start Visit</Text>
              </TouchableOpacity>

              {onSelectClientForOrder ? (
                <TouchableOpacity
                  style={styles.btnAction}
                  onPress={() => onSelectClientForOrder(item)}
                >
                  <Text style={styles.btnActionText}>Order</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />

      {/* Start / Complete Visit Modal */}
      {activeVisitClient ? (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>CLIENT VISIT RECORD</Text>
              <Text style={styles.modalSubtitle}>{activeVisitClient.name}</Text>

              {visitStep === 'START' ? (
                <View>
                  <View style={styles.gpsEvidenceBox}>
                    <Text style={styles.gpsLabel}>GPS Verification Evidence:</Text>
                    <Text style={styles.gpsValue}>
                      Distance to client: {visitDistance !== null ? `${visitDistance} meters` : 'Calculating...'}
                    </Text>
                    {isRadiusBreach ? (
                      <View style={styles.warningBox}>
                        <Text style={styles.warningText}>
                          ⚠️ You are beyond the allowed 100m visit radius. Please provide a justification note below:
                        </Text>
                        <TextInput
                          style={styles.reasonInput}
                          placeholder="e.g. Meeting held at client's warehouse"
                          value={exceptionReason}
                          onChangeText={setExceptionReason}
                        />
                      </View>
                    ) : (
                      <Text style={styles.verifiedText}>✅ Within authorized 100m client radius</Text>
                    )}
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={styles.btnCancel}
                      onPress={() => setActiveVisitClient(null)}
                    >
                      <Text style={styles.btnCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btnConfirm}
                      onPress={handleConfirmStartVisit}
                      disabled={submittingVisit}
                    >
                      {submittingVisit ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.btnConfirmText}>Confirm & Begin Visit</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View>
                  <Text style={styles.formLabel}>Visit Outcome</Text>
                  <View style={styles.outcomeRow}>
                    {['ORDER_TAKEN', 'PAYMENT_COLLECTED', 'FOLLOW_UP_REQUIRED', 'NO_ORDER'].map(
                      (outcome) => (
                        <TouchableOpacity
                          key={outcome}
                          style={[
                            styles.outcomeBtn,
                            visitOutcome === outcome ? styles.outcomeBtnActive : null,
                          ]}
                          onPress={() => setVisitOutcome(outcome)}
                        >
                          <Text
                            style={[
                              styles.outcomeBtnText,
                              visitOutcome === outcome ? styles.outcomeBtnTextActive : null,
                            ]}
                          >
                            {outcome.replace('_', ' ')}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>

                  <Text style={[styles.formLabel, { marginTop: 12 }]}>Visit Notes & Discussion</Text>
                  <TextInput
                    style={styles.notesInput}
                    placeholder="Enter discussion notes, requirements, or follow-up date..."
                    value={visitNotes}
                    onChangeText={setVisitNotes}
                    multiline
                    numberOfLines={3}
                  />

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={styles.btnConfirm}
                      onPress={handleCompleteVisit}
                      disabled={submittingVisit}
                    >
                      {submittingVisit ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.btnConfirmText}>Complete & Record Visit</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
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
  searchBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  filterBtn: {
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  filterBtnActive: {
    backgroundColor: '#fef3c7',
  },
  filterBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  filterBtnTextActive: {
    color: '#b45309',
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
    alignItems: 'flex-start',
  },
  clientName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  contactPerson: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  distanceBadge: {
    backgroundColor: '#f0fdfa',
    borderColor: '#99f6e4',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  distanceText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  address: {
    fontSize: 11,
    color: '#475569',
    marginTop: 6,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  balanceLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  balanceValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  balanceValueDue: {
    color: '#b45309',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  btnPrimary: {
    flex: 1.5,
    paddingVertical: 7,
    backgroundColor: '#0f766e',
    borderRadius: 6,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  btnAction: {
    flex: 1,
    paddingVertical: 7,
    backgroundColor: '#081224',
    borderRadius: 6,
    alignItems: 'center',
  },
  btnActionText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#0f766e',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 16,
  },
  gpsEvidenceBox: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  gpsLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#64748b',
  },
  gpsValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 2,
  },
  warningBox: {
    marginTop: 8,
    backgroundColor: '#fef3c7',
    padding: 8,
    borderRadius: 6,
  },
  warningText: {
    fontSize: 11,
    color: '#92400e',
    lineHeight: 14,
  },
  reasonInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 6,
    padding: 6,
    fontSize: 11,
    marginTop: 6,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#059669',
    marginTop: 6,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  btnConfirm: {
    flex: 2,
    paddingVertical: 10,
    backgroundColor: '#0f766e',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnConfirmText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  formLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 6,
  },
  outcomeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  outcomeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  outcomeBtnActive: {
    borderColor: '#0f766e',
    backgroundColor: '#f0fdfa',
  },
  outcomeBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  outcomeBtnTextActive: {
    color: '#0f766e',
  },
  notesInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    textAlignVertical: 'top',
  },
});
