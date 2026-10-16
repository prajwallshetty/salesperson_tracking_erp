import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Redact passwords & sensitive tokens from logs
  const sanitizedBody = { ...req.body };
  if (sanitizedBody.password) sanitizedBody.password = '***REDACTED***';
  if (sanitizedBody.token) sanitizedBody.token = '***REDACTED***';

  console.error(`[API Error] ${req.method} ${req.url}:`, {
    error: err.message || err,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: 'A record with this identifier already exists',
        meta: err.meta,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        error: 'Record not found',
      });
      return;
    }
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
  });
}
