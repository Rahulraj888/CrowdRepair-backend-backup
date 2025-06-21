import express from 'express';
import multer from 'multer';
import path from 'path';
import Report from '../models/Report.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

//GET /api/reports
// Fetch all reports, or filter by status via ?status=Pending|Fixed|In Progress
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && status !== 'all' ? { status } : {};
    const reports = await Report.find(filter).sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error listing reports' });
  }
});

//POST /api/reports
// Create a new report with optional image uploads
router.post(
  '/',
  auth,
  upload.array('images', 5),
  async (req, res) => {
    try {
      const { issueType, latitude, longitude, description } = req.body;
      const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

      const report = new Report({
        user: req.user.id,
        issueType,
        location: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        description,
        imageUrls
      });

      await report.save();
      res.status(201).json(report);
    } catch (err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error' });
    }
  }
);

export default router;
