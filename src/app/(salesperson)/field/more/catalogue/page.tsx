'use client';

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import BackHeader from '@/components/sales/BackHeader';
import { Card, EmptyState, Notice, SkeletonList, inputClass } from '@/components/sales/mobile';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { inr } from '@/lib/client/format';

export default function Catalogue() {
  const [products, setProducts] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      apiJson<{ data: any[] }>(`/api/products?limit=200&search=${encodeURIComponent(search)}`)
        .then((r) => setProducts(r.data))
        .catch((e) => {
          setProducts((p) => p ?? []);
          setError(errorMessage(e));
        });
    }, 250);
    return () => clearTimeout(id);
  }, [search]);
  return (
    <div className="space-y-3">
      <BackHeader title="Product catalogue" />
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
        <input aria-label="Search products" className={`${inputClass} pl-9`} placeholder="Search name, SKU, brand" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {products === null ? (
        <SkeletonList />
      ) : products.length === 0 ? (
        <EmptyState title="No products found" />
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <Card className="p-3">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-[11px] text-[#586570]">{p.sku} · {p.brand} · {p.categoryName}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{inr(p.sellingPrice, 2)}</p>
                    <p className="text-[11px] text-[#80909D] line-through">{inr(p.mrp, 2)}</p>
                  </div>
                </div>
                <p className={`text-[11px] mt-1 ${p.stock <= p.minimumStock ? 'text-[#92400E] font-semibold' : 'text-[#586570]'}`}>
                  GST {p.taxRate}% · Stock {p.stock} {p.unit}{p.stock <= p.minimumStock ? ' · low stock' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
