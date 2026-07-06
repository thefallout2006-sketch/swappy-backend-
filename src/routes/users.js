const express      = require("express");
const userCtrl     = require("../controllers/userController");
const notifCtrl    = require("../controllers/notificationController");
const { protect }  = require("../middleware/auth");

// ── User routes ────────────────────────────────────────────────
const userRouter = express.Router();
userRouter.get("/:id",      userCtrl.getUserProfile);
userRouter.post("/report",  protect, userCtrl.reportUser);

// ── Notification routes ────────────────────────────────────────
const notifRouter = express.Router();
notifRouter.get("/",              protect, notifCtrl.getNotifications);
notifRouter.patch("/read-all",    protect, notifCtrl.markAllRead);
notifRouter.patch("/:id/read",    protect, notifCtrl.markOneRead);

module.exports = { userRouter, notifRouter };
