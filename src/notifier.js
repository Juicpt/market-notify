const axios = require('axios');
require('dotenv').config();

const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL;

async function sendLarkNotification(text) {
  if (!LARK_WEBHOOK_URL) {
    console.warn('LARK_WEBHOOK_URL is not set in .env');
    return;
  }

  try {
    await axios.post(LARK_WEBHOOK_URL, {
      msg_type: 'text',
      content: {
        text: text
      }
    });
    console.log(`Notification sent: ${text}`);
  } catch (error) {
    console.error('Failed to send Lark notification:', error.message);
  }
}

module.exports = { sendLarkNotification };
