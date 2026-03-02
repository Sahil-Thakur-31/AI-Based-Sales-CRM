const express = require("express");
const authenticate = require("../middlewares/auth");
const ctrl = require("../controllers/followupsController");

const router = express.Router();

router.get("/", authenticate, ctrl.list);
router.get("/filter-options", authenticate, ctrl.filterOptions);
router.get("/today/meetings", authenticate, ctrl.listTodayMeetings);
router.get("/:id", authenticate, ctrl.getOne);
router.post("/", authenticate, ctrl.create);
router.put("/:id", authenticate, ctrl.update);
router.patch("/:id/status", authenticate, ctrl.updateStatus);
router.delete("/:id", authenticate, ctrl.remove);

module.exports = router;
