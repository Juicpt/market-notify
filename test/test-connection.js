const ccxt = require('ccxt');

async function testConnection() {
    try {
        const exchange = new ccxt.binance();
        const symbol = 'BTC/USDT';
        console.log(`Fetching order book for ${symbol}...`);
        const orderBook = await exchange.fetchOrderBook(symbol);
        console.log('Order book fetched successfully!');
        console.log(`Top Bid: ${orderBook.bids[0][0]} (Amount: ${orderBook.bids[0][1]})`);
        console.log(`Top Ask: ${orderBook.asks[0][0]} (Amount: ${orderBook.asks[0][1]})`);
    } catch (error) {
        console.error('Connection test failed:', error.message);
    }
}

testConnection();
