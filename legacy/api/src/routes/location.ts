import { Router, Request, Response } from 'express';
import { prisma, Role, SalespersonStatus } from '../db';
import { locationUpdateSchema, isValidCoordinate, calculatePathDistanceKm, calculateHaversineDistanceMeters } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds } from '../middleware/auth';
import { notifySalespersonLocation } from '../socket';

const router = Router();

// POST /api/location/update & /api/location/batch (Section 23: Reliable Location API batch ingest)
router.post(['/update', '/batch'], authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = locationUpdateSchema.parse(req.body);
    const user = req.user!;

    const salespersonId = user.salespersonId;
    if (!salespersonId) {
      res.status(403).json({ error: 'Only salesperson accounts can report location points' });
      return;
    }

    // Verify salesperson is ON_DUTY
    const salesperson = await prisma.salesperson.findUnique({
      where: { id: salespersonId },
      select: { status: true },
    });

    if (!salesperson || salesperson.status !== SalespersonStatus.ON_DUTY) {
      res.status(403).json({
        error: 'Location rejected: Salesperson is not ON DUTY. Start day before tracking.',
      });
      return;
    }

    // Find or verify active location session
    let sessionId = parsed.sessionId;
    if (!sessionId) {
      const activeSession = await prisma.locationSession.findFirst({
        where: {
          salespersonId,
          status: 'ACTIVE',
        },
        orderBy: { startedAt: 'desc' },
      });

      if (!activeSession) {
        res.status(400).json({ error: 'No active tracking session found' });
        return;
      }
      sessionId = activeSession.id;
    }

    // Validate coordinates, sanitize timestamps, and apply accuracy-aware filtering
    const validPoints = [];
    const now = new Date();

    for (let i = 0; i < parsed.points.length; i++) {
      const pt = parsed.points[i];
      if (!isValidCoordinate(pt.latitude, pt.longitude)) {
        continue;
      }

      const timestamp = new Date(pt.timestamp);
      // Ignore points in the distant future (>5 mins ahead)
      if (timestamp.getTime() > now.getTime() + 5 * 60 * 1000) {
        continue;
      }

      // Accuracy-aware filtering: Flag points with accuracy > 150m
      let isFiltered = false;
      let filterReason: string | null = null;

      if (pt.accuracy && pt.accuracy > 150) {
        isFiltered = true;
        filterReason = 'POOR_ACCURACY';
      }

      // Check speed / jump directly or relative to previous point in batch
      if (pt.speed && pt.speed > 140) {
        isFiltered = true;
        filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
      } else if (i > 0) {
        const prevPt = parsed.points[i - 1];
        const distMeters = calculateHaversineDistanceMeters(prevPt.latitude, prevPt.longitude, pt.latitude, pt.longitude);
        const timeDiffSeconds = Math.max(1, (timestamp.getTime() - new Date(prevPt.timestamp).getTime()) / 1000);
        const speedKmh = (distMeters / timeDiffSeconds) * 3.6;

        if (speedKmh > 140) {
          isFiltered = true;
          filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
        }
      }

      validPoints.push({
        sessionId,
        salespersonId,
        latitude: pt.latitude,
        longitude: pt.longitude,
        accuracy: pt.accuracy !== undefined ? pt.accuracy : null,
        speed: pt.speed !== undefined ? pt.speed : null,
        heading: pt.heading !== undefined ? pt.heading : null,
        batteryLevel: pt.batteryLevel !== undefined ? pt.batteryLevel : null,
        networkType: pt.networkType || null,
        deviceId: pt.deviceId || null,
        clientPointId: (pt as any).clientPointId || undefined,
        isFiltered,
        filterReason,
        serverReceivedAt: now,
        timestamp,
      });
    }

    let insertedCount = 0;
    if (validPoints.length > 0) {
      const createRes = await prisma.locationPoint.createMany({
        data: validPoints,
        skipDuplicates: true,
      });
      insertedCount = createRes.count;

      // Real-time broadcast of latest high-confidence point
      const latestPoint = validPoints[validPoints.length - 1];
      notifySalespersonLocation(salespersonId, {
        latitude: latestPoint.latitude,
        longitude: latestPoint.longitude,
        accuracy: latestPoint.accuracy,
        speed: latestPoint.speed,
        heading: latestPoint.heading,
        batteryLevel: latestPoint.batteryLevel,
        timestamp: latestPoint.timestamp.toISOString(),
      });
    }

    res.json({
      message: 'Location points received successfully',
      pointsIngested: insertedCount,
      ingestedCount: insertedCount,
    });
  } catch (error) {
    console.error('Error updating location points:', error);
    res.status(500).json({ error: 'Failed to ingest location points' });
  }
});

// GET /api/location/current (Admin Live Map)
router.get('/current', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

    const whereClause: any = {};
    if (authorizedSalespersonIds !== undefined) {
      whereClause.id = { in: authorizedSalespersonIds };
    }

    const salespersons = await prisma.salesperson.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, phone: true } },
        clientAssignments: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
                currentOutstanding: true,
              },
            },
          },
        },
        locationPoints: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    const now = Date.now();
    const liveTrackers = salespersons.map((s) => {
      const lastPoint = s.locationPoints[0];
      const isOnline =
        s.status === SalespersonStatus.ON_DUTY &&
        lastPoint &&
        now - new Date(lastPoint.timestamp).getTime() < 10 * 60 * 1000;

      return {
        salespersonId: s.id,
        name: s.user.name,
        employeeCode: s.employeeCode,
        phone: s.user.phone,
        territory: s.territory,
        dutyStatus: s.status,
        isOnline: Boolean(isOnline),
        currentLocation: lastPoint
          ? {
              latitude: lastPoint.latitude,
              longitude: lastPoint.longitude,
              accuracy: lastPoint.accuracy,
              speed: lastPoint.speed,
              heading: lastPoint.heading,
              batteryLevel: lastPoint.batteryLevel,
              timestamp: lastPoint.timestamp,
              isFiltered: lastPoint.isFiltered,
            }
          : null,
        assignedClients: s.clientAssignments.map((a) => ({
          id: a.client.id,
          name: a.client.name,
          latitude: a.client.latitude,
          longitude: a.client.longitude,
          outstanding: Number(a.client.currentOutstanding),
        })),
      };
    });

    res.json({ data: liveTrackers });
  } catch (error) {
    console.error('Error fetching current locations:', error);
    res.status(500).json({ error: 'Failed to retrieve current field telemetry' });
  }
});

