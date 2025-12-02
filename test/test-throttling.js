const ExchangeMonitor = require('../src/monitor');

// Mock notifier
const notifier = require('../src/notifier');
notifier.sendLarkNotification = async (msg) => {
    console.log(`[MOCK NOTIFICATION] ${msg}`);
};

// Mock DB
const db = require('../src/db');
db.logDepth = () => { };
db.logAlert = () => { };

async function testThrottling() {
    console.log('Testing throttling logic...');
    const monitor = new ExchangeMonitor('binance');

    // Test helper directly
    const symbol = 'BTC/USDT';
    const type = 'test';
    const interval = 1; // 1 minute

    console.log('1. First notification should pass');
    if (monitor.shouldNotify(symbol, type, interval)) {
        console.log('PASS: First notification allowed');
    } else {
        console.error('FAIL: First notification blocked');
    }

    console.log('2. Immediate second notification should be blocked');
    if (!monitor.shouldNotify(symbol, type, interval)) {
        console.log('PASS: Second notification blocked');
    } else {
        console.error('FAIL: Second notification allowed');
    }

    // Mock time passing? 
    // Since we can't easily mock Date.now() without a library or refactoring, 
    // we will just verify the logic structure or use a very short interval for a real test.

    console.log('3. Testing with short interval (1 second)');
    // Reset state
    monitor.lastNotificationTimes = {};
    const shortInterval = 1 / 60; // 1 second in minutes

    if (monitor.shouldNotify(symbol, type, shortInterval)) {
        console.log('PASS: First notification allowed');
    }

    if (!monitor.shouldNotify(symbol, type, shortInterval)) {
        console.log('PASS: Immediate retry blocked');
    }

    await new Promise(resolve => setTimeout(resolve, 1100));

    if (monitor.shouldNotify(symbol, type, shortInterval)) {
        console.log('PASS: Notification allowed after interval');
    } else {
        console.error('FAIL: Notification blocked after interval');
    }
}

testThrottling();
