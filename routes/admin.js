import express from 'express';
import Report from '../models/Report.js';
import auth from '../middleware/authMiddleware.js';
import { checkAdmin } from '../middleware/roleMiddleware.js';
import redisClient from '../utils/redisClient.js';

const router = express.Router();

// GET /api/admin/dashboard
// Returns total, pending, fixed counts + avg resolution + type distribution
router.get('/dashboard', auth, checkAdmin, async (req, res) => {
  try {
    const cacheKey = 'admin:dashboard';
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const total = await Report.countDocuments();
    const pending = await Report.countDocuments({ status: 'Pending' });
    const fixed = await Report.countDocuments({ status: 'Fixed' });

    const fixedDocs = await Report.find({ status: 'Fixed' }).select('createdAt updatedAt');
    const avgResolution = fixedDocs.length
      ? (fixedDocs.reduce((sum, r) =>
          sum + ((r.updatedAt - r.createdAt)/(1000*60*60*24)), 0
        ) / fixedDocs.length).toFixed(1)
      : 0;

    const byTypeAgg = await Report.aggregate([
      { $group: { _id: '$issueType', count: { $sum: 1 } } }
    ]);
    const typeDistribution = byTypeAgg.map(t => ({
      type: t._id,
      count: t.count
    }));

    const result = {
      total,
      pending,
      fixed,
      avgResolution: parseFloat(avgResolution),
      typeDistribution
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(result)); // cache 5 mins
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error fetching dashboard stats' });
  }
});

// GET /api/admin/reports
// Supports filtering by status/type, pagination, and sorting by time/upvotes
router.get('/reports', auth, checkAdmin, async (req, res) => {
  try {
    const {
      status = 'all',
      type = 'all',
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (type !== 'all') filter.issueType = type;

    const skip = (page - 1) * limit;
    const sortField = sortBy === 'upvotes' ? 'upvoteCount' : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // Total count (before aggregation)
    const total = await Report.countDocuments(filter);

    // Aggregated data with sorting
    const reports = await Report.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'upvotes',
          localField: '_id',
          foreignField: 'report',
          as: 'upvotes'
        }
      },
      {
        $addFields: {
          upvoteCount: { $size: '$upvotes' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      { $sort: { [sortField]: sortDirection } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      reports
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error listing reports' });
  }
});

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
      await redisClient.del('admin:dashboard');
      res.json(report);
    } catch (err) {
      console.error('Error updating report status:', err);
      res.status(500).json({ msg: 'Server error updating status' });
    }
  }
);


export default router;
