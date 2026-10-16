'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import WorkflowStepper from '@/components/ui/WorkflowStepper';
import BackLink from '@/components/ui/BackLink';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  ShoppingCart,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  Truck,
  PackageCheck,
  Clock,
  X,
  Plus,
  ArrowRight,
  ArrowLeft,
  Building2,
  Package,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { calculateOrderTotals } from '@/shared';

const ORDER_STEPS = [
  { id: 'client', label: 'Client' },
  { id: 'products', label: 'Products' },
  { id: 'review', label: 'Review' },
  { id: 'submit', label: 'Submit' },
  { id: 'confirmation', label: 'Confirmation' },
];

function OrdersContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const initialNew = searchParams.get('new') === 'true';
  const { token } = useAuth();

  const [orders, setOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Multi-step New Order Mode
  const [isCreatingOrder, setIsCreatingOrder] = useState(initialNew);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Form State
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [cartItems, setCartItems] = useState<Record<string, number>>({});
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [orderNotes, setOrderNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [createdOrderResult, setCreatedOrderResult] = useState<any>(null);

  // Selected Order Detail Modal
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchOrders = async () => {
    if (!token) return;
    try {
      let url = `/api/orders?search=${encodeURIComponent(search)}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setOrders(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchClientsAndProducts = async () => {
    if (!token) return;
    try {
      const [cRes, pRes] = await Promise.all([
        fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/products', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (cRes.ok && pRes.ok) {
        const cJson = await cRes.json();
        const pJson = await pRes.json();
        setClients(cJson.data || []);
        setProducts(pJson.data || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [token, statusFilter, search]);

  useEffect(() => {
    if (isCreatingOrder && clients.length === 0) {
      fetchClientsAndProducts();
    }
  }, [isCreatingOrder, token]);

  const openOrderDetail = async (id: string) => {
    setSelectedOrderId(id);
    try {
      const res = await fetch(`/api/orders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setOrderDetail(json.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedOrderId) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/orders/${selectedOrderId}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        openOrderDetail(selectedOrderId);
        fetchOrders();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update order status');
      }
    } catch (e: any) {
      alert(e.message || 'Error updating order status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Calculation helpers
  const cartLines = Object.entries(cartItems)
    .filter(([_, qty]) => qty > 0)
    .map(([productId, quantity]) => {
      const p = products.find((prod) => prod.id === productId);
      return {
        productId,
        quantity,
        unitPrice: p ? Number(p.sellingPrice) : 0,
        taxRate: p ? Number(p.taxRate) : 18,
      };
    });

  const totals = calculateOrderTotals(cartLines, Number(orderDiscount) || 0);

  const handleCreateOrderSubmit = async () => {
    if (!selectedClient || cartLines.length === 0) return;
    setSubmittingOrder(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          items: cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          discount: Number(orderDiscount) || 0,
          notes: orderNotes,
          idempotencyKey: `order-web-${Date.now()}`,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setCreatedOrderResult(json.data);
        setCurrentStepIndex(4); // Confirmation step
        fetchOrders();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to submit order');
      }
    } catch (e: any) {
      alert(e.message || 'Error submitting order');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const resetOrderWizard = () => {
    setIsCreatingOrder(false);
    setCurrentStepIndex(0);
    setSelectedClient(null);
    setCartItems({});
    setOrderDiscount('0');
    setOrderNotes('');
    setCreatedOrderResult(null);
  };

  return (
    <AdminShell title="Sales Orders">
      <div className="space-y-6 max-w-7xl">
        {/* If in multi-step wizard mode */}
        {isCreatingOrder ? (
          <div>
            <BackLink
              href="#"
              label="Back to orders list"
              className="cursor-pointer"
              onClick={(e: any) => {
                e.preventDefault();
                resetOrderWizard();
              }}
            />

            {/* Stepper Panel (Reference Image Style) */}
            <WorkflowStepper
              steps={ORDER_STEPS}
              currentStepIndex={currentStepIndex}
              onStepClick={(idx) => setCurrentStepIndex(idx)}
              className="mb-6"
            />

            {/* Step Form Panel */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 md:p-8">
              {/* Step 0: Select Client */}
              {currentStepIndex === 0 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Select Client</h2>
                  <p className="text-xs text-[#586570] mb-6">Choose an authorized customer account for this booking.</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto p-1">
                    {clients.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => setSelectedClient(c)}
                        className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedClient?.id === c.id
                            ? 'border-[#081224] bg-[#F3F5F6] ring-1 ring-[#081224]'
                            : 'border-[#CBD2D7] hover:border-[#80909D] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm text-[#0B1320]">{c.name}</p>
                          <span className="text-[11px] font-mono text-[#586570]">{c.city}</span>
                        </div>
                        <p className="text-xs text-[#586570] mt-1">{c.contactPerson} • {c.phone}</p>
                        <p className="text-[11px] text-[#2C4656] mt-2 font-medium">
                          Outstanding: ₹{Number(c.currentOutstanding || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={resetOrderWizard}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!selectedClient}
                      onClick={() => setCurrentStepIndex(1)}
                      icon={<ArrowRight className="w-4 h-4" />}
                    >
                      Continue to Products
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 1: Add Products */}
              {currentStepIndex === 1 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-[#0B1320]">Add Products</h2>
                      <p className="text-xs text-[#586570]">
                        Order for: <strong className="text-[#0B1320]">{selectedClient?.name}</strong>
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-[#0B1320] bg-[#F3F5F6] px-3 py-1.5 rounded-lg border border-[#CBD2D7]">
                      {cartLines.length} item(s) selected
                    </span>
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto p-1">
                    {products.map((p) => {
                      const qty = cartItems[p.id] || 0;
                      return (
                        <div
                          key={p.id}
                          className="p-4 rounded-xl border border-[#CBD2D7] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                          <div>
                            <p className="font-semibold text-sm text-[#0B1320]">{p.name}</p>
                            <p className="text-xs text-[#586570]">SKU: {p.sku} • Stock: {p.stock} units</p>
                            <p className="text-xs font-semibold text-[#0B1320] mt-1">₹{Number(p.sellingPrice).toLocaleString('en-IN')}</p>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setCartItems((prev) => ({ ...prev, [p.id]: Math.max(0, qty - 1) }))}
                              className="w-8 h-8 rounded-lg border border-[#CBD2D7] bg-white hover:bg-[#F3F5F6] font-bold text-[#0B1320]"
                            >
                              -
                            </button>
                            <span className="w-8 text-center text-sm font-semibold text-[#0B1320]">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setCartItems((prev) => ({ ...prev, [p.id]: qty + 1 }))}
                              className="w-8 h-8 rounded-lg border border-[#CBD2D7] bg-white hover:bg-[#F3F5F6] font-bold text-[#0B1320]"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between items-center mt-8 pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(0)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      disabled={cartLines.length === 0}
                      onClick={() => setCurrentStepIndex(2)}
                      icon={<ArrowRight className="w-4 h-4" />}
                    >
                      Review Pricing
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Review Calculations */}
              {currentStepIndex === 2 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Review & Discounts</h2>
                  <p className="text-xs text-[#586570] mb-6">Verify minor-unit accurate GST and promotional allowances.</p>

                  <div className="bg-[#F3F5F6] border border-[#CBD2D7] rounded-xl p-5 mb-6 space-y-3">
                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Gross Subtotal</span>
                      <span className="font-semibold text-[#0B1320]">₹{totals.subtotal.toLocaleString('en-IN')}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#586570]">
                      <span>Promotional Discount (₹)</span>
                      <input
                        type="number"
                        value={orderDiscount}
                        onChange={(e) => setOrderDiscount(e.target.value)}
                        className="w-28 text-right bg-white border border-[#CBD2D7] rounded-lg px-2 py-1 text-xs text-[#0B1320] font-semibold"
                      />
                    </div>

                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Net Taxable Value</span>
                      <span className="font-semibold text-[#0B1320]">₹{totals.taxableAmount.toLocaleString('en-IN')}</span>
                    </div>

                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Applicable GST (18%)</span>
                      <span className="font-semibold text-[#0B1320]">₹{totals.tax.toLocaleString('en-IN')}</span>
                    </div>

                    <div className="pt-3 border-t border-[#CBD2D7] flex justify-between text-sm font-bold text-[#0B1320]">
                      <span>Grand Total</span>
                      <span>₹{totals.grandTotal.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(1)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button variant="primary" onClick={() => setCurrentStepIndex(3)} icon={<ArrowRight className="w-4 h-4" />}>
                      Proceed to Notes
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Submit Order */}
              {currentStepIndex === 3 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Final Submission</h2>
                  <p className="text-xs text-[#586570] mb-6">Attach fulfillment instructions and confirm placement.</p>

                  <div className="mb-6">
                    <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">Delivery Notes & Remarks</label>
                    <textarea
                      rows={3}
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder="e.g., Deliver during warehouse loading hours."
                      className="w-full bg-white border border-[#CBD2D7] rounded-xl p-3 text-xs text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>

                  <div className="p-4 rounded-xl bg-[#E6F4DD] border border-[#B4E39C] text-xs text-[#2E6819] mb-6">
                    Ready to book: <strong>{cartLines.length} product(s)</strong> for <strong>{selectedClient?.name}</strong> totaling <strong>₹{totals.grandTotal.toLocaleString('en-IN')}</strong>.
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(2)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      disabled={submittingOrder}
                      onClick={handleCreateOrderSubmit}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      {submittingOrder ? 'Submitting...' : 'Submit Order'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Confirmation */}
              {currentStepIndex === 4 && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-[#E6F4DD] border border-[#B4E39C] text-[#2E6819] flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold text-[#0B1320]">Order Successfully Created!</h2>
                  <p className="text-sm font-semibold text-[#259DC3] mt-1">
                    {createdOrderResult?.orderNumber || 'ORD-2026-CONFIRMED'}
                  </p>
                  <p className="text-xs text-[#586570] mt-2 max-w-md mx-auto">
                    The purchase order has been logged into the system and is ready for processing and dispatch.
                  </p>

                  <div className="mt-8 flex justify-center gap-3">
                    <Button variant="primary" onClick={resetOrderWizard}>
                      Return to Orders List
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Normal List View */
          <>
            {/* Header & Filter Bar */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
                  Commercial Registry
                </span>
                <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
                  Order Management & Approvals
                </h1>
                <p className="text-xs text-[#586570] mt-1">
                  Review purchase orders, approve pending requests, and monitor fulfillment status.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  id="btn-new-order"
                  variant="primary"
                  size="md"
                  onClick={() => setIsCreatingOrder(true)}
                  icon={<Plus className="w-4 h-4" />}
                >
                  New Order
                </Button>
              </div>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {['', 'SUBMITTED', 'CONFIRMED', 'DELIVERED'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      statusFilter === st
                        ? 'bg-[#081224] text-white border-[#081224]'
                        : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
                    }`}
                  >
                    {st === '' ? 'All Orders' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
                <input
                  type="text"
                  placeholder="Search orders, clients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-64"
                />
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                      <th className="py-3 px-4">Order #</th>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Salesperson</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Grand Total</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7EC]">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[#80909D]">
                          Loading orders...
                        </td>
                      </tr>
                    ) : orders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[#80909D]">
                          No orders found matching the filter criteria.
                        </td>
                      </tr>
                    ) : (
                      orders.map((o) => (
                        <tr key={o.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-[#0B1320]">
                            {o.orderNumber}
                          </td>
                          <td className="py-3 px-4 font-medium text-[#0B1320]">{o.clientName}</td>
                          <td className="py-3 px-4 text-[#586570]">
                            {o.salespersonName}{' '}
                            <span className="text-[10px] text-[#80909D]">({o.salespersonCode})</span>
                          </td>
                          <td className="py-3 px-4 text-[#586570]">
                            {new Date(o.createdAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-[#0B1320]">
                            ₹{Number(o.grandTotal).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={o.status} />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => openOrderDetail(o.id)}
                              className="px-2.5 py-1 rounded-md text-xs font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Order Details Drawer / Modal */}
        {selectedOrderId && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-xl w-full p-6 shadow-xl animate-in fade-in">
              <div className="flex items-center justify-between pb-4 border-b border-[#E2E7EC]">
                <div>
                  <h3 className="text-base font-bold text-[#0B1320]">
                    {orderDetail?.orderNumber || 'Order Details'}
                  </h3>
                  <p className="text-xs text-[#586570]">
                    Placed by {orderDetail?.salespersonName} on{' '}
                    {orderDetail && new Date(orderDetail.createdAt).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedOrderId(null)}
                  className="p-1 rounded-lg text-[#586570] hover:bg-[#F3F5F6]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {orderDetail ? (
                <div className="py-4 space-y-4 text-xs">
                  {/* Client Info */}
                  <div className="bg-[#F3F5F6] p-3 rounded-lg border border-[#E2E7EC] flex justify-between">
                    <div>
                      <p className="font-semibold text-[#0B1320]">{orderDetail.client?.name}</p>
                      <p className="text-[#586570]">{orderDetail.client?.city}, {orderDetail.client?.state}</p>
                    </div>
                    <StatusBadge status={orderDetail.status} />
                  </div>

                  {/* Line Items */}
                  <div className="border border-[#CBD2D7] rounded-lg overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-[#F3F5F6] text-[#586570] font-semibold">
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2 text-center">Qty</th>
                          <th className="p-2 text-right">Price</th>
                          <th className="p-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E7EC]">
                        {orderDetail.items?.map((item: any) => (
                          <tr key={item.id}>
                            <td className="p-2 text-[#0B1320] font-medium">{item.productName}</td>
                            <td className="p-2 text-center text-[#586570]">{item.quantity}</td>
                            <td className="p-2 text-right text-[#586570]">₹{Number(item.unitPrice).toLocaleString('en-IN')}</td>
                            <td className="p-2 text-right font-semibold text-[#0B1320]">₹{Number(item.total).toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals */}
                  <div className="space-y-1 text-right pt-2 border-t border-[#E2E7EC]">
                    <p className="text-[#586570]">Subtotal: <span className="font-semibold text-[#0B1320]">₹{Number(orderDetail.subtotal).toLocaleString('en-IN')}</span></p>
                    <p className="text-[#586570]">Discount: <span className="font-semibold text-[#0B1320]">₹{Number(orderDetail.discount).toLocaleString('en-IN')}</span></p>
                    <p className="text-[#586570]">GST: <span className="font-semibold text-[#0B1320]">₹{Number(orderDetail.tax).toLocaleString('en-IN')}</span></p>
                    <p className="text-sm font-bold text-[#0B1320] pt-1 border-t border-[#E2E7EC]">
                      Grand Total: ₹{Number(orderDetail.grandTotal).toLocaleString('en-IN')}
                    </p>
                  </div>

                  {/* Status Transitions */}
                  <div className="pt-3 border-t border-[#E2E7EC] flex flex-wrap gap-2 justify-end">
                    {orderDetail.status === 'SUBMITTED' && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={updatingStatus}
                        onClick={() => handleUpdateStatus('CONFIRMED')}
                      >
                        Approve & Confirm
                      </Button>
                    )}
                    {orderDetail.status === 'CONFIRMED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={updatingStatus}
                        onClick={() => handleUpdateStatus('DELIVERED')}
                      >
                        Mark as Delivered
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setSelectedOrderId(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-[#80909D]">Loading details...</div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-[#586570]">Loading orders module...</div>}>
      <OrdersContent />
    </Suspense>
  );
}
