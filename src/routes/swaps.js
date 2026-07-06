const express      = require("express");
const { body }     = require("express-validator");
const ctrl         = require("../controllers/swapController");
const { protect }  = require("../middleware/auth");
const { validate } = require("../middleware/errorHandler");

const router = express.Router();

router.get("/",    protect, ctrl.getMySwaps);

router.post("/",
  protect,
  body("offered_item_ids").isArray({ min: 1 }).withMessage("At least one item to offer is required"),
  body("requested_item_id").notEmpty().withMessage("Specify the item you want"),
  validate,
  ctrl.createSwap
);

router.patch("/:id/respond",
  protect,
  body("action").isIn(["accept","decline"]).withMessage("Action must be accept or decline"),
  validate,
  ctrl.respondToSwap
);

router.patch("/:id/cancel",  protect, ctrl.cancelSwap);

router.post("/:id/rate",
  protect,
  body("score").isInt({ min: 1, max: 5 }).withMessage("Score must be 1–5"),
  validate,
  ctrl.rateSwap
);

module.exports = router;
