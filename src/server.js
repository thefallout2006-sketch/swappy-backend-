require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const rateLimit   = require("express-rate-limit");
const path        = require("path");

// Import DB (runs connection test on require)
require("./config/db");

// Routes
const authRoutes     = require("./routes/auth");
const itemRoutes     = require("./routes/items");
const swapRoutes     = require("./routes/swaps");
const triangleRoutes = require("./routes/triangle");
const { userRouter, notifRouter } = require("./routes/users");

// Middleware
const { errorHandler, notFound } = require("./middleware/errorHandler");

const app  = express();
const PORT = process.env.PORT || 5000;
// Required for Railway/Vercel/any proxy — fixes rate limiter
app.set('trust proxy', 1);
// ── Security headers ──────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || "http://localhost:5173",
    "http://localhost:3000",   // in case React is on 3000
  ],
  credentials: true,
  methods: ["GET","POST","PATCH","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

// ── Rate limiting ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again in 15 minutes." },
});
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,                    // max 5 OTP requests per 10 min per IP
  message: { success: false, message: "Too many OTP requests. Please wait 10 minutes." },
});
app.use(globalLimiter);

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ── Logging ──────────────────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ── Static file serving (uploaded images) ────────────────────
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ── Health check ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Swappy API",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use("/api/auth",          otpLimiter,  authRoutes);
app.use("/api/items",                      itemRoutes);
app.use("/api/swaps",                      swapRoutes);
app.use("/api/triangle",                   triangleRoutes);
app.use("/api/users",                      userRouter);
app.use("/api/notifications",              notifRouter);

// ── 404 & Error handlers ─────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Swappy API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV}`);
  console.log(`   OTP mode    : ${process.env.OTP_DEV_MODE === "true" ? "DEV (fixed: 123456)" : "PRODUCTION (SMS)"}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);
});

module.exports = app;
