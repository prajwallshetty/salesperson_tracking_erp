import { Router, Request, Response } from 'express';
import { prisma, Role } from '../db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// GET /api/products
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { search, categoryId, status = 'ACTIVE', limit = 100, offset = 0 } = req.query;

  const whereClause: any = {};
  if (status) {
    whereClause.status = String(status);
  }

  if (categoryId) {
    whereClause.categoryId = String(categoryId);
  }

  if (search) {
    const s = String(search).toLowerCase();
    whereClause.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { sku: { contains: s, mode: 'insensitive' } },
      { barcode: { contains: s, mode: 'insensitive' } },
      { brand: { contains: s, mode: 'insensitive' } },
    ];
  }

  const [total, products] = await Promise.all([
    prisma.product.count({ where: whereClause }),
    prisma.product.findMany({
      where: whereClause,
      include: { category: { select: { name: true } } },
      orderBy: { name: 'asc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
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

// GET /api/products/:id
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  res.json({ data: product });
});

// POST /api/products (Admin/Manager)
router.post('/', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { sku, barcode, name, categoryId, brand, description, unit, sellingPrice, mrp, taxRate, discount, stock, minimumStock } = req.body;

  if (!sku || !name || !categoryId || sellingPrice === undefined || mrp === undefined) {
    res.status(400).json({ error: 'Missing required product fields (sku, name, categoryId, sellingPrice, mrp)' });
    return;
  }

  const product = await prisma.product.create({
    data: {
      sku,
      barcode: barcode || null,
      name,
      categoryId,
      brand: brand || 'General',
      description,
      unit: unit || 'PCS',
      sellingPrice,
      mrp,
      taxRate: taxRate !== undefined ? taxRate : 18.0,
      discount: discount || 0,
      stock: stock || 0,
      minimumStock: minimumStock || 5,
    },
  });

  await logAuditEvent({
    req,
    action: 'CREATE_PRODUCT',
    module: 'PRODUCT',
    recordId: product.id,
    newValue: product,
  });

  res.status(201).json({ data: product });
});

// Categories
router.get('/meta/categories', authenticateToken, async (_req: Request, res: Response): Promise<void> => {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  res.json({ data: categories });
});

router.post('/meta/categories', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Category name is required' });
    return;
  }

  const cat = await prisma.category.create({
    data: { name, description },
  });

  res.status(201).json({ data: cat });
});

export default router;
