import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>({}, async ({ params }) => {
  const product = await prisma.product.findUnique({ where: { id: params.id }, include: { category: true } });
  if (!product) return json({ error: 'Product not found' }, 404);
  return json({ data: product });
});
