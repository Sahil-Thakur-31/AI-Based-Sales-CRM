const axios = require("axios");

const sendWhatsAppMessage = async (phone, message) => {
  try {
    const response = await axios.post(
      `${process.env.WAHA_URL}/api/sendText`,
      {
        session: "default",
        chatId: `${phone}@c.us`,
        text: message,
      },
      {
        headers: {
          "X-Api-Key": process.env.WAHA_API_KEY,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("WhatsApp Error:", error.response?.data || error.message);
    throw error;
  }
};

module.exports = {sendWhatsAppMessage};
