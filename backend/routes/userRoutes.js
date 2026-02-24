const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const upload = require("../config/multer");
const { getProfile, 
    updateProfile, 
    getAllUsers ,
    updateUser,
    getSingleUser,
    softDeleteUser,
    activateUser,
    createUser } = require("../controllers/userController");


/* UPDATE PROFILE */
router.put("/me", authenticate, upload.single("photo"), updateProfile );

router.get("/", authenticate, getAllUsers);
/* GET PROFILE */
router.get("/me", authenticate, getProfile);
router.put("/:id", authenticate, updateUser);
router.get("/:id", authenticate, getSingleUser);
router.put("/delete/:id", authenticate, softDeleteUser);
router.put("/activate/:id", authenticate, activateUser);
router.post('/', authenticate, createUser);



module.exports = router;