const express = require('express')
const router = express.Router();

const {loginValidation, registerValidation} = require('../middlewares/authValidations')
const {register,
    login,
    sendOTP,
    verifyOTP,
    resetPassword} = require('../controllers/authControllers')

router.post('/login',loginValidation,login);
router.post('/register',registerValidation,register);

router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);

router.post("/reset-password", resetPassword);

module.exports = router;