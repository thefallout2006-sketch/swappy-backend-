const { query, getClient } = require("../config/db");

// ─────────────────────────────────────────────────────────────────
// GET /api/swaps   (protected)
// ─────────────────────────────────────────────────────────────────
exports.getMySwaps = async (req, res) => {
  try {
    const { status } = req.query;
    const userId = req.user.id;
    const params = [userId];

    let statusFilter = "";
    if (status) {
      params.push(status);
      statusFilter = `AND s.status = $${params.length}`;
    }

    const result = await query(
      `SELECT
         s.id, s.type, s.status, s.note, s.delivery_type,
         s.delivery_cost, s.accepted_at, s.completed_at, s.created_at,
         u_init.id   AS initiator_id,   u_init.name AS initiator_name,
         u_init.avatar_initials         AS initiator_avatar,
         u_init.rating                  AS initiator_rating,
         u_recv.id   AS receiver_id,    u_recv.name AS receiver_name,
         u_recv.avatar_initials         AS receiver_avatar,
         u_recv.rating                  AS receiver_rating,
         CASE WHEN s.initiator_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction
       FROM swaps s
       JOIN users u_init ON s.initiator_id = u_init.id
       JOIN users u_recv ON s.receiver_id  = u_recv.id
       WHERE (s.initiator_id = $1 OR s.receiver_id = $1) ${statusFilter}
       ORDER BY s.created_at DESC`,
      params
    );

    // Attach items to each swap
    const swapsWithItems = await Promise.all(
      result.rows.map(async (swap) => {
        const items = await query(
          `SELECT si.role, i.id, i.title, i.emoji, i.band, i.condition,
                  u.name AS owner_name, u.id AS owner_id
           FROM swap_items si
           JOIN items i ON si.item_id = i.id
           JOIN users u ON i.user_id  = u.id
           WHERE si.swap_id = $1`,
          [swap.id]
        );
        return { ...swap, items: items.rows };
      })
    );

    res.json({ success: true, swaps: swapsWithItems });
  } catch (err) {
    console.error("getMySwaps:", err);
    res.status(500).json({ success: false, message: "Failed to fetch swaps." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/swaps   (protected)
// body: { offered_item_ids[], requested_item_id, note?, delivery_type? }
// ─────────────────────────────────────────────────────────────────
exports.createSwap = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { offered_item_ids, requested_item_id, note = "", delivery_type = "meetup" } = req.body;
    const initiatorId = req.user.id;

    if (!offered_item_ids?.length || !requested_item_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Provide item(s) to offer and one item to request." });
    }

    // Validate requested item
    const reqItem = await client.query(
      "SELECT id, user_id, status, title FROM items WHERE id = $1",
      [requested_item_id]
    );
    if (!reqItem.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Requested item not found." });
    }
    const target = reqItem.rows[0];
    if (target.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "That item is no longer available." });
    }
    if (target.user_id === initiatorId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "You cannot swap with your own item." });
    }

    // Validate offered items
    for (const itemId of offered_item_ids) {
      const off = await client.query("SELECT user_id, status FROM items WHERE id = $1", [itemId]);
      if (!off.rows.length || off.rows[0].user_id !== initiatorId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: `Item ${itemId} is not yours.` });
      }
      if (off.rows[0].status !== "active") {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "One of your items is not available." });
      }
    }

    // Duplicate check
    const dup = await client.query(
      `SELECT s.id FROM swaps s
       JOIN swap_items si ON si.swap_id = s.id
       WHERE s.initiator_id = $1 AND si.item_id = $2 AND si.role = 'request' AND s.status = 'pending'`,
      [initiatorId, requested_item_id]
    );
    if (dup.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "You already have a pending request for this item." });
    }

    // Create swap
    const swapType = offered_item_ids.length > 1 ? "multi" : "direct";
    const swapRes  = await client.query(
      `INSERT INTO swaps (type, status, initiator_id, receiver_id, note, delivery_type)
       VALUES ($1,'pending',$2,$3,$4,$5) RETURNING id`,
      [swapType, initiatorId, target.user_id, note, delivery_type]
    );
    const swapId = swapRes.rows[0].id;

    // Insert swap items
    for (const itemId of offered_item_ids) {
      await client.query(
        "INSERT INTO swap_items (swap_id, item_id, user_id, role) VALUES ($1,$2,$3,'offer')",
        [swapId, itemId, initiatorId]
      );
    }
    await client.query(
      "INSERT INTO swap_items (swap_id, item_id, user_id, role) VALUES ($1,$2,$3,'request')",
      [swapId, requested_item_id, target.user_id]
    );

    // Lock all items
    const allIds = [...offered_item_ids, requested_item_id];
    await client.query("UPDATE items SET status = 'locked' WHERE id = ANY($1)", [allIds]);

    // Increment offer count on requested item
    await client.query(
      "UPDATE items SET offer_count = offer_count + 1 WHERE id = $1",
      [requested_item_id]
    );

    // Notify receiver
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1,'swap_offer','New Swap Request! 🔄',$2,$3)`,
      [
        target.user_id,
        `${req.user.name} wants to swap for your "${target.title}"`,
        JSON.stringify({ swap_id: swapId }),
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "Swap request sent! Items are now locked.",
      swap_id: swapId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createSwap:", err);
    res.status(500).json({ success: false, message: "Failed to create swap." });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/swaps/:id/respond   body: { action: "accept"|"decline" }
// ─────────────────────────────────────────────────────────────────
exports.respondToSwap = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { id: swapId } = req.params;
    const { action }     = req.body;
    const userId         = req.user.id;

    if (!["accept", "decline"].includes(action)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Action must be 'accept' or 'decline'." });
    }

    const swapRes = await client.query("SELECT * FROM swaps WHERE id = $1", [swapId]);
    if (!swapRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Swap not found." });
    }
    const swap = swapRes.rows[0];

    if (swap.receiver_id !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Only the receiver can respond." });
    }
    if (swap.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: `Swap is already ${swap.status}.` });
    }

    const itemsRes = await client.query(
      "SELECT item_id FROM swap_items WHERE swap_id = $1", [swapId]
    );
    const itemIds = itemsRes.rows.map(r => r.item_id);

    if (action === "accept") {
      await client.query(
        "UPDATE swaps SET status='completed', accepted_at=NOW(), completed_at=NOW() WHERE id=$1",
        [swapId]
      );
      await client.query("UPDATE items SET status='swapped' WHERE id = ANY($1)", [itemIds]);
      await client.query(
        "UPDATE users SET total_swaps = total_swaps + 1 WHERE id IN ($1,$2)",
        [swap.initiator_id, swap.receiver_id]
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1,'swap_accepted','Swap Accepted! 🎉',$2,$3)`,
        [
          swap.initiator_id,
          `${req.user.name} accepted your swap! Coordinate the exchange now.`,
          JSON.stringify({ swap_id: swapId }),
        ]
      );
    } else {
      await client.query("UPDATE swaps SET status='declined' WHERE id=$1", [swapId]);
      await client.query("UPDATE items SET status='active' WHERE id = ANY($1)", [itemIds]);
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1,'swap_declined','Swap Declined',$2,$3)`,
        [
          swap.initiator_id,
          `${req.user.name} declined your swap. Your items are unlocked.`,
          JSON.stringify({ swap_id: swapId }),
        ]
      );
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: action === "accept"
        ? "Swap accepted! 🎉 Coordinate the exchange."
        : "Swap declined. Items unlocked.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("respondToSwap:", err);
    res.status(500).json({ success: false, message: "Failed to respond to swap." });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/swaps/:id/cancel   (initiator only)
// ─────────────────────────────────────────────────────────────────
exports.cancelSwap = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { id: swapId } = req.params;
    const userId         = req.user.id;

    const swapRes = await client.query("SELECT * FROM swaps WHERE id = $1", [swapId]);
    if (!swapRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Swap not found." });
    }
    const swap = swapRes.rows[0];
    if (swap.initiator_id !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Only the initiator can cancel." });
    }
    if (swap.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Can only cancel pending swaps." });
    }

    await client.query("UPDATE swaps SET status='cancelled' WHERE id=$1", [swapId]);

    const itemsRes = await client.query("SELECT item_id FROM swap_items WHERE swap_id=$1", [swapId]);
    const itemIds  = itemsRes.rows.map(r => r.item_id);
    await client.query("UPDATE items SET status='active' WHERE id = ANY($1)", [itemIds]);

    await client.query("COMMIT");
    res.json({ success: true, message: "Swap cancelled. Items unlocked." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("cancelSwap:", err);
    res.status(500).json({ success: false, message: "Failed to cancel swap." });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/swaps/:id/rate   body: { score: 1-5, comment? }
// ─────────────────────────────────────────────────────────────────
exports.rateSwap = async (req, res) => {
  try {
    const { id: swapId } = req.params;
    const { score, comment = "" } = req.body;
    const raterId = req.user.id;

    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ success: false, message: "Score must be 1–5." });
    }

    const swapRes = await query(
      "SELECT * FROM swaps WHERE id=$1 AND status='completed'", [swapId]
    );
    if (!swapRes.rows.length) {
      return res.status(404).json({ success: false, message: "Completed swap not found." });
    }

    const swap  = swapRes.rows[0];
    const rateeId = swap.initiator_id === raterId
      ? swap.receiver_id
      : swap.initiator_id;

    await query(
      "INSERT INTO ratings (swap_id, rater_id, ratee_id, score, comment) VALUES ($1,$2,$3,$4,$5)",
      [swapId, raterId, rateeId, score, comment]
    );

    res.json({ success: true, message: "Rating submitted! Thank you." });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "You already rated this swap." });
    }
    console.error("rateSwap:", err);
    res.status(500).json({ success: false, message: "Failed to submit rating." });
  }
};
