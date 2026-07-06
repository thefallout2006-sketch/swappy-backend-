const { query, getClient } = require("../config/db");

const priceToBand = (price) => {
  if (price < 1500)  return "A";
  if (price < 4000)  return "B";
  if (price < 10000) return "C";
  if (price < 25000) return "D";
  return "E";
};

const CATEGORY_EMOJI = {
  Electronics: "📱", Furniture: "🪑", Sports: "⚽",
  Appliances: "🏠", Books: "📚", Clothing: "👕", Other: "📦",
};

// ─────────────────────────────────────────────────────────────────
// GET /api/items
// Query: category, band, condition, city, search, page, limit, sort
// ─────────────────────────────────────────────────────────────────
exports.getItems = async (req, res) => {
  try {
    const { category, band, condition, city, search = "",
            page = 1, limit = 20, sort = "newest" } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = ["i.status = 'active'"];
    const params     = [];

    if (category) { params.push(category);           conditions.push(`i.category = $${params.length}`); }
    if (band)     { params.push(band);               conditions.push(`i.band = $${params.length}`); }
    if (condition){ params.push(condition);           conditions.push(`i.condition = $${params.length}`); }
    if (city)     { params.push(`%${city}%`);        conditions.push(`i.city ILIKE $${params.length}`); }
    if (search)   {
      params.push(`%${search}%`);
      conditions.push(`(i.title ILIKE $${params.length} OR i.wants ILIKE $${params.length} OR i.description ILIKE $${params.length})`);
    }

    // Exclude own items when logged in
    const currentUserId = req.user?.id || null;
    if (currentUserId) {
      params.push(currentUserId);
      conditions.push(`i.user_id != $${params.length}`);
    }

    const where   = conditions.join(" AND ");
    const orderBy = sort === "popular" ? "i.saves DESC, i.views DESC" : "i.created_at DESC";

    // Total count
    const countRes = await query(`SELECT COUNT(*) FROM items i WHERE ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    // Paginated items
    params.push(currentUserId, limitNum, offset);
    const safetyIdx   = params.length;
    const limitIdx    = params.length - 1;
    const offsetIdx   = params.length;

    // Rebuild params cleanly for the main query
    const countParams = params.slice(0, params.length - 3);
    const mainParams  = [...countParams, currentUserId, limitNum, offset];

    const itemsRes = await query(
      `SELECT
         i.id, i.title, i.category, i.condition, i.band,
         i.wants, i.emoji, i.status, i.views, i.saves,
         i.offer_count, i.city, i.created_at,
         u.id AS user_id, u.name AS user_name,
         u.avatar_initials, u.rating AS user_rating,
         u.review_count, u.is_verified, u.location AS user_location,
         CASE WHEN si.id IS NOT NULL THEN true ELSE false END AS is_saved,
         (SELECT url FROM item_images WHERE item_id = i.id AND is_primary = true LIMIT 1) AS primary_image
       FROM items i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN saved_items si ON si.item_id = i.id AND si.user_id = $${countParams.length + 1}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${countParams.length + 2} OFFSET $${countParams.length + 3}`,
      mainParams
    );

    res.json({
      success: true,
      items: itemsRes.rows,
      pagination: {
        page: pageNum, limit: limitNum, total,
        hasMore: offset + itemsRes.rows.length < total,
      },
    });
  } catch (err) {
    console.error("getItems:", err);
    res.status(500).json({ success: false, message: "Failed to fetch items." });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/items/my   (protected)
// ─────────────────────────────────────────────────────────────────
exports.getMyItems = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, title, category, band, condition, emoji,
              status, views, saves, offer_count, created_at
       FROM items
       WHERE user_id = $1 AND status != 'removed'
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, items: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch your items." });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/items/saved   (protected)
// ─────────────────────────────────────────────────────────────────
exports.getSavedItems = async (req, res) => {
  try {
    const result = await query(
      `SELECT i.id, i.title, i.band, i.emoji, i.category,
              i.condition, i.status, i.city, si.created_at AS saved_at,
              u.name AS user_name, u.avatar_initials
       FROM saved_items si
       JOIN items i ON si.item_id = i.id
       JOIN users u ON i.user_id  = u.id
       WHERE si.user_id = $1 AND i.status != 'removed'
       ORDER BY si.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, items: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch saved items." });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/items/:id
// ─────────────────────────────────────────────────────────────────
exports.getItemById = async (req, res) => {
  try {
    const { id } = req.params;
    await query("UPDATE items SET views = views + 1 WHERE id = $1", [id]);

    const result = await query(
      `SELECT i.*,
              u.id AS user_id, u.name AS user_name, u.avatar_initials,
              u.rating AS user_rating, u.review_count, u.is_verified,
              u.location AS user_location, u.city AS user_city, u.total_swaps,
              CASE WHEN si.id IS NOT NULL THEN true ELSE false END AS is_saved
       FROM items i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN saved_items si ON si.item_id = i.id AND si.user_id = $2
       WHERE i.id = $1`,
      [id, req.user?.id || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Item not found." });
    }

    const images = await query(
      "SELECT id, url, type, is_primary FROM item_images WHERE item_id = $1 ORDER BY is_primary DESC",
      [id]
    );

    res.json({ success: true, item: { ...result.rows[0], images: images.rows } });
  } catch (err) {
    console.error("getItemById:", err);
    res.status(500).json({ success: false, message: "Failed to fetch item." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/items   (protected)
// ─────────────────────────────────────────────────────────────────
exports.createItem = async (req, res) => {
  try {
    const { title, category, condition,
            original_price, wants, description = "" } = req.body;

    const price = parseInt(original_price);
    const band  = priceToBand(price);
    const emoji = CATEGORY_EMOJI[category] || "📦";

    const result = await query(
      `INSERT INTO items
         (user_id, title, description, category, condition, band,
          original_price, wants, emoji, status, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_verification',$10)
       RETURNING id, title, band, status, created_at`,
      [req.user.id, title, description, category, condition,
       band, price, wants, emoji, req.user.city || "Bengaluru"]
    );

    const item = result.rows[0];

    // Notify user
    await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1,'listing_created','Item Listed! ✅',
               'Your item is under AI quality review. It will go live within 30 minutes.', $2)`,
      [req.user.id, JSON.stringify({ item_id: item.id })]
    );

    // Dev: auto-approve after 3s (prod: use a real job queue)
    setTimeout(async () => {
      try {
        await query(
          "UPDATE items SET status = 'active', ai_verified = TRUE WHERE id = $1 AND status = 'pending_verification'",
          [item.id]
        );
      } catch (e) { /* ignore */ }
    }, 3000);

    res.status(201).json({ success: true, message: "Item listed! Under AI review.", item });
  } catch (err) {
    console.error("createItem:", err);
    res.status(500).json({ success: false, message: "Failed to create listing." });
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/items/:id   (protected)
// ─────────────────────────────────────────────────────────────────
exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, wants, condition } = req.body;

    const existing = await query("SELECT user_id FROM items WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Item not found." });
    if (existing.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: "Not your item." });

    const result = await query(
      `UPDATE items
       SET title       = COALESCE($1, title),
           description = COALESCE($2, description),
           wants       = COALESCE($3, wants),
           condition   = COALESCE($4, condition)
       WHERE id = $5 RETURNING id, title, status`,
      [title, description, wants, condition, id]
    );

    res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    console.error("updateItem:", err);
    res.status(500).json({ success: false, message: "Failed to update item." });
  }
};

// ─────────────────────────────────────────────────────────────────
// DELETE /api/items/:id   (protected)
// ─────────────────────────────────────────────────────────────────
exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await query("SELECT user_id, status FROM items WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Item not found." });
    if (existing.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: "Not your item." });
    if (existing.rows[0].status === "locked") {
      return res.status(400).json({ success: false, message: "Item is locked. Resolve the pending swap first." });
    }

    await query("UPDATE items SET status = 'removed' WHERE id = $1", [id]);
    res.json({ success: true, message: "Item removed." });
  } catch (err) {
    console.error("deleteItem:", err);
    res.status(500).json({ success: false, message: "Failed to remove item." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/items/:id/save   (protected) — toggle save/unsave
// ─────────────────────────────────────────────────────────────────
exports.toggleSave = async (req, res) => {
  try {
    const { id: itemId } = req.params;
    const userId = req.user.id;

    const existing = await query(
      "SELECT id FROM saved_items WHERE user_id = $1 AND item_id = $2",
      [userId, itemId]
    );

    let saved;
    if (existing.rows.length > 0) {
      await query("DELETE FROM saved_items WHERE user_id = $1 AND item_id = $2", [userId, itemId]);
      await query("UPDATE items SET saves = GREATEST(0, saves - 1) WHERE id = $1", [itemId]);
      saved = false;
    } else {
      await query("INSERT INTO saved_items (user_id, item_id) VALUES ($1,$2)", [userId, itemId]);
      await query("UPDATE items SET saves = saves + 1 WHERE id = $1", [itemId]);
      saved = true;
    }

    res.json({ success: true, saved, message: saved ? "Item saved!" : "Item unsaved." });
  } catch (err) {
    console.error("toggleSave:", err);
    res.status(500).json({ success: false, message: "Failed to toggle save." });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/items/:id/interest   (protected)
// Records a "swipe-right" / "I want this" signal — feeds triangle matching
// ─────────────────────────────────────────────────────────────────
exports.expressInterest = async (req, res) => {
  try {
    const { id: itemId } = req.params;
    const userId = req.user.id;

    // Upsert interest
    await query(
      `INSERT INTO interests (user_id, item_id) VALUES ($1,$2)
       ON CONFLICT (user_id, item_id) DO NOTHING`,
      [userId, itemId]
    );

    res.json({ success: true, message: "Interest recorded." });
  } catch (err) {
    console.error("expressInterest:", err);
    res.status(500).json({ success: false, message: "Failed to record interest." });
  }
};
