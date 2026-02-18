const express = require('express');
const router = express.Router();

const Role = require('../models/roles'); // ✅ REQUIRED
const Auth = require('../middlewares/auth');

router.get("/", Auth, async (req, res) => {
  try {
    const roles = await Role.find();
    res.json(roles);
  } catch (err) {
    console.error("Role fetch error:", err);
    res.status(500).json({ msg: "Failed to fetch roles" });
  }
});

module.exports = router;
