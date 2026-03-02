const router = require("express").Router();
const { getLocations, getLocationByPincode } = require("../controllers/locationController");

router.get("/", getLocations);
router.get("/pincode/:pincode", getLocationByPincode);

module.exports = router;
