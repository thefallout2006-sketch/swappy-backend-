const { query } = require("../config/db");

// GET /api/users/:id   — Public profile
exports.getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, name, city, location, bio, avatar_initials,
              is_verified, rating, review_count, total_swaps, created_at
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Their active listings
    const items = await query(
      `SELECT id, title, band, emoji, category, condition, status, city, created_at
       FROM items WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 6`,
      [id]
    );

    // Their recent ratings
    const ratings = await query(
      `SELECT r.score, r.comment, r.created_at,
              u.name AS rater_name, u.avatar_initials AS rater_avatar
       FROM ratings r
       JOIN users u ON r.rater_id = u.id
       WHERE r.ratee_id = $1
       ORDER BY r.created_at DESC LIMIT 10`,
      [id]
    );

    res.json({
      success: true,
      user:    result.rows[0],
      items:   items.rows,
      ratings: ratings.rows,
    });
  } catch (err) {
    console.error("getUserProfile:", err);
    res.status(500).json({ success: false, message: "Failed to fetch profile." });
  }
};

// POST /api/users/report   (protected)
exports.reportUser = async (req, res) => {
  try {
    const { reported_id, reason, description, swap_id, item_id } = req.body;
    if (!reported_id || !reason) {
      return res.status(400).json({ success: false, message: "reported_id and reason are required." });
    }
    await query(
      `INSERT INTO reports (reporter_id, reported_id, reason, description, swap_id, item_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, reported_id, reason, description, swap_id || null, item_id || null]
    );
    res.status(201).json({ success: true, message: "Report submitted. Our team will review it." });
  } catch (err) {
    console.error("reportUser:", err);
    res.status(500).json({ success: false, message: "Failed to submit report." });
  }
};
