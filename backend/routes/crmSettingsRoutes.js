const express = require("express");

const router = express.Router();

const authenticate = require("../middlewares/auth");

const {
  getMySettings,
  updateMySettings
} = require("../controllers/crmSettingsController");



/*
GET SETTINGS
*/
router.get(
  "/me",
  authenticate,
  getMySettings
);



/*
UPDATE SETTINGS
*/
router.put(
  "/me",
  authenticate,
  updateMySettings
);



module.exports = router;