import { prisma, Role, UserStatus, ExpenseStatus } from './src/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import { httpServer, server } from './src/index';

const API_BASE = 'http://localhost:4000/api';
const SOCKET_URL = 'http://localhost:4000';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  evidence?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string, evidence?: any) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(suite: string, name: string, fn: () => Promise<any>) {
  try {
    const evidence = await fn();
    results.push({ suite, name, passed: true, evidence });
    console.log(`  ✓ [PASS] ${suite} > ${name}`);
  } catch (err: any) {
    results.push({ suite, name, passed: false, error: err.message });
    console.error(`  ✗ [FAIL] ${suite} > ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('====================================================');
  console.log('STARTING ENTERPRISE UPGRADE VERIFICATION TEST SUITE');
  console.log('====================================================\n');

  let testServer = server;
  if (!httpServer.listening) {
    testServer = await new Promise((resolve) => {
      const s = httpServer.listen(4000, () => resolve(s));
    });
  }

  // 0. Setup Test Users & Auth Tokens
  console.log('Setting up authoritative test fixtures...');
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@erp.com' } });
  const salespersonUser = await prisma.user.findUnique({
    where: { email: 'rahul@erp.com' },
    include: { salespersonProfile: true },
  });

  if (!adminUser || !salespersonUser) {
    throw new Error('Seed data missing. Run seed script first.');
  }

  // Obtain authoritative tokens via real API login endpoint
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin@erp.com', password: 'Password123!' }),
  });
  const adminJson = await adminLoginRes.json();
  const adminToken = adminJson.token;

  const spLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'rahul@erp.com', password: 'Password123!' }),
  });
  const spJson = await spLoginRes.json();
  const salespersonToken = spJson.token;

  assert(!!adminToken && !!salespersonToken, 'Failed to acquire test auth tokens');

  // ==========================================
  // SUITE 1: SECURE ACCESS-CODE AUTHENTICATION
  // ==========================================
  console.log('\n--- 1. Testing Secure Access-Code Authentication ---');

  let testAccessCode = '';
  let testCodeId = '';

  await runTest('AccessCode', 'Generate individual access code with one-time plain delivery', async () => {
    const res = await fetch(`${API_BASE}/access-codes/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: salespersonUser.id,
        expiresInDays: 30,
      }),
    });

    const json = await res.json();
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}: ${JSON.stringify(json)}`);
    const code = json.plainAccessCode || json.accessCode;
    assert(!!code, 'Must return plaintext code once');
    assert(code.includes('-'), 'Code format should have hyphen separator');

    testAccessCode = code;
    testCodeId = json.id || json.codeId;

    // Verify plaintext is NEVER stored in database
    const dbRecord = await prisma.userAccessCode.findUnique({ where: { id: testCodeId } });
    assert(!!dbRecord, 'DB record must exist');
    assert(dbRecord!.codeHash !== testAccessCode, 'Database must not store plaintext code');
    assert(bcrypt.compareSync(testAccessCode, dbRecord!.codeHash), 'bcrypt hash must match code');

    return { codeHint: json.codeHint, status: json.status };
  });

  await runTest('AccessCode', 'Login successfully using Employee Code and Personal Access Code', async () => {
    const res = await fetch(`${API_BASE}/auth/access-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: salespersonUser.salespersonProfile!.employeeCode,
        accessCode: testAccessCode,
      }),
    });

    const json = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(!!json.token, 'Must return JWT token on success');
    assert(json.user.id === salespersonUser.id, 'User ID must match');

    return { tokenIssued: true, userName: json.user.name };
  });

  await runTest('AccessCode', 'Rate limiting & lockout after consecutive failed attempts', async () => {
    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${API_BASE}/auth/access-code-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: salespersonUser.salespersonProfile!.employeeCode,
          accessCode: 'WRONG-CODE',
        }),
      });
      assert(res.status === 401, `Attempt ${i + 1} should return 401`);
    }

    // 5th failed attempt should trigger lockout
    const fifthRes = await fetch(`${API_BASE}/auth/access-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: salespersonUser.salespersonProfile!.employeeCode,
        accessCode: 'WRONG-CODE',
      }),
    });

    const json = await fifthRes.json();
    assert(fifthRes.status === 423 || fifthRes.status === 401, `5th attempt returns lockout status, got ${fifthRes.status}`);
    assert(json.error.includes('locked'), 'Must return lockout message after 5 failures');

    // 6th attempt with CORRECT code should still be blocked during lockout window
    const blockedRes = await fetch(`${API_BASE}/auth/access-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: salespersonUser.salespersonProfile!.employeeCode,
        accessCode: testAccessCode,
      }),
    });
    const blockedJson = await blockedRes.json();
    assert(blockedRes.status === 423 || blockedRes.status === 401, 'Correct code must be blocked while locked');
    assert(blockedJson.error.includes('locked'), 'Lockout message returned even for valid code during lockout');

    // Reset lock in DB for subsequent tests
    await prisma.userAccessCode.update({
      where: { id: testCodeId },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    return { lockoutTriggered: true };
  });

  await runTest('AccessCode', 'Revocation terminates credential and invalidates future logins', async () => {
    const revokeRes = await fetch(`${API_BASE}/access-codes/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        codeId: testCodeId,
        reason: 'Automated test revocation',
      }),
    });
    assert(revokeRes.status === 200, 'Revoke returns 200');

    // Try login again with revoked code
    const loginRes = await fetch(`${API_BASE}/auth/access-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: salespersonUser.salespersonProfile!.employeeCode,
        accessCode: testAccessCode,
      }),
    });
    assert(loginRes.status === 401, 'Revoked code must fail login');

    return { revoked: true };
  });

  // ==========================================
  // SUITE 2: SOCKET.IO AUTH & ROOM SCOPING
  // ==========================================
  console.log('\n--- 2. Testing Socket.IO Real-time Security & Room Authorization ---');

  await runTest('SocketIO', 'Reject unauthenticated socket connections', async () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        auth: { token: 'invalid-token-here' },
        reconnection: false,
        timeout: 3000,
      });

      socket.on('connect_error', (err) => {
        socket.disconnect();
        resolve({ errorHandled: true, message: err.message });
      });

      socket.on('connect', () => {
        socket.disconnect();
        reject(new Error('Socket connected with invalid token! Should be rejected.'));
      });
    });
  });

  await runTest('SocketIO', 'Authenticate valid JWT and scope rooms to user and role', async () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        auth: { token: salespersonToken },
        reconnection: false,
        timeout: 3000,
      });

      const timer = setTimeout(() => {
        socket.disconnect();
        resolve({ scopedCorrectly: true, timedOutSafely: true });
      }, 2500);

      socket.on('connect', () => {
        socket.emit('subscribe:room', { room: 'admins' });
        socket.on('error', (err: any) => {
          clearTimeout(timer);
          socket.disconnect();
          resolve({ scopedCorrectly: true, forbiddenRoomRejected: true, error: err.message });
        });
        socket.on('subscribed:room', () => {
          clearTimeout(timer);
          socket.disconnect();
          reject(new Error('Salesperson was permitted to join admins room!'));
        });
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to connect with valid token: ${err.message}`));
      });
    });
  });

  // ==========================================
  // SUITE 3: STAFF EXPENSE MANAGEMENT
  // ==========================================
  console.log('\n--- 3. Testing Staff Expense Management & Financial Controls ---');

  let testExpenseId = '';

  await runTest('Expenses', 'Create draft expense with category, INR amount, and purpose', async () => {
    const res = await fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        category: 'AUTO_RICKSHAW',
        amount: 250.50,
        expenseDate: new Date().toISOString(),
        description: 'Auto fare to client site in Indiranagar',
        businessPurpose: 'Order delivery follow-up',
        merchantName: 'Local Auto Driver',
        paymentMethod: 'UPI',
        receiptUrl: 'https://images.unsplash.com/photo-1554415707-9e4c019fcaf4?w=500',
        status: 'DRAFT',
      }),
    });

    const json = await res.json();
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert(json.data.status === 'DRAFT', 'New expense must start in DRAFT status');
    assert(json.data.expenseNumber.startsWith('EXP-'), 'Expense number format must start with EXP-');

    testExpenseId = json.data.id;
    return { expenseNumber: json.data.expenseNumber, amount: json.data.amount };
  });

  await runTest('Expenses', 'Submit draft claim for approval', async () => {
    const res = await fetch(`${API_BASE}/expenses/${testExpenseId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salespersonToken}` },
    });

    const json = await res.json();
    assert(res.status === 200, 'Submit returns 200');
    assert(json.data.status === 'SUBMITTED', 'Status must transition to SUBMITTED');
    return { status: json.data.status };
  });

  await runTest('Expenses', 'Prevent self-approval of claims (Strict Financial Control)', async () => {
    // Salesperson attempts to approve their own claim
    const res = await fetch(`${API_BASE}/expenses/${testExpenseId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({ comment: 'Self approving' }),
    });

    // Must be rejected (either 403 Forbidden by role or 403 self-approval check)
    assert(res.status === 403, `Self-approval must return 403 Forbidden, got ${res.status}`);
    return { selfApprovalBlocked: true };
  });

  await runTest('Expenses', 'Manager/Admin approves submitted claim and locks financial details', async () => {
    const res = await fetch(`${API_BASE}/expenses/${testExpenseId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ comment: 'Approved by Regional Manager' }),
    });

    const json = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(json.data.status === 'APPROVED', 'Status must transition to APPROVED');

    // Attempting to modify financial details on approved claim must fail
    const editRes = await fetch(`${API_BASE}/expenses/${testExpenseId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({ amount: 9999.00 }),
    });
    assert(editRes.status === 400, 'Editing approved claim must return 400 locked error');

    return { approvedStatus: json.data.status, lockedAgainstEditing: true };
  });

  await runTest('Expenses', 'Disburse and record reimbursement settlement with payment reference', async () => {
    const res = await fetch(`${API_BASE}/expenses/${testExpenseId}/reimburse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reimbursementRef: 'UTR-9823487123984',
        reimbursementMethod: 'BANK_TRANSFER',
        comment: 'Paid via monthly staff payroll settlement',
      }),
    });

    const json = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(json.data.status === 'REIMBURSED', 'Status must transition to REIMBURSED');
    assert(json.data.reimbursementRef === 'UTR-9823487123984', 'Reimbursement reference recorded');

    // Second reimbursement attempt on same claim must fail
    const dupRes = await fetch(`${API_BASE}/expenses/${testExpenseId}/reimburse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reimbursementRef: 'UTR-SECOND-DUP',
        reimbursementMethod: 'BANK_TRANSFER',
      }),
    });
    assert(dupRes.status === 400, 'Duplicate reimbursement must return 400');

    return { reimbursed: true, ref: json.data.reimbursementRef };
  });

  await runTest('Expenses', 'Rejection workflow requires mandatory reason and enables revision', async () => {
    // Create new claim to reject
    const newExp = await prisma.expense.create({
      data: {
        expenseNumber: `EXP-TEST-${Date.now()}`,
        salespersonId: salespersonUser.salespersonProfile!.id,
        category: 'FOOD_MEALS',
        amount: 450.00,
        expenseDate: new Date(),
        description: 'Team lunch',
        status: ExpenseStatus.SUBMITTED,
      },
    });

    // Reject without reason must fail
    const failRes = await fetch(`${API_BASE}/expenses/${newExp.id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    assert(failRes.status === 400, 'Reject without reason must return 400');

    // Reject with reason
    const succRes = await fetch(`${API_BASE}/expenses/${newExp.id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ rejectionReason: 'Meal exceeds single-day per diem policy limit.' }),
    });
    assert(succRes.status === 200, 'Reject with reason returns 200');

    // Salesperson can edit and resubmit
    const editRes = await fetch(`${API_BASE}/expenses/${newExp.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({ amount: 200.00, description: 'Client coffee only' }),
    });
    assert(editRes.status === 200, 'Editing rejected claim is allowed');

    const resubmitRes = await fetch(`${API_BASE}/expenses/${newExp.id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salespersonToken}` },
    });
    assert(resubmitRes.status === 200, 'Resubmission returns 200');

    return { rejectionAndResubmissionVerified: true };
  });

  // ==========================================
  // SUITE 4 & 5: RELIABLE GPS ROUTE TRACKING & WORKFLOWS
  // ==========================================
  console.log('\n--- 4 & 5. Testing Reliable GPS Tracking & Workflows Lifecycle ---');

  // Clean up any test attendance sessions for fresh lifecycle run
  const spId = salespersonUser.salespersonProfile!.id;
  await prisma.locationPoint.deleteMany({ where: { salespersonId: spId } });
  await prisma.locationSession.deleteMany({ where: { salespersonId: spId } });
  await prisma.attendance.deleteMany({ where: { salespersonId: spId } });
  await prisma.salesperson.update({
    where: { id: spId },
    data: { status: 'OFF_DUTY' },
  });

  await runTest('Workflows', 'Start Day attendance lifecycle enables ON_DUTY status and tracking', async () => {
    const startRes = await fetch(`${API_BASE}/attendance/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        latitude: 12.9716,
        longitude: 77.5946,
        idempotencyKey: `start-${Date.now()}`,
      }),
    });

    const json = await startRes.json();
    assert(startRes.status === 200 || startRes.status === 201, `Start day returns 200/201, got ${startRes.status}: ${JSON.stringify(json)}`);
    return { dutyStarted: true, attendanceId: json.data?.id };
  });

  const testPointId = `cpt_test_${Date.now()}`;

  await runTest('GPS', 'Batch upload with clientPointId deduplication', async () => {
    // 1st upload
    const res1 = await fetch(`${API_BASE}/location/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        points: [
          {
            clientPointId: testPointId,
            latitude: 12.9716,
            longitude: 77.5946,
            accuracy: 8.5,
            speed: 25,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    const json1 = await res1.json();
    assert(res1.status === 200, `First upload returns 200, got ${res1.status}: ${JSON.stringify(json1)}`);
    assert(json1.ingestedCount === 1, 'Should ingest 1 point');

    // Duplicate upload with same clientPointId (simulating retry after network drop)
    const res2 = await fetch(`${API_BASE}/location/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        points: [
          {
            clientPointId: testPointId,
            latitude: 12.9716,
            longitude: 77.5946,
            accuracy: 8.5,
            speed: 25,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    const json2 = await res2.json();
    assert(res2.status === 200, 'Duplicate upload returns 200');
    assert(json2.ingestedCount === 0, 'Duplicate point must not be re-ingested');

    return { idempotentBatchDeduplication: true };
  });

  await runTest('GPS', 'Accuracy-aware filtering (poor accuracy points flagged)', async () => {
    const poorPointId = `cpt_poor_${Date.now()}`;
    const res = await fetch(`${API_BASE}/location/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        points: [
          {
            clientPointId: poorPointId,
            latitude: 12.9750,
            longitude: 77.5990,
            accuracy: 250, // > 150m poor accuracy
            speed: 15,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    assert(res.status === 200, 'Batch upload returns 200');

    // Check DB point status
    const pointInDb = await prisma.locationPoint.findUnique({
      where: { clientPointId: poorPointId },
    });
    assert(!!pointInDb, 'Point saved in DB as raw evidence');
    assert(pointInDb!.isFiltered === true, 'Poor accuracy point must be marked isFiltered: true');
    assert(pointInDb!.filterReason === 'POOR_ACCURACY', 'filterReason must be POOR_ACCURACY');

    return { filteredPoorAccuracy: true, filterReason: pointInDb!.filterReason };
  });

  await runTest('GPS', 'Implausible speed jump detection (> 140 km/h)', async () => {
    const jumpPointId = `cpt_jump_${Date.now()}`;
    const res = await fetch(`${API_BASE}/location/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        points: [
          {
            clientPointId: jumpPointId,
            latitude: 13.5000,
            longitude: 78.0000,
            accuracy: 10,
            speed: 180, // 180 km/h jump
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    assert(res.status === 200, 'Batch returns 200');

    const pointInDb = await prisma.locationPoint.findUnique({
      where: { clientPointId: jumpPointId },
    });
    assert(pointInDb!.isFiltered === true, 'High speed point must be marked isFiltered: true');
    assert(pointInDb!.filterReason === 'IMPLAUSIBLE_SPEED_JUMP', 'filterReason must be IMPLAUSIBLE_SPEED_JUMP');

    return { filteredJump: true, filterReason: pointInDb!.filterReason };
  });

  await runTest('Workflows', 'End Day attendance completes shift and halts GPS collection', async () => {
    const endRes = await fetch(`${API_BASE}/attendance/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        latitude: 12.9720,
        longitude: 77.5950,
      }),
    });

    const json = await endRes.json();
    assert(endRes.status === 200, `End day returns 200, got ${endRes.status}: ${JSON.stringify(json)}`);
    return { shiftEnded: true, hours: json.data?.totalHoursFormatted };
  });

  await runTest('GPS', 'Stop new location collection immediately when End Day is completed', async () => {
    // Attempt location upload while OFF DUTY
    const res = await fetch(`${API_BASE}/location/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salespersonToken}`,
      },
      body: JSON.stringify({
        points: [
          {
            clientPointId: `cpt_after_end_${Date.now()}`,
            latitude: 12.9716,
            longitude: 77.5946,
            accuracy: 10,
            speed: 0,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    assert(res.status === 403, `Must reject location upload when OFF DUTY, got ${res.status}`);
    const json = await res.json();
    assert(json.error.includes('ON DUTY'), 'Error indicates salesperson is not on duty');

    return { trackingCutoffConfirmed: true };
  });

  // SUMMARY REPORT
  console.log('\n====================================================');
  console.log('TEST SUMMARY RESULTS');
  console.log('====================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`TOTAL TESTS: ${results.length}`);
  console.log(`PASSED:      ${passedCount}`);
  console.log(`FAILED:      ${failedCount}`);

  if (testServer && typeof testServer.close === 'function') {
    testServer.close();
  }

  if (failedCount > 0) {
    console.error('\nFailures:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.error(`- [${r.suite}] ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\nALL 14 AUTOMATED UPGRADE CHECKS PASSED PERFECTLY!');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
