import { z } from 'zod';
import { prisma, Role, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, readJson, searchParams } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 100, max: 500 });
  // Legacy default: ACTIVE only. `status=ALL` lists every product.
  const status = sp.get('status') ?? 'ACTIVE';
  const where: Prisma.ProductWhereInput = {};
  if (status && status !== 'ALL') where.status = status;
  if (sp.get('categoryId')) where.categoryId = sp.get('categoryId')!;
  const search = sp.get('search');
  if (search) where.OR = ['name', 'sku', 'barcode', 'brand'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include: { category: { select: { name: true } } }, orderBy: { name: 'asc' }, skip: offset, take: limit }),
  ]);

  return json({
    total,
    data: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.category.name,
      brand: p.brand,
      description: p.description,
      unit: p.unit,
      sellingPrice: Number(p.sellingPrice),
      mrp: Number(p.mrp),
      taxRate: Number(p.taxRate),
      discount: Number(p.discount),
      stock: p.stock,
      minimumStock: p.minimumStock,
      image: p.image,
      status: p.status,
    })),
  });
});

const money = z.coerce.number().nonnegative();
const productSchema = z.object({
  sku: z.string().trim().min(1),
  barcode: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1),
  categoryId: z.string().uuid('Valid category is required'),
  brand: z.string().trim().optional().nullable(),
  description: z.string().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
  sellingPrice: money,
  mrp: money,
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  discount: z.coerce.number().min(0).optional().nullable(),
  stock: z.coerce.number().int().optional().nullable(),
  minimumStock: z.coerce.number().int().min(0).optional().nullable(),
});

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canManageProducts' }, async (ctx) => {
  const body = await readJson(ctx.req);
  if (!body.sku || !body.name || !body.categoryId || body.sellingPrice === undefined || body.mrp === undefined) {
    return json({ error: 'Missing required product fields (sku, name, categoryId, sellingPrice, mrp)' }, 400);
  }
  const p = productSchema.parse(body);

  const product = await prisma.product.create({
    data: {
      sku: p.sku,
      barcode: p.barcode || null,
      name: p.name,
      categoryId: p.categoryId,
      brand: p.brand || 'General',
      description: p.description || undefined,
      unit: p.unit || 'PCS',
      sellingPrice: p.sellingPrice,
      mrp: p.mrp,
      taxRate: p.taxRate ?? 18.0,
      discount: p.discount || 0,
      stock: p.stock || 0,
      minimumStock: p.minimumStock ?? 5,
    },
  });
  await logAuditEvent({ actor: actorFrom(ctx), action: 'CREATE_PRODUCT', module: 'PRODUCT', recordId: product.id, newValue: product });
  return json({ data: product }, 201);
});
