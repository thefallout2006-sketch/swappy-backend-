const { query, getClient } = require("../config/db");

// ─────────────────────────────────────────────────────────────────
// Triangle Swap Matching Algorithm
//
// From the Swappy deck:
//   User A wants item from User B
//   User B wants item from User C
//   User C wants item from User A
//
// This runs against the `interests` table which is populated whenever
// a user "swipes right" (expressInterest) on an item. The algorithm:
//   1. Find items owned by users who expressed interest in something
//   2. Detect 3-way demand loops (A→B→C→A)
//   3. Check that all 3 items are in the same value band
//   4. Create a triangle_swap record and notify all 3 users
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// GET /api/triangle/matches   (protected)
// Returns triangle swap opportunities for the current user
// ─────────────────────────────────────────────────────────────────
exports.getMatches = async (req, res) => {
  try {
    const userId = req.user.id;

    // Step 1: Find all items the current user is interested in
    // that belong to users (B) who are in turn interested in
    // something owned by a user (C) who wants something from us (A).
    //
    // SQL pattern:
    //   A (me) → interested in item owned by B
    //   B       → interested in item owned by C
    //   C       → interested in item owned by A (me)
    const matches = await query(
      `SELECT
         -- Item A gives to B
         i_a.id AS item_a_id, i_a.title AS item_a_title, i_a.band AS item_a_band, i_a.emoji AS item_a_emoji,
         -- User B and their item
         u_b.id AS user_b_id, u_b.name AS user_b_name, u_b.avatar_initials AS user_b_avatar,
         i_b.id AS item_b_id, i_b.title AS item_b_title, i_b.band AS item_b_band, i_b.emoji AS item_b_emoji,
         -- User C and their item
         u_c.id AS user_c_id, u_c.name AS user_c_name, u_c.avatar_initials AS user_c_avatar,
         i_c.id AS item_c_id, i_c.title AS item_c_title, i_c.band AS item_c_band, i_c.emoji AS item_c_emoji
       FROM interests int_a          -- A wants something from B
       JOIN items     i_b  ON int_a.item_id = i_b.id AND i_b.status = 'active'
       JOIN users     u_b  ON i_b.user_id   = u_b.id
       JOIN interests int_b ON int_b.user_id = u_b.id   -- B wants something from C
       JOIN items     i_c  ON int_b.item_id  = i_c.id AND i_c.status = 'active'
       JOIN users     u_c  ON i_c.user_id    = u_c.id
       JOIN interests int_c ON int_c.user_id  = u_c.id  -- C wants something from A
       JOIN items     i_a  ON int_c.item_id   = i_a.id
                          AND i_a.user_id     = $1
                          AND i_a.status      = 'active'
       WHERE int_a.user_id = $1
         AND u_b.id != $1
         AND u_c.id != $1
         AND u_b.id != u_c.id
         -- Same or adjacent band (flexible matching)
         AND (i_a.band = i_b.band OR i_b.band = i_c.band OR i_a.band = i_c.band)
         -- No existing triangle swap already pending for these items
         AND NOT EXISTS (
           SELECT 1 FROM triangle_swaps ts
           WHERE ts.status IN ('pending','all_confirmed')
             AND (ts.item_from_a = i_a.id OR ts.item_from_b = i_b.id OR ts.item_from_c = i_c.id)
         )
       LIMIT 10`,
      [userId]
    );

    res.json({ success: true, matches: matches.rows });
  } catch (err) {
    console.error("triangleGetMatches:", err);
    res.status(500).json({ success: false, message: "Failed to find triangle matches." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/triangle/create   (protected)
// body: { item_a_id, item_b_id, item_c_id, user_b_id, user_c_id }
// The calling user is always "User A" (initiator)
// ─────────────────────────────────────────────────────────────────
exports.createTriangle = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { item_a_id, item_b_id, item_c_id, user_b_id, user_c_id } = req.body;
    const userAId = req.user.id;

    // Validate all 3 items are active
    const items = await client.query(
      "SELECT id, user_id, status, title, band FROM items WHERE id = ANY($1)",
      [[item_a_id, item_b_id, item_c_id]]
    );
    if (items.rows.length !== 3) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "One or more items not found." });
    }
    const itemMap = Object.fromEntries(items.rows.map(i => [i.id, i]));

    if (itemMap[item_a_id]?.user_id !== userAId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "item_a must belong to you." });
    }
    if (itemMap[item_b_id]?.user_id !== user_b_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "item_b does not belong to user_b." });
    }
    if (itemMap[item_c_id]?.user_id !== user_c_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "item_c does not belong to user_c." });
    }

    for (const item of items.rows) {
      if (item.status !== "active") {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: `"${item.title}" is no longer available.` });
      }
    }

    // Create the triangle swap (A already confirmed by initiating)
    const ts = await client.query(
      `INSERT INTO triangle_swaps
         (user_a_id, user_b_id, user_c_id,
          item_from_a, item_from_b, item_from_c,
          status, confirmed_a)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',TRUE)
       RETURNING id`,
      [userAId, user_b_id, user_c_id, item_a_id, item_b_id, item_c_id]
    );
    const tsId = ts.rows[0].id;

    // Lock all 3 items
    await client.query(
      "UPDATE items SET status='locked' WHERE id = ANY($1)",
      [[item_a_id, item_b_id, item_c_id]]
    );

    // Notify B and C
    const notifData = JSON.stringify({ triangle_swap_id: tsId });
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES
         ($1,'triangle_invite','Triangle Swap Invite! 🔺',$2,$3),
         ($4,'triangle_invite','Triangle Swap Invite! 🔺',$5,$3)`,
      [
        user_b_id,
        `${req.user.name} has initiated a 3-way swap. You'd give "${itemMap[item_b_id].title}" and receive "${itemMap[item_c_id].title}".`,
        notifData,
        user_c_id,
        `${req.user.name} has initiated a 3-way swap. You'd give "${itemMap[item_c_id].title}" and receive "${itemMap[item_a_id].title}".`,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "Triangle swap created! Waiting for B and C to confirm.",
      triangle_swap_id: tsId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createTriangle:", err);
    res.status(500).json({ success: false, message: "Failed to create triangle swap." });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/triangle/:id/confirm   (protected)
