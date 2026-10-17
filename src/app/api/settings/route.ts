import { z } from 'zod';
import { prisma, Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async () => {
  const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  return json({ data: settings });
});

const settingsSchema = z.array(
  z.object({ key: z.string().trim().min(1).max(100).regex(/^[a-z0-9_]+$/, 'Setting keys use lower_snake_case'), value: z.union([z.string(), z.number(), z.boolean()]) })
);

export const PUT = authedRoute({ roles: [Role.SUPER_ADMIN] }, async (ctx) => {
  const { settings } = await readJson(ctx.req);
  if (!Array.isArray(settings)) return json({ error: 'settings array required' }, 400);
  const parsed = settingsSchema.parse(settings);

  const tenantId = ctx.user.tenantId;
  await prisma.$transaction(
    parsed.map((s) =>
      prisma.systemSetting.upsert({ where: { tenantId_key: { tenantId, key: s.key } }, update: { value: String(s.value) }, create: { key: s.key, value: String(s.value) } })
    )
  );
  await logAuditEvent({ actor: actorFrom(ctx), action: 'UPDATE_SYSTEM_SETTINGS', module: 'SETTINGS', newValue: parsed });
  return json({ message: 'Settings updated successfully' });
});
