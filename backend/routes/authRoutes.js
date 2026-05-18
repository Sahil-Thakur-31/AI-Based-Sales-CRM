const express = require('express')
const router = express.Router();

const {loginValidation} = require('../middlewares/authValidations')
const {
    login,
    getLoginStatus,
    sendOTP,
    verifyOTP,
    resetPassword} = require('../controllers/authControllers')

router.post('/login',loginValidation,login);
router.post('/login-status', getLoginStatus);

router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);

router.post("/reset-password", resetPassword);

module.exports = router;
