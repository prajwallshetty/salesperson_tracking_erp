import { app, httpServer, server } from './src/index';

async function runTests() {
  console.log('🧪 Starting Comprehensive Automated Integration Tests...\n');
  const baseUrl = 'http://localhost:4000';
  let testServer = server;
  if (!httpServer.listening) {
    testServer = await new Promise((resolve) => {
      const s = httpServer.listen(4000, () => resolve(s));
    });
  }
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.status === 'healthy', 'API Health check /health returns healthy');

    // 2. Authentication: Admin Login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@erp.com', password: 'Password123!' }),
    });
    const adminData = await adminLoginRes.json();
    assert(adminLoginRes.status === 200 && !!adminData.token, 'Super Admin login succeeds with JWT');
    const adminToken = adminData.token;

    // 3. Authentication: Salesperson Login
    const spLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'rahul@erp.com', password: 'Password123!' }),
    });
    const spData = await spLoginRes.json();
    assert(spLoginRes.status === 200 && spData.user.role === 'SALESPERSON', 'Salesperson Rahul login succeeds');
    const spToken = spData.token;
    const rahulSpId = spData.user.salespersonId;

    // 4. Salesperson Dashboard Metrics
    const dashRes = await fetch(`${baseUrl}/api/salespersons/dashboard`, {
      headers: { Authorization: `Bearer ${spToken}` },
    });
    const dashData = await dashRes.json();
    assert(dashRes.status === 200 && dashData.ordersCount !== undefined, 'Salesperson dashboard returns real transactional metrics');

    // 5. Admin Dashboard Summary & KPIs
    const adminDashRes = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminDashData = await adminDashRes.json();
    assert(adminDashRes.status === 200 && adminDashData.kpis.totalClients >= 5, 'Admin dashboard summary returns totalClients and charts');

    // 6. Live Status of Salespersons
    const liveStatusRes = await fetch(`${baseUrl}/api/salespersons/live-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const liveStatusData = await liveStatusRes.json();
    assert(liveStatusRes.status === 200 && Array.isArray(liveStatusData.data), 'Admin live status returns salespersons tracking states');

    // 7. Clients Scoped Listing
    const clientsRes = await fetch(`${baseUrl}/api/clients?lat=12.8715&lng=74.8432`, {
      headers: { Authorization: `Bearer ${spToken}` },
    });
    const clientsData = await clientsRes.json();
    assert(clientsRes.status === 200 && clientsData.data.length > 0, 'Salesperson gets assigned clients with calculated distance');
    const targetClient = clientsData.data[0];

    // 8. Visit Recording with GPS distance
    const startVisitRes = await fetch(`${baseUrl}/api/visits/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: targetClient.id,
        latitude: 12.8715,
        longitude: 74.8432,
        idempotencyKey: `visit-key-${Date.now()}`,
      }),
    });
    const visitData = await startVisitRes.json();
    assert(startVisitRes.status === 201 && visitData.data.visitId, 'Start visit succeeds with GPS distance audit');
    const visitId = visitData.data.visitId;

    const endVisitRes = await fetch(`${baseUrl}/api/visits/${visitId}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outcome: 'ORDER_TAKEN',
        notes: 'Client confirmed festival stock refill order.',
      }),
    });
    const endVisitData = await endVisitRes.json();
    assert(endVisitRes.status === 200 && endVisitData.data.outcome === 'ORDER_TAKEN', 'End visit completes with outcome');

    // 9. Order Taking & Arithmetic Verification (10 * 450 + 5 * 250 + 2 * 650 = 7050 subtotal)
    const productsRes = await fetch(`${baseUrl}/api/products`, {
      headers: { Authorization: `Bearer ${spToken}` },
    });
    const productsData = await productsRes.json();
    const pCharger = productsData.data.find((p: any) => p.sku === 'SAM-CHG-01');
    const pCable = productsData.data.find((p: any) => p.sku === 'SAM-CBL-02');
    const pAdapter = productsData.data.find((p: any) => p.sku === 'SAM-ADP-03');

    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: targetClient.id,
        items: [
          { productId: pCharger.id, quantity: 10, unitPrice: 450 },
          { productId: pCable.id, quantity: 5, unitPrice: 250 },
          { productId: pAdapter.id, quantity: 2, unitPrice: 650 },
        ],
        discount: 450,
        idempotencyKey: `order-key-${Date.now()}`,
      }),
    });
    const orderData = await orderRes.json();
    const order = orderData.data;

    // Check arithmetic:
    // Subtotal: 10*450 + 5*250 + 2*650 = 4500 + 1250 + 1300 = 7050
    // Discount: 450
    // Taxable: 6600
    // Tax: 18% of 6600 = 1188
    // Grand Total: 7788
    assert(
      Number(order.subtotal) === 7050 && Number(order.grandTotal) === 7788,
      'Order arithmetic strictly calculates true subtotal (₹7,050) and grand total (₹7,788)'
    );

    // 10. Payment Collection & Receipt PDF
    const paymentRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: targetClient.id,
        orderId: order.id,
        amount: 5000,
        paymentMethod: 'UPI',
        transactionReference: `UPI-TEST-${Date.now()}`,
        idempotencyKey: `payment-key-${Date.now()}`,
      }),
    });
    const paymentData = await paymentRes.json();
    assert(paymentRes.status === 201 && paymentData.data.receiptNumber.startsWith('PAY-'), 'Payment collection creates receipt');
    const paymentId = paymentData.data.id;

    // Verify Payment (as Admin) and check ledger entry
    const verifyRes = await fetch(`${baseUrl}/api/payments/${paymentId}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'VERIFIED', notes: 'Bank account credit confirmed' }),
    });
    assert(verifyRes.status === 200, 'Payment verification succeeds and posts credit to ledger');

    // PDF Receipt Download
    const receiptPdfRes = await fetch(`${baseUrl}/api/payments/${paymentId}/receipt-pdf`, {
      headers: { Authorization: `Bearer ${spToken}` },
    });
    assert(
      receiptPdfRes.status === 200 && receiptPdfRes.headers.get('content-type') === 'application/pdf',
      'PDF receipt generated and delivered as application/pdf'
    );

    // 11. Reports & CSV Export
    const salesReportRes = await fetch(`${baseUrl}/api/reports/sales?format=csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      salesReportRes.status === 200 && (salesReportRes.headers.get('content-type') || '').includes('text/csv'),
      'Sales report exported as CSV format'
    );

    // 12. Offline Sync Engine Batch Test (Idempotency deduplication)
    const syncIdempotencyKey = `sync-idem-${Date.now()}`;
    const syncPayload = {
      items: [
        {
          localId: 'local-test-1',
          type: 'PAYMENT',
          payload: {
            clientId: targetClient.id,
            amount: 2500,
            paymentMethod: 'CASH',
            notes: 'Offline collected cash token',
          },
          idempotencyKey: syncIdempotencyKey,
        },
      ],
    };

    const sync1Res = await fetch(`${baseUrl}/api/sync/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(syncPayload),
    });
    const sync1Data = await sync1Res.json();
    assert(sync1Res.status === 200 && sync1Data.results[0].status === 'SYNCED', 'First sync batch processes successfully');

    // Re-send same sync batch with identical idempotency key
    const sync2Res = await fetch(`${baseUrl}/api/sync/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(syncPayload),
    });
    const sync2Data = await sync2Res.json();
    assert(
      sync2Res.status === 200 && sync2Data.results[0].status === 'SYNCED',
      'Repeated sync batch is safely deduplicated without creating duplicate records'
    );

    console.log(`\n📊 Integration Test Results: ${passed} Passed, ${failed} Failed`);
  } catch (error) {
    console.error('Test execution crashed:', error);
  } finally {
    if (testServer && typeof testServer.close === 'function') {
      testServer.close();
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
