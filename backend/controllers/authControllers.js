const User = require('../models/users');
const Role = require('../models/roles');

const jwt = require('jsonwebtoken');
require('dotenv').config()
const bcrypt = require('bcrypt')

const sendOTPEmail = require("../services/emailService");

const otpStore = new Map();
const loginAttemptStore = new Map();
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCK_DURATION_MS = 5 * 60 * 1000;
const INVALID_LOGIN_MESSAGE = "Email or password is incorrect.";

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();

const formatRemainingLockTime = (remainingMs) => {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (!minutes) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  if (!seconds) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
};

const buildAuthErrorPayload = (message, extra = {}) => ({
  msg: message,
  message,
  success: false,
  ...extra
});

const getStoredAttemptState = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const state = loginAttemptStore.get(normalizedEmail);

  if (!state) return null;

  if (state.lockUntil && state.lockUntil.getTime() <= Date.now()) {
    loginAttemptStore.delete(normalizedEmail);
    return null;
  }

  return state;
};

const clearStoredAttemptState = (email) => {
  loginAttemptStore.delete(normalizeEmail(email));
};

const registerStoredFailedAttempt = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const currentState = getStoredAttemptState(normalizedEmail) || {
    failedLoginAttempts: 0,
    lockUntil: null
  };

  const failedAttempts = currentState.failedLoginAttempts + 1;
  const attemptsLeft = Math.max(0, MAX_LOGIN_ATTEMPTS - failedAttempts);

  if (failedAttempts >= MAX_LOGIN_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
    loginAttemptStore.set(normalizedEmail, {
      failedLoginAttempts: 0,
      lockUntil
    });

    return {
      attemptsLeft: 0,
      isLocked: true,
      lockUntil
    };
  }

  loginAttemptStore.set(normalizedEmail, {
    failedLoginAttempts: failedAttempts,
    lockUntil: null
  });

  return {
    attemptsLeft,
    isLocked: false,
    lockUntil: null
  };
};

sendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // ✅ check if user exists
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        msg: "User not found"
      });
    }

    const otp = generateOTP();

    otpStore.set(email, {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    });

    await sendOTPEmail(email, otp);

    res.json({ msg: "OTP sent successfully" });

  } catch (err) {
    res.status(500).json({ msg: "Failed to send OTP" });
  }
};

verifyOTP = (req, res) => {
  const { email, otp } = req.body;

  const record = otpStore.get(email);

  if (!record)
    return res.status(400).json({ msg: "OTP not found" });

  if (Date.now() > record.expires)
    return res.status(400).json({ msg: "OTP expired" });

  if (record.otp !== otp)
    return res.status(400).json({ msg: "Invalid OTP" });

  otpStore.delete(email);

  res.json({ msg: "OTP verified" });
};

const getLoginStatus = async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);

        if (!normalizedEmail) {
            return res.status(200).json({
                isLocked: false,
                lockedUntil: null,
                message: ""
            });
        }

        const storedAttemptState = getStoredAttemptState(normalizedEmail);
        if (storedAttemptState?.lockUntil) {
            const remainingMs = storedAttemptState.lockUntil.getTime() - Date.now();

            return res.status(200).json({
                isLocked: true,
                lockedUntil: storedAttemptState.lockUntil,
                message: `Too many unsuccessful login attempts. Access is temporarily locked for ${formatRemainingLockTime(remainingMs)}. Please try again later.`
            });
        }

        const usr = await User.findOne({ email: normalizedEmail }).select("lockUntil failedLoginAttempts");
        if (!usr) {
            return res.status(200).json({
                isLocked: false,
                lockedUntil: null,
                message: ""
            });
        }

        const now = Date.now();
        if (usr.lockUntil && usr.lockUntil.getTime() > now) {
            const remainingMs = usr.lockUntil.getTime() - now;

            return res.status(200).json({
                isLocked: true,
                lockedUntil: usr.lockUntil,
                message: `Too many unsuccessful login attempts. Your account is temporarily locked. Please try again in ${formatRemainingLockTime(remainingMs)}.`
            });
        }

        if (usr.lockUntil && usr.lockUntil.getTime() <= now) {
            usr.lockUntil = null;
            usr.failedLoginAttempts = 0;
            await usr.save();
        }

        return res.status(200).json({
            isLocked: false,
            lockedUntil: null,
            message: ""
        });
    } catch (err) {
        return res.status(500).json({ msg: "Unable to check login status", success: false, error: err.message });
    }
};

