const { sendLarkNotification } = require('../src/notifier');

async function testNotify() {
    console.log('Sending test notification...');
    await sendLarkNotification('This is a test notification from CCXT Monitor.');
}

testNotify();