// GET /api/location/history (Route History, Polyline, Gap Detection & Playback)
router.get('/history', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { salespersonId, date } = req.query;
    const user = req.user!;
    const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

    let targetSalespersonId = salespersonId as string;
    if (!targetSalespersonId) {
      if (user.role === Role.SALESPERSON && user.salespersonId) {
        targetSalespersonId = user.salespersonId;
      } else {
        res.status(400).json({ error: 'salespersonId parameter is required' });
        return;
      }
    }

    if (authorizedSalespersonIds !== undefined && !authorizedSalespersonIds.includes(targetSalespersonId)) {
      res.status(403).json({ error: 'Access denied to this salesperson location history' });
      return;
    }

    const queryDate = date ? new Date(date as string) : new Date();
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch chronological GPS points
    const points = await prisma.locationPoint.findMany({
      where: {
        salespersonId: targetSalespersonId,
        timestamp: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        batteryLevel: true,
        isFiltered: true,
        filterReason: true,
        timestamp: true,
      },
    });

    // Detect tracking gaps (>15 mins) and group into polyline segments
    const segments: Array<Array<any>> = [];
    let currentSegment: Array<any> = [];

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (i > 0) {
        const prevPt = points[i - 1];
        const gapMinutes = (new Date(pt.timestamp).getTime() - new Date(prevPt.timestamp).getTime()) / (60 * 1000);
        if (gapMinutes > 15) {
          // Finish previous segment and begin a new one across the gap
          if (currentSegment.length > 0) {
            segments.push(currentSegment);
          }
          currentSegment = [];
        }
      }
      currentSegment.push(pt);
    }
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    // Fetch chronological day events: visits, orders, payments, expenses, and attendance
    const [visits, orders, payments, expenses, attendance] = await Promise.all([
      prisma.clientVisit.findMany({
        where: {
          salespersonId: targetSalespersonId,
          startedAt: { gte: startOfDay, lte: endOfDay },
        },
        include: { client: { select: { id: true, name: true, address: true, latitude: true, longitude: true } } },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.order.findMany({
        where: {
          salespersonId: targetSalespersonId,
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
        include: { client: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.payment.findMany({
        where: {
          salespersonId: targetSalespersonId,
          collectedAt: { gte: startOfDay, lte: endOfDay },
        },
        include: { client: { select: { name: true } } },
        orderBy: { collectedAt: 'asc' },
      }),
      prisma.expense.findMany({
        where: {
          salespersonId: targetSalespersonId,
          expenseDate: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { expenseDate: 'asc' },
      }),
      prisma.attendance.findFirst({
        where: {
          salespersonId: targetSalespersonId,
          date: { gte: startOfDay, lte: endOfDay },
        },
      }),
    ]);

    // Use only high-confidence non-filtered points for distance calculation
    const displayPoints = points.filter((p) => !p.isFiltered);
    const estimatedDistanceKm = calculatePathDistanceKm(displayPoints);

    res.json({
      salespersonId: targetSalespersonId,
      date: startOfDay.toISOString().split('T')[0],
      pointsCount: points.length,
      filteredPointsCount: displayPoints.length,
      estimatedDistanceKm,
      disclaimer: 'Distance and travel times are algorithmic estimates based on sampled GPS fixes. Gaps indicate lost signal, app suspension, or device restrictions.',
      attendance: attendance
        ? {
            loginAt: attendance.loginAt,
            logoutAt: attendance.logoutAt,
            status: attendance.status,
            workingMinutes: attendance.workingMinutes,
            distanceTravelled: attendance.distanceTravelled,
          }
        : null,
      rawPoints: points,
      segments,
      events: {
        visits: visits.map((v) => ({
          id: v.id,
          clientName: v.client.name,
          address: v.client.address,
          latitude: v.latitude || v.client.latitude,
          longitude: v.longitude || v.client.longitude,
          startedAt: v.startedAt,
          endedAt: v.endedAt,
          outcome: v.outcome,
          notes: v.notes,
        })),
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          clientName: o.client.name,
          grandTotal: Number(o.grandTotal),
          createdAt: o.createdAt,
        })),
        payments: payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          clientName: p.client.name,
          amount: Number(p.amount),
          paymentMethod: p.paymentMethod,
          collectedAt: p.collectedAt,
        })),
        expenses: expenses.map((e) => ({
          id: e.id,
          expenseNumber: e.expenseNumber,
          category: e.category,
          amount: parseFloat(e.amount.toString()),
          description: e.description,
          latitude: e.latitude,
          longitude: e.longitude,
          expenseDate: e.expenseDate,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching location history:', error);
    res.status(500).json({ error: 'Failed to retrieve route history' });
  }
});

export default router;
