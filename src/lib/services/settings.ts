import { prisma } from '@/lib/db';
import { DEFAULT_CONFIG } from '@/lib/domain/constants';

export async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.systemSetting.findFirst({ where: { key } });
  return s?.value ?? null;
}

/** `manager_order_approval_required` — orders start SUBMITTED instead of CONFIRMED. */
export async function isOrderApprovalRequired(): Promise<boolean> {
  return (await getSetting('manager_order_approval_required')) === 'true';
}

/** `cash_verification_required` — only an explicit 'false' auto-verifies cash (legacy rule). */
export async function isCashVerificationRequired(): Promise<boolean> {
  return (await getSetting('cash_verification_required')) !== 'false';
}

export async function getVisitRadiusMeters(): Promise<number> {
  const v = parseInt((await getSetting('visit_radius_meters')) || '', 10);
  return isNaN(v) ? DEFAULT_CONFIG.VISIT_RADIUS_METERS : v;
}
