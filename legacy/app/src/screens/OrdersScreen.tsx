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
import { getCurrentCoordinates } from '../services/locationService';
import { enqueueOperation, getCachedProducts, cacheProducts } from '../storage/db';
import { calculateOrderTotals } from '../shared';

interface OrdersScreenProps {
  preselectedClient?: any;
}

export default function OrdersScreen({ preselectedClient }: OrdersScreenProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Order Wizard Modal State
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(preselectedClient || null);
  const [cartItems, setCartItems] = useState<Record<string, number>>({});
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [orderNotes, setOrderNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  const fetchOrders = async () => {
    try {
      const [oRes, pRes, cRes] = await Promise.all([
        apiRequest('/api/orders'),
        apiRequest('/api/products'),
        apiRequest('/api/clients'),
      ]);
      setOrders(oRes.data || []);
      setProducts(pRes.data || []);
      setClients(cRes.data || []);
      await cacheProducts(pRes.data || []);
    } catch (e) {
      const cached = await getCachedProducts();
      if (cached.length > 0) setProducts(cached);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    if (preselectedClient) {
      setSelectedClient(preselectedClient);
      setShowOrderModal(true);
    }
  }, [preselectedClient]);

  const updateQuantity = (productId: string, delta: number) => {
    setCartItems((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  // Live order calculations
  const productMap = new Map(products.map((p) => [p.id, p]));
  const calcItems = Object.entries(cartItems).map(([id, qty]) => {
    const p = productMap.get(id);
    return {
      quantity: qty,
      unitPrice: p ? Number(p.sellingPrice) : 0,
      taxRate: p ? Number(p.taxRate) : 18.0,
    };
  });

  const discountNum = parseFloat(orderDiscount) || 0;
  const calculated = calculateOrderTotals(calcItems, discountNum);

  const handleCreateOrder = async () => {
    if (!selectedClient) {
      Alert.alert('Error', 'Please choose a client');
      return;
    }
    if (Object.keys(cartItems).length === 0) {
      Alert.alert('Empty Order', 'Please add at least one product to cart');
      return;
    }

    setSubmittingOrder(true);
    const coords = await getCurrentCoordinates();

    const orderPayload = {
      clientId: selectedClient.id,
      items: Object.entries(cartItems).map(([productId, quantity]) => ({
        productId,
        quantity,
      })),
      discount: discountNum,
      notes: orderNotes,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      idempotencyKey: `order-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };

    try {
      try {
        await apiRequest('/api/orders', {
          method: 'POST',
          body: JSON.stringify(orderPayload),
        });
        Alert.alert('Order Placed', 'Order submitted and invoice generated successfully.');
      } catch (networkErr) {
        // Enqueue offline
        await enqueueOperation('ORDER', orderPayload, orderPayload.idempotencyKey);
        Alert.alert('Queued Offline', 'Order saved locally. Will synchronize when online.');
      }

      setShowOrderModal(false);
      setCartItems({});
      setOrderDiscount('0');
      setOrderNotes('');
      fetchOrders();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <Text style={styles.title}>Orders ({orders.length})</Text>
        <TouchableOpacity
          style={styles.newOrderBtn}
          onPress={() => {
            setShowOrderModal(true);
            if (!selectedClient && clients.length > 0) {
              setSelectedClient(clients[0]);
            }
          }}
        >
          <Text style={styles.newOrderBtnText}>+ New Order</Text>
        </TouchableOpacity>
      </View>

      {/* Orders List */}
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderNumber}>{item.orderNumber}</Text>
              <View
                style={[
                  styles.statusBadge,
                  item.status === 'CONFIRMED'
                    ? styles.statusConfirmed
                    : styles.statusSubmitted,
                ]}
              >
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>

            <Text style={styles.clientName}>{item.clientName}</Text>
            <Text style={styles.orderMeta}>
              {new Date(item.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} •{' '}
              {item.itemsCount} products
            </Text>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Grand Total (incl. GST):</Text>
              <Text style={styles.totalValue}>₹{Number(item.grandTotal).toLocaleString('en-IN')}</Text>
            </View>
          </View>
        )}
      />

      {/* New Order Wizard Modal */}
      {showOrderModal ? (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.wizardBox}>
              <View style={styles.wizardHeader}>
                <Text style={styles.wizardTitle}>CREATE SALES ORDER</Text>
                <TouchableOpacity onPress={() => setShowOrderModal(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.wizardScroll}>
                {/* Client selection */}
                <Text style={styles.fieldLabel}>Select Client</Text>
                <View style={styles.clientPickerContainer}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                </View>

                {/* Product catalog with +/- qty */}
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Add Products from Catalog</Text>
                {products.map((p) => {
                  const qty = cartItems[p.id] || 0;
                  return (
                    <View key={p.id} style={styles.productRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pName}>{p.name}</Text>
                        <Text style={styles.pPrice}>
                          ₹{p.sellingPrice} • Stock: {p.stock}
                        </Text>
                      </View>
                      <View style={styles.qtyControls}>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() => updateQuantity(p.id, -1)}
                        >
                          <Text style={styles.qtyBtnText}>-</Text>
                        </TouchableOpacity>
                        <Text style={styles.qtyDisplay}>{qty}</Text>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() => updateQuantity(p.id, 1)}
                        >
                          <Text style={styles.qtyBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                {/* Order discount & notes */}
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Order Discount (₹)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={orderDiscount}
                  onChangeText={setOrderDiscount}
                  placeholder="0"
                />

                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Order Remarks</Text>
                <TextInput
                  style={styles.input}
                  value={orderNotes}
                  onChangeText={setOrderNotes}
                  placeholder="Delivery or packing instructions..."
                />

                {/* Financial Summary */}
                <View style={styles.summaryCard}>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Subtotal:</Text>
                    <Text style={styles.breakdownVal}>₹{calculated.subtotal.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount:</Text>
                    <Text style={styles.breakdownVal}>-₹{calculated.discount.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>GST Tax (18%):</Text>
                    <Text style={styles.breakdownVal}>+₹{calculated.tax.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={[styles.breakdownRow, styles.grandTotalRow]}>
                    <Text style={styles.grandTotalLabel}>Grand Total:</Text>
                    <Text style={styles.grandTotalVal}>₹{calculated.grandTotal.toLocaleString('en-IN')}</Text>
                  </View>
                </View>
              </ScrollView>

              <TouchableOpacity
                style={styles.submitOrderBtn}
                onPress={handleCreateOrder}
                disabled={submittingOrder}
              >
                {submittingOrder ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.submitOrderBtnText}>Submit Order (₹{calculated.grandTotal})</Text>
                )}
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
  newOrderBtn: {
    backgroundColor: '#0f766e',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  newOrderBtnText: {
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
  orderNumber: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusConfirmed: {
    backgroundColor: '#dbeafe',
  },
  statusSubmitted: {
    backgroundColor: '#fef3c7',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1e3a8a',
  },
  clientName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 6,
  },
  orderMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  totalLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
  },
  wizardBox: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxHeight: '90%',
    borderRadius: 18,
    padding: 18,
  },
  wizardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  wizardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  closeText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 'bold',
  },
  wizardScroll: {
    maxHeight: 450,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 6,
  },
  clientPickerContainer: {
    flexDirection: 'row',
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
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  pPrice: {
    fontSize: 10,
    color: '#64748b',
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  qtyBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#334155',
  },
  qtyDisplay: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f172a',
    width: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  summaryCard: {
    marginTop: 16,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  breakdownLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  breakdownVal: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
  },
  grandTotalRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  grandTotalLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  grandTotalVal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f766e',
  },
  submitOrderBtn: {
    backgroundColor: '#0f766e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  submitOrderBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
