const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async ({ to, subject, html, text, fromName = "CRM Notifications" }) => {
  if (!to) throw new Error("Recipient email is required");

  await transporter.sendMail({
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to,
    subject: subject || "CRM Notification",
    html: html || "",
    text: text || ""
  });
};

const sendOTPEmail = async (to, otp) => {
  await sendEmail({
    to,
    fromName: "CRM Security",
    subject: "Your OTP Code",
    html: `
      <h2>OTP Verification</h2>
      <p>Your OTP is:</p>
      <h1>${otp}</h1>
      <p>This expires in 5 minutes.</p>
    `,
    text: `OTP Verification\nYour OTP is: ${otp}\nThis expires in 5 minutes.`
  });
};

sendOTPEmail.sendEmail = sendEmail;
sendOTPEmail.transporter = transporter;

module.exports = sendOTPEmail;