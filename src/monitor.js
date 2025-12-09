const ccxt = require('ccxt');
const { sendLarkNotification } = require('./notifier');
const { logDepth, logAlert } = require('./db');

function inRangeBid(price, mid, pct) {
    return price >= mid * (1 - pct / 100);
}

function inRangeAsk(price, mid, pct) {
    return price <= mid * (1 + pct / 100);
}

class ExchangeMonitor {
    orderBook = 'watchOrderBook'
    trade = 'watchTrades'
    // trade = 'fetchTrades'
    // orderBook = 'fetchOrderBook'

    constructor(exchangeId) {
        // Instantiate exchange. Note: ccxt.pro exchanges are usually accessed via ccxt.pro.binance, etc.
        // But in recent versions, they might be under ccxt.pro[exchangeId]
        const exchangeClass = ccxt.pro[exchangeId] || ccxt[exchangeId];
        this.exchange = new exchangeClass();
        if (!ccxt.pro[exchangeId]) {
            // Fallback to REST if pro not available, but user requested WS.
            // For now, assume pro is available as per plan.
            // If ccxt.pro is not available in the free version installed, this might fail.
            // However, the standard ccxt package includes pro classes but requires authentication/license for some.
            // Many public WS endpoints are free.
            console.warn(`Exchange ${exchangeId} might not support WebSocket via ccxt.pro.`);
            this.orderBook = 'fetchOrderBook'
            this.trade = 'fetchTrades'
        }
        if (this.exchange.options.watchOrderBook && this.exchange.options.watchOrderBook.maxRetries) {
            this.exchange.options.watchOrderBook.maxRetries = 10;
        }
        this.exchangeId = exchangeId;
        this.lastNotificationTimes = {};
        this.running = true;
        this.activeWatchers = new Set();
        this.tradeIntervals = new Map();
    }

    shouldNotify(symbol, type, intervalMinutes) {
        if (!intervalMinutes || intervalMinutes <= 0) return true;

        const key = `${symbol}:${type}`;
        const lastTime = this.lastNotificationTimes[key] || 0;
        const now = Date.now();

        if (now - lastTime > intervalMinutes * 60 * 1000) {
            this.lastNotificationTimes[key] = now;
            return true;
        }
        return false;
    }

