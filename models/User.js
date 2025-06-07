// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },

  // ─── Mobile Number ────────────────────────────────────────────────────────────
  mobile: {
    type: String,
    required: true,
    trim: true
    // (Optionally add regex validation for specific format)
  },

  // ─── Email Verification ───────────────────────────────────────────────────────
  isVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String
    // e.g., a crypto.randomBytes(32).toString('hex') or a signed JWT
  },
  emailVerificationTokenExpires: {
    type: Date
    // e.g., Date.now() + (24 * 60 * 60 * 1000) for 24h expiry
  },
  verifiedAt: {
    type: Date
    // timestamp of when they clicked the link
  },

  resetPasswordToken: {
    type: String
    // e.g., crypto.randomBytes(32).toString('hex')
  },
  resetPasswordExpires: {
    type: Date
    // e.g., Date.now() + (1 * 60 * 60 * 1000) for 1h expiry
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});


module.exports = mongoose.model('User', userSchema);
