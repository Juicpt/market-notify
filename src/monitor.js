const ccxt = require('ccxt');
const { sendLarkNotification } = require('./notifier');
const { logDepth, logAlert } = require('./db');

class ExchangeMonitor {
    constructor(exchangeId) {
        if (!ccxt.pro[exchangeId]) {
            // Fallback to REST if pro not available, but user requested WS.
            // For now, assume pro is available as per plan.
            // If ccxt.pro is not available in the free version installed, this might fail.
            // However, the standard ccxt package includes pro classes but requires authentication/license for some.
            // Many public WS endpoints are free.
            console.warn(`Exchange ${exchangeId} might not support WebSocket via ccxt.pro or requires instantiation.`);
        }

        // Instantiate exchange. Note: ccxt.pro exchanges are usually accessed via ccxt.pro.binance, etc.
        // But in recent versions, they might be under ccxt.pro[exchangeId]
        const exchangeClass = ccxt.pro[exchangeId] || ccxt[exchangeId];
        this.exchange = new exchangeClass();
        this.exchangeId = exchangeId;
    }

    async watchDepth(symbol, percentage, minValue) {
        console.log(`[${this.exchangeId}] Starting depth watch for ${symbol}`);
        while (true) {
            try {
                const orderBook = await this.exchange.watchOrderBook(symbol);
                const bids = orderBook.bids;
                const asks = orderBook.asks;

                if (bids.length === 0 || asks.length === 0) continue;

                const midPrice = (bids[0][0] + asks[0][0]) / 2;
                const lowerBound = midPrice * (1 - percentage / 100);
                const upperBound = midPrice * (1 + percentage / 100);

                let bidDepthValue = 0;
                for (const [price, amount] of bids) {
                    if (price >= lowerBound) {
                        bidDepthValue += price * amount;
                    } else {
                        break;
                    }
                }

                let askDepthValue = 0;
                for (const [price, amount] of asks) {
                    if (price <= upperBound) {
                        askDepthValue += price * amount;
                    } else {
                        break;
                    }
                }

                // Log to DB
                logDepth(this.exchangeId, symbol, Date.now(), bidDepthValue, askDepthValue);

                // Check if depth value is below threshold
                if (bidDepthValue < minValue) {
                    const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] Low Bid Depth (-${percentage}%): ${bidDepthValue.toFixed(2)} < ${minValue}`;
                    await sendLarkNotification(msg);
                    logAlert(this.exchangeId, symbol, Date.now(), msg);
                }
                if (askDepthValue < minValue) {
                    const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] Low Ask Depth (+${percentage}%): ${askDepthValue.toFixed(2)} < ${minValue}`;
                    await sendLarkNotification(msg);
                    logAlert(this.exchangeId, symbol, Date.now(), msg);
                }

            } catch (error) {
                console.error(`Error watching depth for ${symbol}:`, error.message);
                // Wait a bit before retrying to avoid spamming on connection loss
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchTrades(symbol, maxSilenceTime) {
        console.log(`[${this.exchangeId}] Starting trade watch for ${symbol}`);
        let lastTradeTime = Date.now();

        // Start a silence checker loop
        const silenceChecker = setInterval(async () => {
            const currentTime = Date.now();
            const silenceTime = (currentTime - lastTradeTime) / 1000;
            if (silenceTime > maxSilenceTime) {
                const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] No trades for ${silenceTime.toFixed(0)}s (Threshold: ${maxSilenceTime}s)`;
                await sendLarkNotification(msg);
                logAlert(this.exchangeId, symbol, Date.now(), msg);
            }
        }, 10000); // Check every 10 seconds

        while (true) {
            try {
                const trades = await this.exchange.watchTrades(symbol);
                if (trades.length > 0) {
                    // Update last trade time
                    lastTradeTime = trades[trades.length - 1].timestamp || Date.now();
                }
            } catch (error) {
                console.error(`Error watching trades for ${symbol}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

module.exports = ExchangeMonitor;
