'use client';

import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { useRealtimeRefresh } from '@/components/shared/RealtimeProvider';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Minus, Plus, Search } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useField } from '@/features/field/FieldProvider';
import { newId, readJson, writeJson } from '@/features/field/storage';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { calculateOrderTotals } from '@/lib/domain/orderCalculator';
import { Card, Chip, EmptyState, Field, Notice, PrimaryButton, Sheet, SkeletonList, StatusPill, inputClass } from '@/components/sales/mobile';
import { formatDate, inr } from '@/lib/client/format';

function OrdersInner() {
  const { user } = useSession();
  const { submit, tracking } = useField();
  const params = useSearchParams();
  const router = useRouter();
  const cacheKey = `sg_cache_${user!.id}_catalogue`;

  const [orders, setOrders] = useState<any[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [productSearch, setProductSearch] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ offline: boolean; order?: any } | null>(null);
  const draftKey = useRef<string>(`order-${newId()}`);

  const loadOrders = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (statusFilter) qs.set('status', statusFilter);
      setOrders((await apiJson<{ data: any[] }>(`/api/orders?${qs}`)).data);
      setOrdersError(null);
    } catch (err) {
      setOrders((o) => o ?? []);
      setOrdersError(errorMessage(err));
    }
  }, [statusFilter]);

  const loadCatalogue = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([apiJson<{ data: any[] }>('/api/products?limit=500'), apiJson<{ data: any[] }>('/api/clients?limit=500')]);
      setProducts(p.data);
      setClients(c.data);
      writeJson(cacheKey, { products: p.data, clients: c.data, at: new Date().toISOString() });
    } catch {
      const cached = readJson<{ products: any[]; clients: any[] } | null>(cacheKey, null);
      if (cached) {
        setProducts(cached.products);
        setClients(cached.clients);
      }
    }
  }, [cacheKey]);

  // Office-side changes: order approvals, new/changed products, client assignments.
  useRealtimeRefresh(loadOrders, [SOCKET_EVENTS.ORDER_STATUS_CHANGED]);
  useRealtimeRefresh(loadCatalogue, [SOCKET_EVENTS.PRODUCT_CHANGED, SOCKET_EVENTS.CLIENT_ASSIGNED, SOCKET_EVENTS.CLIENT_CHANGED]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);
  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);
  useEffect(() => {
    if (params.get('new')) {
      setOpen(true);
      if (params.get('clientId')) setClientId(params.get('clientId')!);
    }
  }, [params]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  // Same inputs the server uses: catalogue price, product discount, product tax rate.
  const totals = calculateOrderTotals(
    lines.map(([id, q]) => {
      const p = productMap.get(id);
      return { quantity: q, unitPrice: Number(p?.sellingPrice || 0), discount: Number(p?.discount || 0), taxRate: Number(p?.taxRate ?? 18) };
    }),
    Number(discount) || 0
  );

  const setQty = (id: string, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(99999, Math.floor(q) || 0)) }));
  const visibleProducts = products.filter((p) => {
    const q = productSearch.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q);
  });

  const reset = () => {
    setCart({});
    setDiscount('');
    setNotes('');
    setFormError(null);
    draftKey.current = `order-${newId()}`;
  };

  const close = () => {
    setOpen(false);
    setResult(null);
    if (params.get('new')) router.replace('/field/orders');
  };

  const place = async () => {
    setFormError(null);
    if (!clientId) return setFormError('Choose a client.');
    if (!lines.length) return setFormError('Add at least one product.');
    if (Number(discount) < 0) return setFormError('Discount cannot be negative.');
    setBusy(true);
    const fix = tracking.lastFix;
    const client = clients.find((c) => c.id === clientId);
    const res = await submit<{ data: any }>({
      url: '/api/orders',
      body: {
        clientId,
        items: lines.map(([productId, quantity]) => ({ productId, quantity })),
        discount: Number(discount) || 0,
        notes: notes.trim() || undefined,
        latitude: fix?.latitude,
        longitude: fix?.longitude,
      },
      type: 'ORDER',
      label: `Order for ${client?.name || 'client'} (${inr(totals.grandTotal)})`,
      idempotencyKey: draftKey.current,
    });
    setBusy(false);
    if (!res.ok) return setFormError(res.error);
    setResult({ offline: res.offline, order: res.data?.data });
    reset();
    loadOrders();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-[#0B1320]">Orders</h1>
        <button onClick={() => setOpen(true)} className="min-h-[40px] px-4 rounded-xl bg-[#000000] text-white text-xs font-bold">+ New order</button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['', 'SUBMITTED', 'CONFIRMED', 'DELIVERED', 'REJECTED', 'CANCELLED'].map((s) => (
          <Chip key={s || 'all'} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}</Chip>
        ))}
      </div>
      {ordersError && <Notice tone="error">{ordersError}</Notice>}
      {orders === null ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <EmptyState title="No orders yet" hint="Tap “New order” to book one." />
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Card>
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm font-bold text-[#0B1320]">{o.orderNumber}</p>
                  <StatusPill status={o.status} />
                </div>
                <p className="text-xs text-[#586570] mt-0.5">{o.clientName}</p>
                <p className="text-[11px] text-[#80909D]">{formatDate(o.createdAt)} · {o.itemsCount} item{o.itemsCount === 1 ? '' : 's'}</p>
                <div className="flex justify-between mt-2 pt-2 border-t border-[#E2E7EC] text-xs">
                  <span className="text-[#586570]">Grand total (incl. GST)</span>
                  <span className="font-bold text-[#0B1320]">{inr(o.grandTotal, 2)}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={open}
        title={result ? 'Order status' : 'New sales order'}
        onClose={close}
        footer={
          result ? (
            <PrimaryButton onClick={close}>Done</PrimaryButton>
          ) : (
            <PrimaryButton onClick={place} loading={busy} disabled={!lines.length || !clientId}>
              Submit order · {inr(totals.grandTotal, 2)}
            </PrimaryButton>
          )
        }
      >
        {result ? (
          result.offline ? (
            <Notice tone="warning">No connection. The order is saved on this device and will be submitted automatically when you reconnect. It is not confirmed until it syncs.</Notice>
          ) : (
            <div className="space-y-2">
              <Notice tone="success">Order {result.order?.orderNumber} booked.</Notice>
              <p className="text-sm text-[#0B1320]">
                Status: <StatusPill status={result.order?.status || 'SUBMITTED'} />{' '}
                {result.order?.status === 'SUBMITTED' && <span className="text-xs text-[#586570]">Awaiting manager approval.</span>}
              </p>
              <p className="text-sm">Grand total: <strong>{inr(result.order?.grandTotal, 2)}</strong></p>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <Field label="Client" htmlFor="order-client">
              <select id="order-client" className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.city}</option>
                ))}
              </select>
            </Field>
            <div>
              <p className="text-xs font-semibold text-[#0B1320] mb-1.5">Products</p>
              <div className="relative mb-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
                <input aria-label="Search products" className={`${inputClass} pl-9`} placeholder="Search name or SKU" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
              </div>
              {products.length === 0 ? (
                <p className="text-xs text-[#586570]">Catalogue unavailable offline until it has loaded once.</p>
              ) : (
                <ul className="divide-y divide-[#E2E7EC] border border-[#E2E7EC] rounded-xl max-h-[40vh] overflow-y-auto">
                  {visibleProducts.map((p) => {
                    const q = cart[p.id] || 0;
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0B1320] truncate">{p.name}</p>
                          <p className="text-[11px] text-[#586570]">
                            {inr(p.sellingPrice, 2)} · GST {p.taxRate}%{p.discount > 0 ? ` · −${inr(p.discount)}` : ''} · Stock {p.stock}
                          </p>
                          {q > p.stock && <p className="text-[11px] text-[#92400E]">Exceeds current stock</p>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label={`Decrease ${p.name}`} onClick={() => setQty(p.id, q - 1)} className="w-9 h-9 rounded-lg border border-[#CBD2D7] flex items-center justify-center"><Minus className="w-4 h-4" /></button>
                          <input
                            aria-label={`Quantity of ${p.name}`}
                            inputMode="numeric"
                            className="w-12 h-9 text-center border border-[#CBD2D7] rounded-lg text-sm"
                            value={q || ''}
                            placeholder="0"
                            onChange={(e) => setQty(p.id, Number(e.target.value.replace(/\D/g, '')))}
                          />
                          <button type="button" aria-label={`Increase ${p.name}`} onClick={() => setQty(p.id, q + 1)} className="w-9 h-9 rounded-lg border border-[#CBD2D7] flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order discount (₹)" htmlFor="order-discount">
                <input id="order-discount" inputMode="decimal" className={inputClass} value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
              </Field>
              <Field label="Remarks" htmlFor="order-notes">
                <input id="order-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery notes" />
              </Field>
            </div>
            <dl className="rounded-xl bg-[#F3F5F6] p-3 text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-[#586570]">Subtotal</dt><dd>{inr(totals.subtotal, 2)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#586570]">Discount</dt><dd>−{inr(totals.discount, 2)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#586570]">GST</dt><dd>+{inr(totals.tax, 2)}</dd></div>
              <div className="flex justify-between font-bold pt-1 border-t border-[#E2E7EC]"><dt>Grand total</dt><dd>{inr(totals.grandTotal, 2)}</dd></div>
            </dl>
            <p className="text-[11px] text-[#80909D]">Final prices are calculated by the server from the current catalogue.</p>
            {formError && <Notice tone="error">{formError}</Notice>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

export default function FieldOrders() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <OrdersInner />
    </Suspense>
  );
}