const login = async(req,res)=>{
    try{
        const {email,password} = req.body;
        const normalizedEmail = normalizeEmail(email);
        const storedAttemptState = getStoredAttemptState(normalizedEmail);

        if (storedAttemptState?.lockUntil) {
            const remainingMs = storedAttemptState.lockUntil.getTime() - Date.now();
            const message = `Too many unsuccessful login attempts. Access is temporarily locked for ${formatRemainingLockTime(remainingMs)}. Please try again later.`;

            return res.status(423).json(buildAuthErrorPayload(message, {
                isLocked: true,
                attemptsLeft: 0,
                lockedUntil: storedAttemptState.lockUntil
            }));
        }

        const usr = await User
  .findOne({ email: normalizedEmail })
  .populate('role');


        if(!usr){
            const failedAttemptState = registerStoredFailedAttempt(normalizedEmail);

            if (failedAttemptState.isLocked) {
                return res.status(423).json(buildAuthErrorPayload(
                    "Too many unsuccessful login attempts. Your access has been locked for 5 minutes. Please try again later.",
                    {
                        isLocked: true,
                        attemptsLeft: 0,
                        lockedUntil: failedAttemptState.lockUntil
                    }
                ));
            }

            return res.status(401).json(buildAuthErrorPayload(
                `${INVALID_LOGIN_MESSAGE} You have ${failedAttemptState.attemptsLeft} login attempt${failedAttemptState.attemptsLeft === 1 ? "" : "s"} left before access is locked for 5 minutes.`,
                { attemptsLeft: failedAttemptState.attemptsLeft }
            ));
        }

        clearStoredAttemptState(normalizedEmail);

        const now = Date.now();
        if (usr.lockUntil && usr.lockUntil.getTime() > now) {
            const remainingMs = usr.lockUntil.getTime() - now;
            return res.status(423).json(buildAuthErrorPayload(
                `Too many unsuccessful login attempts. Your account is temporarily locked. Please try again in ${formatRemainingLockTime(remainingMs)}.`,
                {
                isLocked: true,
                lockedUntil: usr.lockUntil
                }
            ));
        }

        if (usr.lockUntil && usr.lockUntil.getTime() <= now) {
            usr.failedLoginAttempts = 0;
            usr.lockUntil = null;
        }

        const isequal = await bcrypt.compare(password,usr.passwordHash);

        if(!isequal){
            const failedAttempts = (usr.failedLoginAttempts || 0) + 1;
            const attemptsLeft = Math.max(0, MAX_LOGIN_ATTEMPTS - failedAttempts);

            if (failedAttempts >= MAX_LOGIN_ATTEMPTS) {
                usr.failedLoginAttempts = 0;
                usr.lockUntil = new Date(now + LOGIN_LOCK_DURATION_MS);
                await usr.save();

                return res.status(423).json(buildAuthErrorPayload(
                    "Too many unsuccessful login attempts. Your account has been locked for 5 minutes. Please try again later.",
                    {
                    isLocked: true,
                    attemptsLeft: 0,
                    lockedUntil: usr.lockUntil
                    }
                ));
            }

            usr.failedLoginAttempts = failedAttempts;
            usr.lockUntil = null;
            await usr.save();

            return res.status(401).json(buildAuthErrorPayload(
                `${INVALID_LOGIN_MESSAGE} You have ${attemptsLeft} login attempt${attemptsLeft === 1 ? "" : "s"} left before your account is locked for 5 minutes.`,
                {
                attemptsLeft
                }
            ));
        }
        usr.failedLoginAttempts = 0;
        usr.lockUntil = null;
        await usr.save();
                const rolename = usr.role?.name || "manager";

        const name = usr.name;
        const id= usr._id
        // const avatarUrl= usr.avatarUrl;
const jwtToken = jwt.sign(
  {
    email: usr.email,
    _id: usr._id,
    role: rolename
  },
  process.env.JWT_SECRET,
  { expiresIn: "24h" }
);

        return res.status(200).json({
  msg: "User LoggedIn sucessfully!!!",
  jwtToken,
  name,
  id,
  email: usr.email,
  rolename
});

    }catch(err){
        res.status(500).json({msg:'internal server error',success:false,error: err.message});
    }
}

const resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword)
      return res.status(400).json({ msg: "Missing fields" });

    if (newPassword.length < 6)
      return res.status(400).json({ msg: "Password too short" });

    const user = await User.findOne({ email });

    if (!user)
      return res.status(404).json({ msg: "User not found" });

    // hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.passwordHash = hashedPassword;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save();

    res.json({ msg: "Password reset successful" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Reset failed" });
  }
};


module.exports = {
    login,
    getLoginStatus,
    sendOTP,
    verifyOTP,
    resetPassword
}
