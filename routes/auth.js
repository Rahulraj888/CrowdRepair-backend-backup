// routes/auth.js
//Includes 4 api
// one api to regiser 
// one api to verify email for registration
// one api to login 
//one api to reset password

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');
const sendEmail = require('../utils/sendEmail');


// UTILITY: Generate Random Token 
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}


// ─── @route   POST /api/auth/register
//     @desc    Register a new user & send verification email
//     @access  Public
router.post(
  '/register',
  [
    body('name', 'Name is required').notEmpty(),
    body('email', 'Valid email is required').isEmail(),
    body('password', 'Password must be 6+ chars').isLength({ min: 6 }),
    body('mobile', 'Mobile number is required').notEmpty()
  ],
  async (req, res) => {
    // 1. Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, mobile } = req.body;
    try {
      // 2. Check if user already exists
      let user = await User.findOne({ email });
      if (user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'User already exists' }] });
      }

      // 3. Create new user (not yet verified)
      user = new User({
        name,
        email,
        password, // we'll hash next
        mobile,
        isVerified: false
      });

      // 4. Hash password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      // 5. Generate email verification token & expiry (24h)
      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      
      // 6. Save user ot the database
      await user.save();

      // 7. Send verification email
      const verifyURL = `http://localhost:5000/api/auth/verify-email?token=${emailToken}`;
      const message = `
        <h1>Email Verification</h1>
        <p>Hi ${name},</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verifyURL}">${verifyURL}</a>
        <p>This link will expire in 24 hours.</p>
      `;

      //send email for verification
      await sendEmail({
        to: email,
        subject: 'Verify Your Email',
        html: message
      });
      res
        .status(201)
        .json({ msg: 'Registration successful! Please check your email to verify.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);


// ─── @route   GET /api/auth/verify-email
//     @desc    Verify the user’s email using token
//     @access  Public
// TODO add redirect login after clicking verify
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).json({ msg: 'No token provided' });
  }

  try {
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.status(400).json({ msg: 'Token is invalid or expired.' });
    }

    // Mark as verified
    user.isVerified = true;
    user.verifiedAt = Date.now();
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpires = undefined;
    await user.save();

    // OPTIONAL: redirect to front-end page (e.g., React route)
    // res.redirect(`${process.env.CLIENT_URL}/email-verified`);

    // Or simply return JSON:
    res.json({ msg: 'Email successfully verified! You can now log in.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});


// ─── @route   POST /api/auth/login
//     @desc    Authenticate user & get JWT (only if verified)
//     @access  Public
router.post(
  '/login',
  [
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password is required').exists()
  ],
  async (req, res) => {
    // 1. Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    try {
      // 2. Check if user exists
      let user = await User.findOne({ email });
      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Invalid credentials' }] });
      }

      // 3. Check if email is verified
      if (!user.isVerified) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Please verify your email before logging in.' }] });
      }

      // 4. Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Invalid credentials' }] });
      }

      // 5. Create JWT payload
      const payload = {
        user: {
          id: user.id
        }
      };

      // 6. Sign token (expires in 2 hours)
      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '2h' },
        (err, token) => {
          if (err) throw err;
          res.json({ token });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);


// ─── @route   POST /api/auth/forgot-password
//     @desc    Send password reset email
//     @access  Public
router.post(
  '/forgot-password',
  [body('email', 'Please include a valid email').isEmail()],
  async (req, res) => {
    // 1. Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    try {
      // 2. Check if user exists & is verified
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'No account with that email found.' }] });
      }
      if (!user.isVerified) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Email not verified. Cannot reset password.' }] });
      }

      // 3. Generate reset token & expiry (1 hour)
      const resetToken = generateToken();
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 1 * 60 * 60 * 1000; // 1 hour
      await user.save();

      // 4. Send reset email
      const resetURL = `http://localhost:5000/api/auth/reset-password?token=${resetToken}`;
      const message = `
        <h1>Password Reset</h1>
        <p>Hi ${user.name},</p>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <a href="${resetURL}">${resetURL}</a>
        <p>If you did not request this, please ignore this email. This link expires in 1 hour.</p>
      `;
      await sendEmail({
        to: email,
        subject: 'Password Reset Request',
        html: message
      });

      res.json({ msg: 'Password reset email sent. Check your inbox.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);


// ─── @route   POST /api/auth/reset-password
//     @desc    Reset user’s password using token
//     @access  Public
router.post(
  '/reset-password',
  [body('password', 'Password must be 6+ chars').isLength({ min: 6 })],
  async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ msg: 'No token provided' });
    }

    // 1. Validate new password
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // 2. Find user by token & expiry
      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
      });
      if (!user) {
        return res.status(400).json({ msg: 'Token is invalid or expired.' });
      }

      // 3. Hash new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(req.body.password, salt);

      // 4. Clear reset fields
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;

      await user.save();

      res.json({ msg: 'Password has been reset. You can now log in.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);


// ─── @route   GET /api/auth/me
//     @desc    Get current user (protected)
//     @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    // req.user.id comes from authMiddleware
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
