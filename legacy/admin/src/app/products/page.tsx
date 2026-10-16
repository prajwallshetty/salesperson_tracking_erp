'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Package, Search, Plus, Tag, AlertCircle, CheckCircle, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCat, setSelectedCat] = useState('');
  const [loading, setLoading] = useState(true);

  // New product modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    sku: '',
    barcode: '',
    name: '',
    categoryId: '',
    brand: 'General',
    description: '',
    unit: 'PCS',
    sellingPrice: 500,
    mrp: 699,
    taxRate: 18.0,
    discount: 0,
    stock: 50,
    minimumStock: 10,
  });

  const fetchData = async () => {
    if (!token) return;
    try {
      let url = `/api/products?search=${encodeURIComponent(search)}`;
      if (selectedCat) url += `&categoryId=${selectedCat}`;

      const [pRes, cRes] = await Promise.all([
        fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        fetch('/api/products/meta/categories', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      ]);

      setProducts(pRes.data || []);
      setCategories(cRes.data || []);
      if (!formData.categoryId && cRes.data?.length > 0) {
        setFormData((prev) => ({ ...prev, categoryId: cRes.data[0].id }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, search, selectedCat]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowAddModal(false);
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create product');
      }
    } catch (e: any) {
      alert(e.message || 'Error creating product');
    }
  };

  return (
    <AdminShell title="Product Catalog & Inventory">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Merchandise Inventory
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Stock Items, Pricing & GST Rates
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Maintain product SKUs, tax percentages, warehouse stock levels, and distributor wholesale prices.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowAddModal(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              Add Product
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                type="text"
                placeholder="Search by SKU, product name, brand..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-72"
              />
            </div>

            <select
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Products Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Product Details</th>
                  <th className="py-3 px-4">SKU / Barcode</th>
                  <th className="py-3 px-4">Category & Brand</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-right">MRP</th>
                  <th className="py-3 px-4 text-center">GST Rate</th>
                  <th className="py-3 px-4 text-center">Available Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      Loading catalog...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    const isLowStock = p.stock <= p.minimumStock;
                    return (
                      <tr key={p.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-[#0B1320]">{p.name}</p>
                          <p className="text-[11px] text-[#586570] truncate max-w-xs">{p.description || '-'}</p>
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-[#0B1320]">
                          <p>{p.sku}</p>
                          {p.barcode && <p className="text-[10px] text-[#80909D]">{p.barcode}</p>}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium text-[#0B1320] bg-[#F3F5F6] border border-[#E2E7EC] px-2 py-0.5 rounded-md text-[11px]">
                            {p.category?.name || 'General'}
                          </span>
                          <p className="text-[11px] text-[#586570] mt-0.5">{p.brand}</p>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-[#0B1320]">
                          ₹{Number(p.sellingPrice).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-right text-[#586570]">
                          ₹{Number(p.mrp).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-medium text-[#0B1320]">
                          {p.taxRate}%
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                              isLowStock
                                ? 'bg-[#FDF2F2] text-[#991B1B] border-[#F8C4C4]'
                                : 'bg-[#E6F4DD] text-[#2E6819] border-[#B4E39C]'
                            }`}
                          >
                            {p.stock} {p.unit}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E7EC]">
                <h3 className="text-base font-bold text-[#0B1320]">Add New Catalog Item</h3>
                <button onClick={() => setShowAddModal(false)} className="text-[#586570] hover:text-[#0B1320]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateProduct} className="py-4 space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Product Title</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Samsung 45W Power Adapter"
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">SKU Code</label>
                    <input
                      type="text"
                      required
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                      placeholder="SAM-45W-BLK"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Category</label>
                    <select
                      required
                      value={formData.categoryId}
                      onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Selling Price (₹)</label>
                    <input
                      type="number"
                      required
                      value={formData.sellingPrice}
                      onChange={(e) => setFormData({ ...formData, sellingPrice: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">MRP (₹)</label>
                    <input
                      type="number"
                      required
                      value={formData.mrp}
                      onChange={(e) => setFormData({ ...formData, mrp: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Tax Rate (%)</label>
                    <input
                      type="number"
                      value={formData.taxRate}
                      onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Current Stock</label>
                    <input
                      type="number"
                      value={formData.stock}
                      onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Min. Alert Stock</label>
                    <input
                      type="number"
                      value={formData.minimumStock}
                      onChange={(e) => setFormData({ ...formData, minimumStock: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-[#E2E7EC]">
                  <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit">
                    Save Item
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