// Each of the 3 users must hit this endpoint to confirm their leg
// ─────────────────────────────────────────────────────────────────
exports.confirmTriangle = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { id: tsId } = req.params;
    const userId       = req.user.id;

    const tsRes = await client.query(
      "SELECT * FROM triangle_swaps WHERE id = $1", [tsId]
    );
    if (!tsRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Triangle swap not found." });
    }
    const ts = tsRes.rows[0];

    if (ts.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: `Triangle swap is already ${ts.status}.` });
    }

    // Determine which user is confirming
    let confirmField;
    if      (ts.user_a_id === userId) confirmField = "confirmed_a";
    else if (ts.user_b_id === userId) confirmField = "confirmed_b";
    else if (ts.user_c_id === userId) confirmField = "confirmed_c";
    else {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "You are not part of this triangle swap." });
    }

    await client.query(
      `UPDATE triangle_swaps SET ${confirmField} = TRUE WHERE id = $1`, [tsId]
    );

    // Re-fetch to check if all 3 have confirmed
    const updated = await client.query(
      "SELECT confirmed_a, confirmed_b, confirmed_c FROM triangle_swaps WHERE id = $1", [tsId]
    );
    const { confirmed_a, confirmed_b, confirmed_c } = updated.rows[0];

    if (confirmed_a && confirmed_b && confirmed_c) {
      // All confirmed — complete the swap
      await client.query(
        "UPDATE triangle_swaps SET status='completed' WHERE id=$1", [tsId]
      );
      await client.query(
        "UPDATE items SET status='swapped' WHERE id = ANY($1)",
        [[ts.item_from_a, ts.item_from_b, ts.item_from_c]]
      );
      // Increment swap counts for all 3
      await client.query(
        "UPDATE users SET total_swaps = total_swaps + 1 WHERE id = ANY($1)",
        [[ts.user_a_id, ts.user_b_id, ts.user_c_id]]
      );

      // Notify all 3
      const notifData = JSON.stringify({ triangle_swap_id: tsId });
      for (const uid of [ts.user_a_id, ts.user_b_id, ts.user_c_id]) {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1,'triangle_completed','Triangle Swap Completed! 🎉',
                   'All 3 parties confirmed. Coordinate pickups/delivery now.', $2)`,
          [uid, notifData]
        );
      }

      await client.query("COMMIT");
      return res.json({
        success: true,
        message: "All 3 confirmed! Triangle swap is complete. 🎉",
        all_confirmed: true,
      });
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: "Your confirmation recorded. Waiting for the others.",
      all_confirmed: false,
      confirmed: { a: confirmed_a, b: ts.user_b_id === userId ? true : confirmed_b, c: ts.user_c_id === userId ? true : confirmed_c },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("confirmTriangle:", err);
    res.status(500).json({ success: false, message: "Failed to confirm triangle swap." });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/triangle/my   (protected)
// All triangle swaps involving the current user
// ─────────────────────────────────────────────────────────────────
exports.getMyTriangles = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT
         ts.*,
         u_a.name AS user_a_name, u_a.avatar_initials AS user_a_avatar,
         u_b.name AS user_b_name, u_b.avatar_initials AS user_b_avatar,
         u_c.name AS user_c_name, u_c.avatar_initials AS user_c_avatar,
         i_a.title AS item_a_title, i_a.emoji AS item_a_emoji, i_a.band AS item_a_band,
         i_b.title AS item_b_title, i_b.emoji AS item_b_emoji, i_b.band AS item_b_band,
         i_c.title AS item_c_title, i_c.emoji AS item_c_emoji, i_c.band AS item_c_band
       FROM triangle_swaps ts
       JOIN users u_a ON ts.user_a_id   = u_a.id
       JOIN users u_b ON ts.user_b_id   = u_b.id
       JOIN users u_c ON ts.user_c_id   = u_c.id
       JOIN items i_a ON ts.item_from_a = i_a.id
       JOIN items i_b ON ts.item_from_b = i_b.id
       JOIN items i_c ON ts.item_from_c = i_c.id
       WHERE $1 IN (ts.user_a_id, ts.user_b_id, ts.user_c_id)
       ORDER BY ts.created_at DESC`,
      [userId]
    );
    res.json({ success: true, triangles: result.rows });
  } catch (err) {
    console.error("getMyTriangles:", err);
    res.status(500).json({ success: false, message: "Failed to fetch triangle swaps." });
  }
};
