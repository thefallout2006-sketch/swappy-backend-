const { query } = require("../config/db");

// GET /api/notifications   (protected)
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const result = await query(
      `SELECT id, type, title, body, data, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), offset]
    );

    const unread = await query(
      "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE",
      [req.user.id]
    );

    res.json({
      success: true,
      notifications: result.rows,
      unread_count: parseInt(unread.rows[0].count),
    });
  } catch (err) {
    console.error("getNotifications:", err);
    res.status(500).json({ success: false, message: "Failed to fetch notifications." });
  }
};

// PATCH /api/notifications/read-all   (protected)
exports.markAllRead = async (req, res) => {
  try {
    await query(
      "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
      [req.user.id]
    );
    res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update notifications." });
  }
};

// PATCH /api/notifications/:id/read   (protected)
exports.markOneRead = async (req, res) => {
  try {
    await query(
      "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to mark notification." });
  }
};
