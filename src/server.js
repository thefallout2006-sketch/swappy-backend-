require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const path        = require("path");

require("./config/db");

const authRoutes     = require("./routes/auth");
const itemRoutes     = require("./routes/items");
const swapRoutes     = require("./routes/swaps");
const triangleRoutes = require("./routes/triangle");
const { userRouter, notifRouter } = require("./routes/users");

const { errorHandler, notFound } = require("./middleware/errorHandler");

const app  = express();
const PORT = process.env.PORT || 5000;

// CRITICAL — must be first line before any middleware
app.set("trust proxy", 1);

// Security
app.use(helmet());

// CORS — allow all origins for now
app.use(cors({
  origin: "*",
  credentials: false,
  methods: ["GET","POST","PATCH","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

// Body parsing
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Logging
app.use(morgan("dev"));

// Static uploads
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Swappy API",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/api/auth",         authRoutes);
app.use("/api/items",        itemRoutes);
app.use("/api/swaps",        swapRoutes);
app.use("/api/triangle",     triangleRoutes);
app.use("/api/users",        userRouter);
app.use("/api/notifications",notifRouter);

// 404 and error handlers
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 Swappy API running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV}`);
  console.log(`   OTP mode    : ${process.env.OTP_DEV_MODE === "true" ? "DEV (123456)" : "PRODUCTION"}\n`);
});

module.exports = app;
