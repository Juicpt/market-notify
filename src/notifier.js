const axios = require('axios');
require('dotenv').config();

const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL;
const NOTIFICATION_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;

async function sendLarkNotification(text) {
  if (!LARK_WEBHOOK_URL) {
    console.warn('LARK_WEBHOOK_URL is not set in .env');
    return false;
  }

  if (!text || typeof text !== 'string') {
    console.error('Invalid notification text');
    return false;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(LARK_WEBHOOK_URL, {
        msg_type: 'text',
        content: {
          text: text
        }
      }, {
        timeout: NOTIFICATION_TIMEOUT,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log(`Notification sent: ${text}`);
      return true;
    } catch (error) {
      lastError = error;
      const errorMsg = error.response
        ? `${error.response.status} ${error.response.statusText}`
        : error.message;

      console.error(`Failed to send Lark notification (attempt ${attempt}/${MAX_RETRIES}): ${errorMsg}`);

      // Don't retry on client errors (4xx)
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Failed to send notification after ${MAX_RETRIES} attempts:`, lastError?.message);
  return false;
}

module.exports = { sendLarkNotification };