    async watchDepth(symbol, percentage, minValue, notificationInterval = 0, duration = 0) {
        console.log(`[${this.exchangeId}] Starting depth watch for ${symbol} (Duration: ${duration}s)`);
        const watcherId = `depth_${symbol}`;
        this.activeWatchers.add(watcherId);

        let lowBidStartTime = 0;
        let lowAskStartTime = 0;
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 10;
        const BASE_RETRY_DELAY = 1000;
        const MAX_RETRY_DELAY = 60000;

        while (this.running) {
            try {
                const orderBook = await this.exchange[this.orderBook](symbol);
                const bids = orderBook.bids;
                const asks = orderBook.asks;

                // Reset error counter on success
                consecutiveErrors = 0;

                if (bids.length === 0 || asks.length === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                const midPrice = (bids[0][0] + asks[0][0]) / 2;
                let bidQuantity = 0;
                let bidDepthValue = 0;
                for (const [price, amount] of bids) {
                    if (!inRangeBid(price, midPrice, percentage)) break;
                    bidQuantity += amount;
                    bidDepthValue += price * amount;
                }

                let askQuantity = 0;
                let askDepthValue = 0;
                for (const [price, amount] of asks) {
                    if (!inRangeAsk(price, midPrice, percentage)) break;
                    askQuantity += amount;
                    askDepthValue += price * amount;
                }

                // Log to DB
                logDepth(this.exchangeId, symbol, Date.now(), bidDepthValue, askDepthValue, midPrice, bidQuantity, askQuantity);

                // Check if depth value is below threshold
                if (bidDepthValue < minValue) {
                    if (lowBidStartTime === 0) {
                        lowBidStartTime = Date.now();
                    }
                    const elapsed = (Date.now() - lowBidStartTime) / 1000;
                    if (elapsed >= duration) {
                        if (this.shouldNotify(symbol, 'depth_bid', notificationInterval)) {
                            const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] Low Bid Depth (-${percentage}%): ${bidDepthValue.toFixed(2)} < ${minValue} (Qty: ${bidQuantity.toFixed(4)}, Mid: ${midPrice}) for ${elapsed.toFixed(1)}s`;
                            await sendLarkNotification(msg);
                            logAlert(this.exchangeId, symbol, Date.now(), msg);
                        }
                    }
                } else {
                    lowBidStartTime = 0;
                    delete this.lastNotificationTimes[`${symbol}:depth_bid`];
                }

                if (askDepthValue < minValue) {
                    if (lowAskStartTime === 0) {
                        lowAskStartTime = Date.now();
                    }
                    const elapsed = (Date.now() - lowAskStartTime) / 1000;
                    if (elapsed >= duration) {
                        if (this.shouldNotify(symbol, 'depth_ask', notificationInterval)) {
                            const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] Low Ask Depth (+${percentage}%): ${askDepthValue.toFixed(2)} < ${minValue} (Qty: ${askQuantity.toFixed(4)}, Mid: ${midPrice}) for ${elapsed.toFixed(1)}s`;
                            await sendLarkNotification(msg);
                            logAlert(this.exchangeId, symbol, Date.now(), msg);
                        }
                    }
                } else {
                    lowAskStartTime = 0;
                    delete this.lastNotificationTimes[`${symbol}:depth_ask`];
                }

            } catch (error) {
                consecutiveErrors++;
                console.error(`[${this.exchangeId}] Error watching depth for ${symbol} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error.message);

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.error(`[${this.exchangeId}] Max consecutive errors reached for ${symbol} depth watch. Stopping.`);
                    break;
                }

                // Exponential backoff with max cap
                const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1), MAX_RETRY_DELAY);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.activeWatchers.delete(watcherId);
        console.log(`[${this.exchangeId}] Stopped depth watch for ${symbol}`);
    }

    async watchTrades(symbol, maxSilenceTime, notificationInterval = 0) {
        console.log(`[${this.exchangeId}] Starting trade watch for ${symbol}`);
        const watcherId = `trade_${symbol}`;
        this.activeWatchers.add(watcherId);

        let lastTradeTime = Date.now();
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 10;
        const BASE_RETRY_DELAY = 5000;
        const MAX_RETRY_DELAY = 60000;

        // Start a silence checker loop
        const silenceChecker = setInterval(async () => {
            if (!this.running) return;
            const currentTime = Date.now();
            const silenceTime = (currentTime - lastTradeTime) / 1000;
            if (silenceTime > maxSilenceTime) {
                if (this.shouldNotify(symbol, 'silence', notificationInterval)) {
                    const msg = `[${this.exchangeId.toUpperCase()} ${symbol}] No trades for ${silenceTime.toFixed(0)}s (Threshold: ${maxSilenceTime}s)`;
                    await sendLarkNotification(msg);
                    logAlert(this.exchangeId, symbol, Date.now(), msg);
                }
            }
        }, 1000);

        // Store interval for cleanup
        this.tradeIntervals.set(symbol, silenceChecker);

        while (this.running) {
            try {
                const trades = await this.exchange[this.trade](symbol);
                if (trades && trades.length > 0) {
                    // Update last trade time
                    lastTradeTime = trades[trades.length - 1].timestamp || Date.now();
                }
                // Reset error counter on success
                consecutiveErrors = 0;
            } catch (error) {
                consecutiveErrors++;
                console.error(`[${this.exchangeId}] Error watching trades for ${symbol} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error.message);

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.error(`[${this.exchangeId}] Max consecutive errors reached for ${symbol} trade watch. Stopping.`);
                    break;
                }

                // Exponential backoff with max cap
                const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1), MAX_RETRY_DELAY);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Clean up interval
        clearInterval(silenceChecker);
        this.tradeIntervals.delete(symbol);
        this.activeWatchers.delete(watcherId);
        console.log(`[${this.exchangeId}] Stopped trade watch for ${symbol}`);
    }

    async stop() {
        console.log(`[${this.exchangeId}] Stopping monitor...`);
        this.running = false;

        // Clear all trade intervals
        for (const [symbol, interval] of this.tradeIntervals.entries()) {
            clearInterval(interval);
            console.log(`[${this.exchangeId}] Cleared interval for ${symbol}`);
        }
        this.tradeIntervals.clear();

        // Wait for all watchers to complete (with timeout)
        const timeout = 5000;
        const startTime = Date.now();
        while (this.activeWatchers.size > 0 && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Close exchange connection if available
        try {
            if (this.exchange.close && typeof this.exchange.close === 'function') {
                await this.exchange.close();
            }
        } catch (error) {
            console.error(`[${this.exchangeId}] Error closing exchange:`, error.message);
        }

        console.log(`[${this.exchangeId}] Monitor stopped. Active watchers: ${this.activeWatchers.size}`);
    }
}

module.exports = ExchangeMonitor;
