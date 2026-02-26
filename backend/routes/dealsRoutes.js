const router = require("express").Router();
const { getDeals } = require("../controllers/dealsController");

router.get("/", getDeals);

module.exports = router;

