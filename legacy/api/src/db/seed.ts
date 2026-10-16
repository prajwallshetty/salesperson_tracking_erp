import { PrismaClient, Role, UserStatus, SalespersonStatus, AttendanceStatus, OrderStatus, PaymentMethod, PaymentStatus, VisitOutcome, LedgerEntryType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. System Settings
  const settings = [
    { key: 'visit_radius_meters', value: '100', description: 'Maximum radius in meters for genuine client visit without exception note' },
    { key: 'tracking_interval_seconds', value: '60', description: 'GPS location tracking sample interval for on-duty salespersons' },
    { key: 'business_timezone', value: 'Asia/Kolkata', description: 'Default display timezone for business records' },
    { key: 'manager_order_approval_required', value: 'false', description: 'Require manager approval before processing orders' },
    { key: 'cash_verification_required', value: 'true', description: 'Require admin/manager signoff on cash collections' },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, description: s.description },
      create: s,
    });
  }

  // 2. Users and Roles
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Super Admin
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@erp.com' },
    update: {},
    create: {
      name: 'Vikram Mehta',
      email: 'admin@erp.com',
      phone: '9876543210',
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  // Manager
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@erp.com' },
    update: {},
    create: {
      name: 'Priya Sundaram',
      email: 'manager@erp.com',
      phone: '9876543211',
      passwordHash,
      role: Role.MANAGER,
      status: UserStatus.ACTIVE,
      managerPermissions: {
        create: {
          canViewDashboard: true,
          canManageUsers: true,
          canManageProducts: true,
          canManageClients: true,
          canAssignClients: true,
          canViewGps: true,
          canViewOrders: true,
          canApproveOrders: true,
          canViewPayments: true,
          canVerifyPayments: true,
          canViewReports: true,
          canExportReports: true,
        },
      },
    },
  });

  // Salesperson 1: Rahul
  const rahulUser = await prisma.user.upsert({
    where: { email: 'rahul@erp.com' },
    update: {},
    create: {
      name: 'Rahul Sharma',
      email: 'rahul@erp.com',
      phone: '9876543212',
      passwordHash,
      role: Role.SALESPERSON,
      status: UserStatus.ACTIVE,
      salespersonProfile: {
        create: {
          employeeCode: 'EMP-001',
          territory: 'Mangalore North',
          status: SalespersonStatus.ON_DUTY,
          deviceId: 'DEVICE-RAHUL-01',
        },
      },
    },
    include: { salespersonProfile: true },
  });

  // Salesperson 2: Ahmed
  const ahmedUser = await prisma.user.upsert({
    where: { email: 'ahmed@erp.com' },
    update: {},
    create: {
      name: 'Ahmed Khan',
      email: 'ahmed@erp.com',
      phone: '9876543213',
      passwordHash,
      role: Role.SALESPERSON,
      status: UserStatus.ACTIVE,
      salespersonProfile: {
        create: {
          employeeCode: 'EMP-002',
          territory: 'Mangalore South',
          status: SalespersonStatus.ON_DUTY,
          deviceId: 'DEVICE-AHMED-02',
        },
      },
    },
    include: { salespersonProfile: true },
  });

  // Salesperson 3: Vishal
  const vishalUser = await prisma.user.upsert({
    where: { email: 'vishal@erp.com' },
    update: {},
    create: {
      name: 'Vishal Patil',
      email: 'vishal@erp.com',
      phone: '9876543214',
      passwordHash,
      role: Role.SALESPERSON,
      status: UserStatus.ACTIVE,
      salespersonProfile: {
        create: {
          employeeCode: 'EMP-003',
          territory: 'Udupi Central',
          status: SalespersonStatus.OFF_DUTY,
          deviceId: 'DEVICE-VISHAL-03',
        },
      },
    },
    include: { salespersonProfile: true },
  });

  const rahulProfile = rahulUser.salespersonProfile!;
  const ahmedProfile = ahmedUser.salespersonProfile!;
  const vishalProfile = vishalUser.salespersonProfile!;

  // Manager team assignment
  await prisma.managerSalesperson.upsert({
    where: {
      managerId_salespersonId: {
        managerId: managerUser.id,
        salespersonId: rahulProfile.id,
      },
    },
    update: {},
    create: {
      managerId: managerUser.id,
      salespersonId: rahulProfile.id,
    },
  });

  await prisma.managerSalesperson.upsert({
    where: {
      managerId_salespersonId: {
        managerId: managerUser.id,
        salespersonId: ahmedProfile.id,
      },
    },
    update: {},
    create: {
      managerId: managerUser.id,
      salespersonId: ahmedProfile.id,
    },
  });

  // 3. Product Categories & Products
  const catMobile = await prisma.category.upsert({
    where: { name: 'Mobile Accessories' },
    update: {},
    create: { name: 'Mobile Accessories', description: 'Chargers, cables, audio, and phone peripherals' },
  });

  const catPower = await prisma.category.upsert({
    where: { name: 'Power & Storage' },
    update: {},
    create: { name: 'Power & Storage', description: 'Power banks, adapters, and backup storage' },
  });

  const catWearables = await prisma.category.upsert({
    where: { name: 'Wearables' },
    update: {},
    create: { name: 'Wearables', description: 'Smartwatches, fitness bands, and trackers' },
  });

  const productsData = [
    {
      sku: 'SAM-CHG-01',
      barcode: '890123450001',
      name: 'Samsung 25W Fast Charger',
      categoryId: catMobile.id,
      brand: 'Samsung',
      description: 'Original Super Fast Charging 25W Type-C adapter',
      unit: 'PCS',
      sellingPrice: 450,
      mrp: 599,
      taxRate: 18,
      discount: 0,
      stock: 120,
      minimumStock: 10,
    },
    {
      sku: 'SAM-CBL-02',
      barcode: '890123450002',
      name: 'Samsung Type-C to Type-C Cable',
      categoryId: catMobile.id,
      brand: 'Samsung',
      description: 'Braided 1.2m durable fast data sync & charge cable',
      unit: 'PCS',
      sellingPrice: 250,
      mrp: 349,
      taxRate: 18,
      discount: 0,
      stock: 250,
      minimumStock: 20,
    },
    {
      sku: 'SAM-ADP-03',
      barcode: '890123450003',
      name: 'Samsung Multiport Travel Adapter',
      categoryId: catPower.id,
      brand: 'Samsung',
      description: 'Dual USB + Type-C 45W universal travel adapter',
      unit: 'PCS',
      sellingPrice: 650,
      mrp: 899,
      taxRate: 18,
      discount: 0,
      stock: 80,
      minimumStock: 10,
    },
    {
      sku: 'PWR-BNK-10K',
      barcode: '890123450004',
      name: 'Anker PowerCore 10,000mAh',
      categoryId: catPower.id,
      brand: 'Anker',
      description: 'Ultra-compact power bank with high-speed charging',
      unit: 'PCS',
      sellingPrice: 1200,
      mrp: 1699,
      taxRate: 18,
      discount: 50,
      stock: 55,
      minimumStock: 10,
    },
    {
      sku: 'TWS-AIR-05',
      barcode: '890123450005',
      name: 'boAt Airdopes 441 Pro',
      categoryId: catMobile.id,
      brand: 'boAt',
      description: 'True Wireless earbuds with 150 hours total playback',
      unit: 'PCS',
      sellingPrice: 1450,
      mrp: 1999,
      taxRate: 18,
      discount: 100,
      stock: 90,
      minimumStock: 15,
    },
    {
      sku: 'SMW-FIT-02',
      barcode: '890123450006',
      name: 'Noise ColorFit Pulse 2',
      categoryId: catWearables.id,
      brand: 'Noise',
      description: '1.8-inch display smartwatch with SpO2 and 10-day battery',
      unit: 'PCS',
      sellingPrice: 1850,
      mrp: 2499,
      taxRate: 18,
      discount: 50,
      stock: 40,
      minimumStock: 5,
    },
  ];

  for (const p of productsData) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: p,
      create: p,
    });
  }

  // 4. Clients with Coordinates in Mangalore & Udupi
  const clientsData = [
    {
      name: 'ABC Traders',
      businessName: 'ABC Consumer Electronics & Mobile Care',
      contactPerson: 'Ramesh Rao',
      phone: '9845012345',
      email: 'abctraders@gmail.com',
      gstNumber: '29ABCDE1234F1Z5',
      address: 'Shop 14, City Center Mall, K.S. Rao Road',
      city: 'Mangalore',
      state: 'Karnataka',
      pincode: '575001',
      latitude: 12.8715,
      longitude: 74.8432,
      category: 'Wholesale Retailer',
      creditLimit: 150000,
      paymentTerms: 'Net 15',
      openingBalance: 45000,
      currentOutstanding: 63080, // Opening 45k + Order 25,080 - Payment 7,000
    },
    {
      name: 'City Electronics Hub',
      businessName: 'City Electronics & Appliances Pvt Ltd',
      contactPerson: 'Suresh Shenoy',
      phone: '9845023456',
      email: 'suresh@cityelectronics.in',
      gstNumber: '29BCDEF2345G2Z6',
      address: '22 Balmatta Road, Near Collector Gate',
      city: 'Mangalore',
      state: 'Karnataka',
      pincode: '575002',
      latitude: 12.8680,
      longitude: 74.8510,
      category: 'Retail Store',
      creditLimit: 100000,
      paymentTerms: 'Net 30',
      openingBalance: 25000,
      currentOutstanding: 25000,
    },
    {
      name: 'Apex Mobiles & Gadgets',
      businessName: 'Apex Telecom Retailers',
      contactPerson: 'Vinay Kumar',
      phone: '9845034567',
      email: 'vinay@apexmobiles.com',
      gstNumber: '29CDEFG3456H3Z7',
      address: 'Ground Floor, Forum Fiza Mall, Pandeshwar',
      city: 'Mangalore',
      state: 'Karnataka',
      pincode: '575001',
      latitude: 12.8590,
      longitude: 74.8385,
      category: 'Brand Store',
      creditLimit: 200000,
      paymentTerms: 'Net 30',
      openingBalance: 15000,
      currentOutstanding: 15000,
    },
    {
      name: 'Coastal Tech Distributors',
      businessName: 'Coastal Mobile Solutions',
      contactPerson: 'Deepak Kamath',
      phone: '9845045678',
      email: 'deepak@coastaltech.co.in',
      gstNumber: '29DEFGH4567I4Z8',
      address: 'Nanthoor Junction, Kadri',
      city: 'Mangalore',
      state: 'Karnataka',
      pincode: '575005',
      latitude: 12.8820,
      longitude: 74.8650,
      category: 'Distributor',
      creditLimit: 300000,
      paymentTerms: 'Net 45',
      openingBalance: 80000,
      currentOutstanding: 80000,
    },
    {
      name: 'Ocean Telecom Udupi',
      businessName: 'Ocean View Gadget World',
      contactPerson: 'Ganesh Hegde',
      phone: '9845056789',
      email: 'ganesh@oceantelecom.in',
      gstNumber: '29EFGHI5678J5Z9',
      address: 'Car Street, Near Krishna Matha',
      city: 'Udupi',
      state: 'Karnataka',
      pincode: '576101',
      latitude: 13.3409,
      longitude: 74.7421,
      category: 'Retail Store',
      creditLimit: 75000,
      paymentTerms: 'Net 15',
      openingBalance: 20000,
      currentOutstanding: 20000,
    },
  ];

  const createdClients = [];
  for (const c of clientsData) {
    const existing = await prisma.client.findFirst({ where: { phone: c.phone } });
    if (existing) {
      createdClients.push(existing);
    } else {
      const created = await prisma.client.create({ data: c });
      createdClients.push(created);
    }
  }

  // 5. Client Assignments
  const abcTraders = createdClients[0];
  const cityElectronics = createdClients[1];
  const apexMobiles = createdClients[2];
  const coastalDistributors = createdClients[3];
  const oceanTelecom = createdClients[4];

  // Assign to Rahul (Primary) and Ahmed (Backup)
  await prisma.clientAssignment.createMany({
    data: [
      { clientId: abcTraders.id, salespersonId: rahulProfile.id, assignedBy: adminUser.id, active: true, type: 'PRIMARY' },
      { clientId: abcTraders.id, salespersonId: ahmedProfile.id, assignedBy: adminUser.id, active: true, type: 'BACKUP', notes: 'Weekend backup' },
      { clientId: cityElectronics.id, salespersonId: rahulProfile.id, assignedBy: adminUser.id, active: true, type: 'PRIMARY' },
      { clientId: apexMobiles.id, salespersonId: rahulProfile.id, assignedBy: adminUser.id, active: true, type: 'PRIMARY' },
      { clientId: coastalDistributors.id, salespersonId: ahmedProfile.id, assignedBy: adminUser.id, active: true, type: 'PRIMARY' },
      { clientId: oceanTelecom.id, salespersonId: vishalProfile.id, assignedBy: adminUser.id, active: true, type: 'PRIMARY' },
    ],
    skipDuplicates: true,
  });

  // 6. Active Attendance & Location Session for Rahul (Today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existingAttendance = await prisma.attendance.findFirst({
    where: { salespersonId: rahulProfile.id, date: today },
  });

  let rahulAttendance = existingAttendance;
  if (!rahulAttendance) {
    rahulAttendance = await prisma.attendance.create({
      data: {
        salespersonId: rahulProfile.id,
        date: today,
        loginAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        loginLatitude: 12.8700,
        loginLongitude: 74.8420,
        workingMinutes: 240,
        distanceTravelled: 14.8,
        status: AttendanceStatus.ON_DUTY,
      },
    });
  }

  // Location Session
  const activeSession = await prisma.locationSession.create({
    data: {
      salespersonId: rahulProfile.id,
      attendanceId: rahulAttendance.id,
      startedAt: rahulAttendance.loginAt,
      status: 'ACTIVE',
    },
  });

  // Location Breadcrumbs (Route simulation in Mangalore)
  const waypoints = [
    { lat: 12.8700, lng: 74.8420, speed: 0, battery: 95, minutesAgo: 240 },
    { lat: 12.8705, lng: 74.8425, speed: 18, battery: 93, minutesAgo: 210 },
    { lat: 12.8710, lng: 74.8430, speed: 25, battery: 90, minutesAgo: 180 },
    { lat: 12.8714, lng: 74.8431, speed: 5, battery: 88, minutesAgo: 150 }, // ABC Traders stop
    { lat: 12.8715, lng: 74.8432, speed: 0, battery: 86, minutesAgo: 120 },
    { lat: 12.8708, lng: 74.8445, speed: 20, battery: 84, minutesAgo: 60 },
    { lat: 12.8682, lng: 74.8508, speed: 12, battery: 80, minutesAgo: 15 },
    { lat: 12.8680, lng: 74.8510, speed: 0, battery: 78, minutesAgo: 2 },  // Current position near City Electronics
  ];

  for (const wp of waypoints) {
    await prisma.locationPoint.create({
      data: {
        sessionId: activeSession.id,
        salespersonId: rahulProfile.id,
        latitude: wp.lat,
        longitude: wp.lng,
        accuracy: 12.0,
        speed: wp.speed,
        heading: 45.0,
        batteryLevel: wp.battery,
        networkType: '4G',
        deviceId: 'DEVICE-RAHUL-01',
        timestamp: new Date(Date.now() - wp.minutesAgo * 60 * 1000),
      },
    });
  }

  // 7. Visit to ABC Traders
  const visitStartTime = new Date(Date.now() - 150 * 60 * 1000);
  const visitEndTime = new Date(Date.now() - 110 * 60 * 1000);

  const visit = await prisma.clientVisit.create({
    data: {
      clientId: abcTraders.id,
      salespersonId: rahulProfile.id,
      startedAt: visitStartTime,
      endedAt: visitEndTime,
      latitude: 12.8714,
      longitude: 74.8431,
      distanceFromClient: 15.4, // within 100m radius!
      isException: false,
      outcome: VisitOutcome.ORDER_TAKEN,
      notes: 'Reviewed stock levels with store manager. Discussed upcoming festival promotion orders.',
    },
  });

  // 8. Order Taking Example (With strictly verified math from Section 10.2)
  // Items:
  // Samsung Charger: 10 × 450 = 4,500
  // Samsung Cable: 5 × 250 = 1,250
  // Samsung Adapter: 2 × 650 = 1,300
  // Subtotal = 7,050
  // Discount = 450
  // Taxable = 6,600
  // Tax (18%) = 1,188
  // Grand Total = 7,788
  const p1 = await prisma.product.findUnique({ where: { sku: 'SAM-CHG-01' } });
  const p2 = await prisma.product.findUnique({ where: { sku: 'SAM-CBL-02' } });
  const p3 = await prisma.product.findUnique({ where: { sku: 'SAM-ADP-03' } });

  const existingOrder = await prisma.order.findUnique({ where: { orderNumber: 'ORD-2026-000001' } });
  let order1 = existingOrder;
  if (!order1 && p1 && p2 && p3) {
    order1 = await prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-000001',
        clientId: abcTraders.id,
        salespersonId: rahulProfile.id,
        status: OrderStatus.CONFIRMED,
        subtotal: 7050.0,
        discount: 450.0,
        tax: 1188.0,
        grandTotal: 7788.0,
        notes: 'Priority dispatch for festival stock refill',
        latitude: 12.8714,
        longitude: 74.8431,
        items: {
          create: [
            {
              productId: p1.id,
              productName: p1.name,
              productSku: p1.sku,
              quantity: 10,
              unitPrice: 450.0,
              discount: 0,
              tax: 810.0,
              total: 5310.0,
            },
            {
              productId: p2.id,
              productName: p2.name,
              productSku: p2.sku,
              quantity: 5,
              unitPrice: 250.0,
              discount: 0,
              tax: 225.0,
              total: 1475.0,
            },
            {
              productId: p3.id,
              productName: p3.name,
              productSku: p3.sku,
              quantity: 2,
              unitPrice: 650.0,
              discount: 0,
              tax: 234.0,
              total: 1534.0,
            },
          ],
        },
      },
    });

    // Post to Client Ledger as an INVOICE debit
    await prisma.clientLedgerEntry.create({
      data: {
        clientId: abcTraders.id,
        orderId: order1.id,
        entryType: LedgerEntryType.INVOICE,
        amount: 7788.0,
        runningBalance: 45000 + 7788.0,
        description: 'Invoice posted for Order #ORD-2026-000001',
        timestamp: new Date(Date.now() - 100 * 60 * 1000),
      },
    });
  }

  // 9. Payment Collection
  const existingPayment = await prisma.payment.findUnique({ where: { receiptNumber: 'PAY-2026-00045' } });
  if (!existingPayment) {
    const payment = await prisma.payment.create({
      data: {
        receiptNumber: 'PAY-2026-00045',
        clientId: abcTraders.id,
        salespersonId: rahulProfile.id,
        orderId: order1?.id,
        amount: 20000.0,
        paymentMethod: PaymentMethod.UPI,
        transactionReference: 'UPI-REF-99882211',
        proofUrl: '/uploads/receipts/proof-pay-45.jpg',
        status: PaymentStatus.VERIFIED,
        collectedAt: new Date(Date.now() - 90 * 60 * 1000),
        verifiedAt: new Date(Date.now() - 30 * 60 * 1000),
        verifiedById: managerUser.id,
        notes: 'Advance UPI transfer verified through bank statement',
      },
    });

    // Verified payment posted to ledger as CREDIT
    await prisma.clientLedgerEntry.create({
      data: {
        clientId: abcTraders.id,
        paymentId: payment.id,
        entryType: LedgerEntryType.PAYMENT,
        amount: 20000.0,
        runningBalance: 52788.0 - 20000.0, // 32,788
        description: 'Verified payment received via UPI (PAY-2026-00045)',
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
  }

  // 10. Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        userId: adminUser.id,
        action: 'ASSIGN_CLIENT',
        module: 'CLIENT_ASSIGNMENT',
        recordId: abcTraders.id,
        oldValue: { primarySalesperson: null },
        newValue: { primarySalesperson: 'Rahul Sharma', backupSalesperson: 'Ahmed Khan' },
        ip: '127.0.0.1',
        device: 'Web Admin Chrome MacOS',
      },
      {
        userId: managerUser.id,
        action: 'VERIFY_PAYMENT',
        module: 'PAYMENT',
        recordId: 'PAY-2026-00045',
        oldValue: { status: 'PENDING' },
        newValue: { status: 'VERIFIED', verifiedBy: 'Priya Sundaram' },
        ip: '127.0.0.1',
        device: 'Web Admin Chrome MacOS',
      },
    ],
  });

  // 11. Notifications
  await prisma.notification.createMany({
    data: [
      {
        recipientId: rahulUser.id,
        role: Role.SALESPERSON,
        title: 'New Client Assigned',
        message: 'ABC Traders and City Electronics Hub assigned to your territory (Mangalore North).',
        type: 'ASSIGNMENT',
        read: true,
      },
      {
        recipientId: rahulUser.id,
        role: Role.SALESPERSON,
        title: 'Payment Verified',
        message: 'Your payment collection PAY-2026-00045 of ₹20,000 has been verified by Manager Priya.',
        type: 'PAYMENT_VERIFIED',
        read: false,
      },
      {
        recipientId: adminUser.id,
        role: Role.SUPER_ADMIN,
        title: 'Salesperson Started Day',
        message: 'Rahul Sharma started work session at 09:12 AM with ON DUTY status.',
        type: 'ATTENDANCE',
        read: false,
      },
    ],
  });

  // Seed Access Code for Rahul (Code: RAHUL12345)
  const accessCodeHash = await bcrypt.hash('RAHUL12345', 10);
  await prisma.userAccessCode.deleteMany({ where: { userId: rahulUser.id } });
  await prisma.userAccessCode.create({
    data: {
      userId: rahulUser.id,
      codeHash: accessCodeHash,
      displayHint: '...345',
      status: 'ACTIVE',
      createdById: adminUser.id,
    },
  });

  // Seed sample staff expenses
  await prisma.expenseHistory.deleteMany({});
  await prisma.expense.deleteMany({});

  const exp1 = await prisma.expense.create({
    data: {
      expenseNumber: 'EXP-2026-001',
      salespersonId: rahulUser.salespersonProfile!.id,
      category: 'FUEL',
      amount: 450.00,
      currency: 'INR',
      expenseDate: new Date(),
      description: 'Fuel refill at Shell pump for client route visit',
      status: 'SUBMITTED',
      history: {
        create: [
          { action: 'CREATED', actorId: rahulUser.id, newStatus: 'DRAFT', comment: 'Draft created' },
          { action: 'SUBMITTED', actorId: rahulUser.id, previousStatus: 'DRAFT', newStatus: 'SUBMITTED', comment: 'Submitted for manager review' },
        ],
      },
    },
  });

  const exp2 = await prisma.expense.create({
    data: {
      expenseNumber: 'EXP-2026-002',
      salespersonId: rahulUser.salespersonProfile!.id,
      category: 'AUTO_RICKSHAW',
      amount: 180.00,
      currency: 'INR',
      expenseDate: new Date(Date.now() - 86400000),
      description: 'Auto fare from Central Station to Apex Supermarket',
      status: 'APPROVED',
      approvedBy: managerUser.id,
      approvedAt: new Date(),
      history: {
        create: [
          { action: 'CREATED', actorId: rahulUser.id, newStatus: 'DRAFT', comment: 'Draft created' },
          { action: 'SUBMITTED', actorId: rahulUser.id, previousStatus: 'DRAFT', newStatus: 'SUBMITTED', comment: 'Submitted for manager review' },
          { action: 'APPROVED', actorId: managerUser.id, previousStatus: 'SUBMITTED', newStatus: 'APPROVED', comment: 'Approved within travel allowance' },
        ],
      },
    },
  });

  const exp3 = await prisma.expense.create({
    data: {
      expenseNumber: 'EXP-2026-003',
      salespersonId: rahulUser.salespersonProfile!.id,
      category: 'FOOD_MEALS',
      amount: 320.00,
      currency: 'INR',
      expenseDate: new Date(Date.now() - 172800000),
      description: 'Lunch during outstation territory route',
      status: 'REIMBURSED',
      approvedBy: managerUser.id,
      approvedAt: new Date(Date.now() - 86400000),
      reimbursedBy: adminUser.id,
      reimbursedAt: new Date(),
      reimbursementRef: 'UPI-774928190',
      reimbursementMethod: 'UPI',
      history: {
        create: [
          { action: 'CREATED', actorId: rahulUser.id, newStatus: 'DRAFT', comment: 'Draft created' },
          { action: 'SUBMITTED', actorId: rahulUser.id, previousStatus: 'DRAFT', newStatus: 'SUBMITTED', comment: 'Submitted' },
          { action: 'APPROVED', actorId: managerUser.id, previousStatus: 'SUBMITTED', newStatus: 'APPROVED', comment: 'Approved' },
          { action: 'REIMBURSED', actorId: adminUser.id, previousStatus: 'APPROVED', newStatus: 'REIMBURSED', comment: 'Disbursed via UPI' },
        ],
      },
    },
  });

  const exp4 = await prisma.expense.create({
    data: {
      expenseNumber: 'EXP-2026-004',
      salespersonId: rahulUser.salespersonProfile!.id,
      category: 'OTHER',
      amount: 1200.00,
      currency: 'INR',
      expenseDate: new Date(Date.now() - 259200000),
      description: 'Hardware store client sample display materials',
      status: 'REJECTED',
      rejectionReason: 'Missing tax invoice receipt; please attach official bill and resubmit.',
      rejectedBy: managerUser.id,
      rejectedAt: new Date(),
      history: {
        create: [
          { action: 'CREATED', actorId: rahulUser.id, newStatus: 'DRAFT', comment: 'Draft created' },
          { action: 'SUBMITTED', actorId: rahulUser.id, previousStatus: 'DRAFT', newStatus: 'SUBMITTED', comment: 'Submitted' },
          { action: 'REJECTED', actorId: managerUser.id, previousStatus: 'SUBMITTED', newStatus: 'REJECTED', comment: 'Missing tax invoice receipt; please attach official bill and resubmit.' },
        ],
      },
    },
  });

  console.log('✅ Database seeded successfully!');
  console.log('🔑 Credentials:');
  console.log('   Admin: admin@erp.com / Password123!');
  console.log('   Manager: manager@erp.com / Password123!');
  console.log('   Salesperson (Password): rahul@erp.com / Password123! (or phone: 9876543212)');
  console.log('   Salesperson (Access Code): Employee Code "EMP-001" or Mobile "9876543212" + Code "RAHUL12345"');
  console.log('💳 Seeded 4 Staff Expenses: SUBMITTED (₹450), APPROVED (₹180), REIMBURSED (₹320), REJECTED (₹1,200)');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
