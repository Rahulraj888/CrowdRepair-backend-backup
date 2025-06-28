import express from 'express';
import Report from '../models/Report.js';
import Upvote from '../models/Upvote.js';
import Comment from '../models/Comment.js';
import auth from '../middleware/authMiddleware.js';
import { checkAdmin } from '../middleware/roleMiddleware.js';

const router = express.Router();

// GET /api/admin/dashboard
// Returns total, pending, fixed counts + avg resolution + type distribution
router.get(
  '/dashboard',
  auth,
  checkAdmin,
  async (req, res) => {
    try {
      // Totals
      const total = await Report.countDocuments();
      const pending = await Report.countDocuments({ status: 'Pending' });
      const fixed = await Report.countDocuments({ status: 'Fixed' });

      // Avg resolution time (in days) for fixed issues
      const fixedDocs = await Report.find({ status: 'Fixed' }).select('createdAt updatedAt');
      const avgResolution = fixedDocs.length
        ? (fixedDocs.reduce((sum, r) =>
            sum + ((r.updatedAt - r.createdAt)/(1000*60*60*24)), 0
          ) / fixedDocs.length).toFixed(1)
        : 0;

      // Issue type distribution
      const byTypeAgg = await Report.aggregate([
        { $group: { _id: '$issueType', count: { $sum: 1 } } }
      ]);
      const typeDistribution = byTypeAgg.map(t => ({
        type: t._id,
        count: t.count
      }));

      res.json({
        total,
        pending,
        fixed,
        avgResolution: parseFloat(avgResolution),
        typeDistribution
      });
    } catch(err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error fetching dashboard stats' });
    }
  }
);

// GET /api/admin/reports
// Paginated, filterable list of recent reports
router.get(
  '/reports',
  auth,
  checkAdmin,
  async (req, res) => {
    try {
      const { status = 'all', type = 'all', page = 1, limit = 10 } = req.query;
      const filter = {};
      if (status !== 'all') filter.status = status;
      if (type   !== 'all') filter.issueType = type;

      const skip = (page - 1) * limit;
      const [ total, reports ] = await Promise.all([
        Report.countDocuments(filter),
        Report.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('user', 'name email')
      ]);

      res.json({ total, page: parseInt(page), limit: parseInt(limit), reports });
    } catch(err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error listing reports' });
    }
  }
);

// PATCH /api/admin/reports/:id/status
// Update a report’s status (and optional rejection reason)
router.patch(
  '/reports/:id/status',
  auth,
  checkAdmin,
  async (req, res) => {
    try {
      const { status, rejectReason } = req.body;
      const validStatuses = ['Pending','In Progress','Fixed','Rejected'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ msg: 'Invalid status' });
      }
      // If rejecting, require a reason
      if (status === 'Rejected' && (!rejectReason || !rejectReason.trim())) {
        return res.status(400).json({ msg: 'Rejection reason is required' });
      }
      // Build update object
      const update = {
        status,
        updatedAt: Date.now()
      };

      if (status === 'Rejected') {
        update.rejectReason = rejectReason.trim();
      } else {
        // clear out any existing reason when not rejected
        update.$unset = { rejectReason: "" };
      }

      const report = await Report.findByIdAndUpdate(
        req.params.id,
        update,
        { new: true }
      );
      if (!report) {
        return res.status(404).json({ msg: 'Report not found' });
      }

      res.json(report);
    } catch (err) {
      console.error('Error updating report status:', err);
      res.status(500).json({ msg: 'Server error updating status' });
    }
  }
);


export default router;
