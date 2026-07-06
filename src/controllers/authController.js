const bcrypt = require("bcryptjs");
const { query } = require("../config/db");
const { generateToken } = require("../middleware/auth");

// ── OTP sender ────────────────────────────────────────────────────
const sendOTP = async (phone) => {
  const otp = process.env.OTP_DEV_MODE === "true"
    ? "123456"
    : String(Math.floor(100000 + Math.random() * 900000));

  const otpHash   = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await query("DELETE FROM otps WHERE phone = $1", [phone]);
  await query(
    "INSERT INTO otps (phone, otp_hash, expires_at) VALUES ($1, $2, $3)",
    [phone, otpHash, expiresAt]
  );

  if (process.env.OTP_DEV_MODE !== "true" && process.env.FAST2SMS_API_KEY) {
    try {
      await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ route: "otp", variables_values: otp, numbers: phone }),
      });
    } catch (err) {
      console.error("SMS send failed:", err.message);
    }
  } else {
    console.log(`\n  📱 OTP for ${phone}: ${otp}  (dev mode)\n`);
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/send-otp    body: { phone }
// ─────────────────────────────────────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const cleanPhone = req.body.phone.replace(/^\+91/, "").replace(/\s/g, "");
    if (!/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
    }

    await sendOTP(cleanPhone);
    const existing = await query("SELECT id FROM users WHERE phone = $1", [cleanPhone]);

    res.json({
      success: true,
      message: process.env.OTP_DEV_MODE === "true"
        ? "OTP sent (dev mode — use 123456)"
        : "OTP sent to your number",
      is_new_user: existing.rows.length === 0,
    });
  } catch (err) {
    console.error("sendOtp:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp   body: { phone, otp, name? }
// ─────────────────────────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { otp, name } = req.body;
    const cleanPhone = req.body.phone.replace(/^\+91/, "").replace(/\s/g, "");

    // Fetch OTP record
    const otpResult = await query(
      "SELECT * FROM otps WHERE phone = $1 AND used = FALSE ORDER BY created_at DESC LIMIT 1",
      [cleanPhone]
    );
    if (otpResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: "No OTP found. Please request a new one." });
    }
    const otpRecord = otpResult.rows[0];

    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ success: false, message: "OTP has expired. Request a new one." });
    }
    if (otpRecord.attempts >= 3) {
      return res.status(400).json({ success: false, message: "Too many wrong attempts. Request a new OTP." });
    }

    const isValid = await bcrypt.compare(otp, otpRecord.otp_hash);
    if (!isValid) {
      await query("UPDATE otps SET attempts = attempts + 1 WHERE id = $1", [otpRecord.id]);
      const remaining = 3 - (otpRecord.attempts + 1);
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${remaining} attempt(s) remaining.`,
      });
    }

    // Mark OTP used
    await query("UPDATE otps SET used = TRUE WHERE id = $1", [otpRecord.id]);

    // Get or create user
    const existing = await query("SELECT * FROM users WHERE phone = $1", [cleanPhone]);
    let user;
    let isNew = false;

    if (existing.rows.length > 0) {
      user = existing.rows[0];
      await query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [user.id]);
    } else {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Please provide your name to complete registration.",
          requires_name: true,
        });
      }
      const initials = name.trim().split(" ").map(w => w[0].toUpperCase()).slice(0, 2).join("");
      const created  = await query(
        `INSERT INTO users (name, phone, avatar_initials, is_verified, last_active_at)
         VALUES ($1,$2,$3,TRUE,NOW()) RETURNING *`,
        [name.trim(), cleanPhone, initials]
      );
      user  = created.rows[0];
      isNew = true;

      // Welcome notification
      await query(
        `INSERT INTO notifications (user_id, type, title, body)
         VALUES ($1,'welcome','Welcome to Swappy! 🎉',
                 'Start by listing your first item and browse swaps near you.')`,
        [user.id]
      );
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      message: isNew ? "Account created! Welcome to Swappy 🎉" : "Logged in successfully",
      token,
      user: {
        id:           user.id,
        name:         user.name,
        phone:        user.phone,
        city:         user.city,
        location:     user.location,
        avatar:       user.avatar_initials,
        rating:       user.rating,
        is_verified:  user.is_verified,
        total_swaps:  user.total_swaps,
        review_count: user.review_count,
      },
    });
  } catch (err) {
    console.error("verifyOtp:", err);
    res.status(500).json({ success: false, message: "Verification failed." });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/auth/me   (protected)
// ─────────────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, phone, email, city, location, bio,
              avatar_initials, is_verified, is_id_verified,
              rating, review_count, total_swaps, saved_amount, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not fetch profile." });
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/auth/profile   (protected)
// ─────────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, city, location, bio } = req.body;
    const result = await query(
      `UPDATE users
       SET name     = COALESCE($1, name),
           email    = COALESCE($2, email),
           city     = COALESCE($3, city),
           location = COALESCE($4, location),
           bio      = COALESCE($5, bio)
       WHERE id = $6
       RETURNING id, name, email, city, location, bio, avatar_initials`,
      [name, email, city, location, bio, req.user.id]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("updateProfile:", err);
    res.status(500).json({ success: false, message: "Failed to update profile." });
  }
};

// POST /api/auth/logout
exports.logout = async (req, res) => {
  res.json({ success: true, message: "Logged out successfully." });
};
