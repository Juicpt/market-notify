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

async function testDepthDuration() {
    console.log('Testing depth duration logic...');
    const monitor = new ExchangeMonitor('binance');

    // Mock exchange
    monitor.exchange = {
        fetchOrderBook: async (symbol) => {
            return {
                bids: [[100, 0.1]], // Value = 10
                asks: [[101, 0.1]]  // Value = 10.1
            };
        },
        options: {}
    };
    monitor.orderBook = 'fetchOrderBook';

    const symbol = 'BTC/USDT';
    const percentage = 2;
    const minValue = 100; // Threshold is 100, current value is ~10, so it's LOW
    const notificationInterval = 0;
    const duration = 2; // 2 seconds duration

    console.log(`Starting watch with duration ${duration}s...`);

    // We need to run watchDepth but break it after some time or mock the loop.
    // Since watchDepth has a while(true) loop, we can't await it directly without blocking.
    // We will modify the monitor instance to allow us to control the loop or just run it and kill it?
    // Better: We can't easily control the loop in the real class without refactoring.
    // However, for this test, we can override the `exchange.fetchOrderBook` to throw an error after some calls to break the loop?
    // Or we can just run it and use setTimeout to check logs/state?

    // Let's use a modified approach: We will mock `monitor.shouldNotify` to track calls.
    let notificationCount = 0;
    const originalShouldNotify = monitor.shouldNotify.bind(monitor);
    monitor.shouldNotify = (s, t, i) => {
        const result = originalShouldNotify(s, t, i);
        if (result) {
            notificationCount++;
            console.log(`Notification triggered for ${t}`);
        }
        return result;
    };

    // We will run watchDepth in a promise but not await it immediately
    const watchPromise = monitor.watchDepth(symbol, percentage, minValue, notificationInterval, duration);

    // 1. Immediate check: Should NOT notify yet
    await new Promise(resolve => setTimeout(resolve, 500));
    if (notificationCount === 0) {
        console.log('PASS: No notification immediately');
    } else {
        console.error('FAIL: Notification triggered too early');
    }

    // 2. Wait for duration to pass (total 2.5s > 2s)
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (notificationCount > 0) {
        console.log('PASS: Notification triggered after duration');
    } else {
        console.error('FAIL: Notification NOT triggered after duration');
    }

    // Stop the loop (hacky way: throw error in mock)
    monitor.exchange.fetchOrderBook = async () => { throw new Error('Stop test'); };

    try {
        await Promise.race([watchPromise, new Promise(r => setTimeout(r, 1000))]);
    } catch (e) {
        // Expected
    }
    console.log('Test finished');
    process.exit(0);
}

testDepthDuration();
