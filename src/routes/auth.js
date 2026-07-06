// ================================================================
// routes/auth.js
// ================================================================
const express  = require("express");
const { body } = require("express-validator");
const ctrl     = require("../controllers/authController");
const { protect }   = require("../middleware/auth");
const { validate }  = require("../middleware/errorHandler");

const router = express.Router();

router.post("/send-otp",
  body("phone").notEmpty().withMessage("Phone is required"),
  validate,
  ctrl.sendOtp
);

router.post("/verify-otp",
  body("phone").notEmpty().withMessage("Phone is required"),
  body("otp").isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits"),
  validate,
  ctrl.verifyOtp
);

router.get("/me", protect, ctrl.getMe);
router.patch("/profile", protect, ctrl.updateProfile);
router.post("/logout", protect, ctrl.logout);

module.exports = router;
