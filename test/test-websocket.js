const ccxt = require('ccxt');

async function testWebSocket() {
    const exchangeId = 'binance';
    const symbol = 'BTC/USDT';

    // Note: Standard ccxt package might not support watchOrderBook without pro license or specific setup
    // But we are testing the code structure. If it fails due to missing pro, we'll know.
    // For this test, we try to use the pro class if available, or fall back to standard (which might fail for watch methods)
    const exchangeClass = ccxt.pro[exchangeId] || ccxt[exchangeId];
    const exchange = new exchangeClass();

    if (!exchange.has['watchOrderBook']) {
        console.error(`${exchangeId} does not support watchOrderBook`);
        return;
    }

    console.log(`Watching order book for ${symbol}...`);
    try {
        // Watch for a few updates
        for (let i = 0; i < 3; i++) {
            const orderBook = await exchange.watchOrderBook(symbol);
            console.log(`Update ${i + 1}: Bid ${orderBook.bids[0][0]}, Ask ${orderBook.asks[0][0]}`);
        }
        console.log('WebSocket test passed!');
        process.exit(0);
    } catch (error) {
        console.error('WebSocket test failed:', error.message);
        process.exit(1);
    }
}

testWebSocket();
