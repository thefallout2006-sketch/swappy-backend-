const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token. Please log in." });
    }

    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
      }
      return res.status(401).json({ success: false, message: "Invalid token." });
    }

    const result = await query(
      "SELECT id, name, phone, city, is_verified, is_active FROM users WHERE id = $1",
      [decoded.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }
    if (!result.rows[0].is_active) {
      return res.status(403).json({ success: false, message: "Account suspended." });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).json({ success: false, message: "Authentication error." });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query("SELECT id, name, phone, city FROM users WHERE id = $1", [decoded.id]);
    req.user = result.rows[0] || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });

module.exports = { protect, optionalAuth, generateToken };
