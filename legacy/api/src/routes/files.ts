import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';
import { config } from '../config';

const router = Router();

// Ensure upload folder exists
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `file-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.'));
    }
  },
});

// POST /api/files/upload
router.post('/upload', authenticateToken, upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const fileUrl = `/api/files/${req.file.filename}`;
  res.json({
    message: 'File uploaded successfully',
    url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

// GET /api/files/:filename
router.get('/:filename', authenticateToken, (req: Request, res: Response): void => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(config.uploadDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.sendFile(filePath);
});

export default router;
