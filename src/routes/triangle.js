const express      = require("express");
const { body }     = require("express-validator");
const ctrl         = require("../controllers/triangleController");
const { protect }  = require("../middleware/auth");
const { validate } = require("../middleware/errorHandler");

const router = express.Router();

router.get("/matches", protect, ctrl.getMatches);
router.get("/my",      protect, ctrl.getMyTriangles);

router.post("/",
  protect,
  body("item_a_id").notEmpty().withMessage("item_a_id required"),
  body("item_b_id").notEmpty().withMessage("item_b_id required"),
  body("item_c_id").notEmpty().withMessage("item_c_id required"),
  body("user_b_id").notEmpty().withMessage("user_b_id required"),
  body("user_c_id").notEmpty().withMessage("user_c_id required"),
  validate,
  ctrl.createTriangle
);

router.patch("/:id/confirm", protect, ctrl.confirmTriangle);

module.exports = router;
