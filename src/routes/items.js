const express       = require("express");
const { body }      = require("express-validator");
const ctrl          = require("../controllers/itemController");
const { protect, optionalAuth } = require("../middleware/auth");
const { validate }  = require("../middleware/errorHandler");

const router = express.Router();

// Public / optional-auth
router.get("/",      optionalAuth, ctrl.getItems);
router.get("/my",    protect,      ctrl.getMyItems);
router.get("/saved", protect,      ctrl.getSavedItems);
router.get("/:id",   optionalAuth, ctrl.getItemById);

// Protected
router.post("/",
  protect,
  body("title").notEmpty().withMessage("Title is required"),
  body("category").notEmpty().withMessage("Category is required"),
  body("condition").isIn(["Like New","Excellent","Good","Fair"]).withMessage("Invalid condition"),
  body("original_price").isInt({ min: 1 }).withMessage("Price must be a positive number"),
  body("wants").notEmpty().withMessage("Please specify what you want in exchange"),
  validate,
  ctrl.createItem
);

router.patch("/:id",          protect, ctrl.updateItem);
router.delete("/:id",         protect, ctrl.deleteItem);
router.post("/:id/save",      protect, ctrl.toggleSave);
router.post("/:id/interest",  protect, ctrl.expressInterest);

module.exports = router;
