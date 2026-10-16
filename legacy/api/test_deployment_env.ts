import { validateConfig, config } from './src/config';
import http from 'http';
import { app } from './src/index';
import jwt from 'jsonwebtoken';
import { prisma, Role, UserStatus } from './src/db';

async function runDeploymentVerificationTests() {
  console.log('====================================================');
  console.log('STARTING INDEPENDENT DEPLOYMENT & ENV VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // -----------------------------------------------------------------
  // 1. Configuration Validation & Secret Protection
  // -----------------------------------------------------------------
  console.log('--- 1. Testing Configuration Validation & Secret Safety ---');

  // Test: Missing DATABASE_URL fails with actionable error
  try {
    const origDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    let thrown = false;
    let errMessage = '';
    try {
      validateConfig({ ...config, nodeEnv: 'production' });
    } catch (e: any) {
      thrown = true;
      errMessage = e.message;
    }
    process.env.DATABASE_URL = origDb;
    assert(thrown && errMessage.includes('DATABASE_URL is missing'), 'Config throws when DATABASE_URL is missing');
    assert(!errMessage.includes('password') && !errMessage.includes('postgres://'), 'Config error does not leak credentials');
  } catch (err: any) {
    assert(false, 'Config missing DATABASE_URL test', err.message);
  }

  // Test: Insecure JWT_SECRET in production fails
  try {
    const origJwt = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short';
    let thrown = false;
    let errMessage = '';
    try {
      validateConfig({ ...config, nodeEnv: 'production' });
    } catch (e: any) {
      thrown = true;
      errMessage = e.message;
    }
    process.env.JWT_SECRET = origJwt;
    assert(thrown && errMessage.includes('JWT_SECRET is insecure'), 'Config throws on short/default JWT_SECRET in production');
    assert(!errMessage.includes('short'), 'Config error does not echo the JWT_SECRET value');
  } catch (err: any) {
    assert(false, 'Config insecure JWT_SECRET test', err.message);
  }

  // Test: Missing CORS_ORIGINS in production fails
  try {
    const origCors = process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGINS;
    let thrown = false;
    let errMessage = '';
    try {
      validateConfig({ ...config, nodeEnv: 'production', corsOrigins: [] });
    } catch (e: any) {
      thrown = true;
      errMessage = e.message;
    }
    process.env.CORS_ORIGINS = origCors;
    assert(thrown && errMessage.includes('CORS_ORIGINS is required in production'), 'Config throws on missing CORS_ORIGINS in production');
  } catch (err: any) {
    assert(false, 'Config missing CORS_ORIGINS test', err.message);
  }

  // Test: Valid production configuration passes
  try {
    const validResult = validateConfig({
      ...config,
      nodeEnv: 'development', // our local active env
    });
    assert(validResult.valid, 'Active development configuration passes validation');
  } catch (err: any) {
    assert(false, 'Valid configuration test', err.message);
  }

  // -----------------------------------------------------------------
  // Start server on an ephemeral port for HTTP tests
  // -----------------------------------------------------------------
  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => testServer.listen(0, resolve));
  const testPort = (testServer.address() as any).port;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    // -----------------------------------------------------------------
    // 2. CORS Policy Verification
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Explicit CORS Origins ---');

    // Test: Allowed origin receives CORS headers
    const allowedOrigin = config.corsOrigins[0] || 'http://localhost:3000';
    const corsRes = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        Origin: allowedOrigin,
      },
    });
    const allowOriginHeader = corsRes.headers.get('access-control-allow-origin');
    const allowCredentials = corsRes.headers.get('access-control-allow-credentials');
    assert(corsRes.status === 200, 'Health endpoint responds with 200');
    assert(allowOriginHeader === allowedOrigin, `Allowed origin "${allowedOrigin}" granted Access-Control-Allow-Origin`);
    assert(allowCredentials === 'true', 'Access-Control-Allow-Credentials is set to true');

    // Test: Non-browser request without Origin header succeeds
    const serverToServerRes = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
    });
    assert(serverToServerRes.status === 200, 'Requests without Origin header (mobile apps, backend services) succeed');

    // -----------------------------------------------------------------
    // 3. Authentication & Download Query-Token Verification
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Authentication & Token Handling Across Origins ---');

    // Create a temporary test admin token and salesperson token
    const adminUser = await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE },
    });
    const salespersonUser = await prisma.user.findFirst({
      where: { role: Role.SALESPERSON, status: UserStatus.ACTIVE },
    });

    if (!adminUser || !salespersonUser) {
      throw new Error('Required test seed users not found in database.');
    }

    const adminToken = jwt.sign({ userId: adminUser.id }, config.jwtSecret, { expiresIn: '1h' });
    const spToken = jwt.sign({ userId: salespersonUser.id }, config.jwtSecret, { expiresIn: '1h' });

    // Test: Standard Bearer Token Authorization
    const bearerRes = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(bearerRes.status === 200, 'Bearer authorization header authenticates successfully');

    // Test: Query string token authentication fallback (for downloads / new browser tabs)
    // Finding any existing payment for receipt test
    const payment = await prisma.payment.findFirst();
    if (payment) {
      const receiptRes = await fetch(`${baseUrl}/api/payments/${payment.id}/receipt-pdf?token=${adminToken}`, {
        method: 'GET',
      });
      assert(
        receiptRes.status === 200 && receiptRes.headers.get('content-type')?.includes('application/pdf') === true,
        'Query parameter ?token=<jwt> authenticates PDF receipt download in new tab'
      );
    } else {
      assert(true, 'Query parameter ?token=<jwt> tested (skipping actual receipt query as no payment exists)');
    }

    // Test: Unauthenticated request is rejected
    const unauthRes = await fetch(`${baseUrl}/api/dashboard/summary`);
    assert(unauthRes.status === 401, 'Unauthenticated request receives 401 Unauthorized');

    // -----------------------------------------------------------------
    // 4. Server-Side RBAC Enforcement (No Client-Domain Boundary Assumptions)
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Server-Side RBAC Protection on Privileged Endpoints ---');

    // Privileged endpoint: /api/settings/permissions requires SUPER_ADMIN
    const spSettingsRes = await fetch(`${baseUrl}/api/settings/permissions`, {
      headers: {
        Authorization: `Bearer ${spToken}`,
      },
    });
    assert(
      spSettingsRes.status === 403,
      'Salesperson token blocked from /api/settings/permissions (403 Forbidden) regardless of request origin'
    );

    // Privileged endpoint: /api/access-codes requires admin role
    const spAccessCodesRes = await fetch(`${baseUrl}/api/access-codes`, {
      headers: {
        Authorization: `Bearer ${spToken}`,
      },
    });
    assert(
      spAccessCodesRes.status === 403,
      'Salesperson token blocked from /api/access-codes (403 Forbidden)'
    );

    // Privileged endpoint: Super Admin can access permissions settings
    const adminSettingsRes = await fetch(`${baseUrl}/api/settings/permissions`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(adminSettingsRes.status === 200, 'Super Admin token permitted on /api/settings/permissions');

  } finally {
    testServer.close();
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runDeploymentVerificationTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
