const User = require('../models/users');
const Role = require('../models/roles');

const jwt = require('jsonwebtoken');
require('dotenv').config()
const bcrypt = require('bcrypt')

const sendOTPEmail = require("../services/emailService");

const otpStore = new Map();

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

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


const register = async(req,res) =>{
    try{
        const {name,email,password,role,joinDate} = req.body;
        const usr = await User.findOne({email});
        if(usr){
            return res.status(409).json({msg: "can't add, User already exists. ",success:false});
        }
        const newPass = await bcrypt.hash(password,10);
        const result = await User.create({
            name,email,passwordHash:newPass,role,joiningDate:joinDate
        });
        return res.status(201).json({msg:"User created sucessfully!!!"});
    }catch(err){
        res.status(500).json({msg:'internal server error',success:false});
    }
}

const login = async(req,res)=>{
    try{
      console.log('hello');
        const {email,password} = req.body;
        const usr = await User
  .findOne({ email })
  .populate('role');


        const errmsg = "Email or Password is  incorrect";
        if(!usr){
            return res.status(409).json({msg: errmsg,success:false});
        }
        const isequal = await bcrypt.compare(password,usr.passwordHash);

        if(!isequal){
            return res.status(403).json({msg:errmsg,success:false})
        }
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

    await user.save();

    res.json({ msg: "Password reset successful" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Reset failed" });
  }
};


module.exports = {
    login,
    register,
    sendOTP,
    verifyOTP,
    resetPassword
}