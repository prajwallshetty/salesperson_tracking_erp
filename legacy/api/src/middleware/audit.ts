import { Request } from 'express';
import { prisma } from '../db';

export async function logAuditEvent(params: {
  req?: Request;
  userId?: string | null;
  action: string;
  module: string;
  recordId?: string | null;
  oldValue?: any;
  newValue?: any;
}): Promise<void> {
  try {
    const ip = params.req?.ip || params.req?.socket?.remoteAddress || '127.0.0.1';
    const device = (params.req?.headers['user-agent'] as string) || (params.req?.headers['x-device-id'] as string) || 'Unknown Device';
    const userId = params.userId || params.req?.user?.id || null;

    await prisma.auditLog.create({
      data: {
        userId,
        action: params.action,
        module: params.module,
        recordId: params.recordId ? String(params.recordId) : null,
        oldValue: params.oldValue !== undefined ? params.oldValue : undefined,
        newValue: params.newValue !== undefined ? params.newValue : undefined,
        ip: String(ip),
        device: String(device).slice(0, 255),
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
