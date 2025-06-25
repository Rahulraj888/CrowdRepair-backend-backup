import express from 'express';
import multer  from 'multer';
import path    from 'path';
import Report  from '../models/Report.js';
import auth    from '../middleware/authMiddleware.js';
import Comment from '../models/Comment.js';
import Upvote  from '../models/Upvote.js';
import sendEmail from '../utils/sendEmail.js';
import User from '../models/User.js';

const router = express.Router();

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/reports
// List or filter reports
router.get('/', auth, async (req, res) => {
  try {
    const { status='all', type='all' } = req.query;
    const filter = {};
    if (status!=='all')    filter.status    = status;
    if (type!=='all')      filter.issueType = type;

    // grab raw reports
    const reports = await Report.find(filter)
      .sort({ createdAt:-1 })
      .lean();    // lean() so we can add fields

    const ids = reports.map(r => r._id);

    // aggregate upvote counts
    const ups = await Upvote.aggregate([
      { $match: { report: { $in: ids } } },
      { $group: { _id: '$report', count: { $sum:1 } } }
    ]);
    const upMap = ups.reduce((m, u) => { m[u._id.toString()] = u.count; return m }, {});

    // aggregate comment counts
    const cms = await Comment.aggregate([
      { $match: { report: { $in: ids } } },
      { $group: { _id: '$report', count: { $sum:1 } } }
    ]);
    const cMap = cms.reduce((m, c) => { m[c._id.toString()] = c.count; return m }, {});

    // enrich each report
    const enriched = reports.map(r => ({
      ...r,
      upvoteCount:  upMap[r._id.toString()]  || 0,
      commentCount: cMap[r._id.toString()]   || 0
    }));

    res.json(enriched);
  } catch(err) {
    console.error(err);
    res.status(500).json({ msg:'Server error listing reports' });
  }
});

// POST /api/reports
// Submit new report, then email the reporter and return a thank-you message
router.post(
  '/',
  auth,
  upload.array('images', 5),
  async (req, res) => {
    try {
      const { issueType, latitude, longitude, description } = req.body;
      const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

      //Create & save the report
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

      //Send confirmation email to the reporter
      const reporter = await User.findById(req.user.id).select('name email');
      if (reporter) {
        const html = `
          <h2>Thank you for reporting an issue!</h2>
          <p>Hi ${reporter.name},</p>
          <p>We’ve received your report of a <strong>${issueType}</strong>:</p>
          <ul>
            <li><strong>Description:</strong> ${description}</li>
            <li><strong>Location:</strong> (${latitude}, ${longitude})</li>
          </ul>
          <p>Our team will review it and take action shortly.</p>
          <p>Thanks again,<br/>The Mobile Appz Team</p>
        `;
        // fire-and-forget email, log errors if any
        sendEmail({
          to: reporter.email,
          subject: 'Thank you for your report!',
          html
        }).catch(err => console.error('Error sending confirmation email:', err));
      }

      //Respond with the new report and a popup message
      res.status(201).json({
        report,
        msg: 'Thank you for reporting! A confirmation email has been sent.'
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error creating report' });
    }
  }
);

// DELETE /api/reports/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ msg: 'Report not found' });
    }

    // only the creator can delete
    if (report.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    // only pending reports are deletable
    if (report.status !== 'Pending') {
      return res
        .status(400)
        .json({ msg: 'Only pending reports can be deleted' });
    }

    await report.deleteOne();
    res.json({ msg: 'Report deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error deleting report' });
  }
});

// GET /api/reports/:id
// Fetch a single report (for pre-filling an edit form)
router.get('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ msg: 'Report not found' });
    }
    // Only owner can fetch it for editing
    if (report.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error fetching report' });
  }
});

// PUT /api/reports/:id
// Update an existing report (only if Pending)
router.put(
  '/:id',
  auth,
  upload.array('images', 5),
  async (req, res) => {
    try {
      const report = await Report.findById(req.params.id);
      if (!report) {
        return res.status(404).json({ msg: 'Report not found' });
      }

      // only the creator can edit
      if (report.user.toString() !== req.user.id) {
        return res.status(403).json({ msg: 'Unauthorized' });
      }

      // only pending reports are editable
      if (report.status !== 'Pending') {
        return res
          .status(400)
          .json({ msg: 'Only pending reports can be edited' });
      }

      // Apply allowed updates
      const { issueType, latitude, longitude, description } = req.body;
      if (issueType) report.issueType = issueType;
      if (description) report.description = description;
      if (latitude && longitude) {
        report.location.coordinates = [
          parseFloat(longitude),
          parseFloat(latitude)
        ];
      }

      // If new images were uploaded, replace the old ones
      if (req.files && req.files.length) {
        report.imageUrls = req.files.map(f => `/uploads/${f.filename}`);
      }

      await report.save();
      res.json(report);
    } catch (err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error updating report' });
    }
  }
);

// POST /api/reports/:id/upvote
// Upvote a report
router.post('/:id/upvote', auth, async (req, res) => {
  try {
    const reportId = req.params.id;
    const userId   = req.user.id;

    const exists = await Upvote.findOne({ user: userId, report: reportId });
    if (exists) return res.status(400).json({ msg: 'Already upvoted' });

    await Upvote.create({ user: userId, report: reportId });
    const count = await Upvote.countDocuments({ report: reportId });
    res.json({ upvotes: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error upvoting' });
  }
});

// POST /api/reports/:id/comments
// Add a comment
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const reportId = req.params.id;
    const userId   = req.user.id;
    const { text } = req.body;

    const comment = await Comment.create({ user: userId, report: reportId, text });
    await comment.populate('user', 'name');
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error commenting' });
  }
});

// GET /api/reports/:id/comments
// List comments for a report
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const reportId = req.params.id;
    const comments = await Comment.find({ report: reportId })
      .sort({ createdAt: -1 })
      .populate('user', 'name');
    res.json(comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error listing comments' });
  }
});

export default router;
