import { prisma, Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';
import { notifyProductChanged } from '@/lib/realtime/emitter';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async () => {
  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } });
  return json({ data: categories });
});

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canManageProducts' }, async (ctx) => {
  const { name, description } = await readJson(ctx.req);
  if (!name || typeof name !== 'string' || !name.trim()) return json({ error: 'Category name is required' }, 400);
  const cat = await prisma.category.create({ data: { name: name.trim(), description } });
  await logAuditEvent({ actor: actorFrom(ctx), action: 'CREATE_CATEGORY', module: 'PRODUCT', recordId: cat.id, newValue: cat });
  notifyProductChanged({ id: cat.id, action: 'category' });
  return json({ data: cat }, 201);
});
