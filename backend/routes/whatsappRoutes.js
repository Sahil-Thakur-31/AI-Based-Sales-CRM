const express = require("express");
const { sendWhatsAppMessage } = require("../services/whatsappService");

const router = express.Router();

router.post("/send", async (req, res) => {
  try {
    const { phone, message } = req.body;

    await sendWhatsAppMessage(phone, message);

    res.json({ success: true, message: "Message Sent ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending message" });
  }
});

module.exports =  router;