const ccxt = require('ccxt');
const {sendLarkNotification} = require('./notifier');
const {logDepth, logAlert} = require('./db');

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
        this.marketsLoaded = false;
        this.validSymbols = new Set();
    }

    async loadMarkets() {
        if (this.marketsLoaded) return;
        try {
            console.log(`[${this.exchangeId}] Loading markets...`);
            await this.exchange.loadMarkets();
            this.validSymbols = new Set(Object.keys(this.exchange.markets));
            this.marketsLoaded = true;
            console.log(`[${this.exchangeId}] Loaded ${this.validSymbols.size} markets`);
        } catch (error) {
            console.error(`[${this.exchangeId}] Failed to load markets:`, error.message);
            throw error;
        }
    }

    addCustomMarket(symbol, marketConfig) {

        if (!this.exchange.markets) {
            this.exchange.markets = {};
        }

        // Parse marketId from config or generate default
        const marketId = (marketConfig && marketConfig.id) || symbol.replace('/', '').toUpperCase();

        // Default market configuration
        const defaultConfig = {
            id: marketId,
            symbol: symbol,
            base: symbol.split('/')[0],
            quote: symbol.split('/')[1],
            baseId: symbol.split('/')[0].toUpperCase(),
            quoteId: symbol.split('/')[1].toUpperCase(),
            active: true,
            index: false,
            type: 'spot',
            spot: true,
            margin: false,
            swap: false,
            future: false,
            option: false,
            contract: false,
            precision: {
                amount: 0.01,
                price: 0.0001,
            },
            limits: {
                leverage: {},
                amount: {
                    min: 0.01,
                    max: 13775781,
                },
                price: {
                    min: 0.0001,
                    max: 10000000,
                },
                cost: {
                    min: 5,
                },
            },
            marginModes: {},
            info: {
                filters: [
                    {
                        minPrice: 0.000001,
                        maxPrice: 10000000.00000000,
                        tickSize: 0.000001,
                        filterType: "PRICE_FILTER"
                    },
                    {
                        minQty: 0.01,
                        maxQty: 13775781,
                        stepSize: 0.01,
                        filterType: "LOT_SIZE"
                    },
                    {
                        minNotional: 5,
                        filterType: "MIN_NOTIONAL"
                    },
                    {
                        minAmount: "5",
                        maxAmount: "999999",
                        minBuyPrice: "0.000001",
                        filterType: "TRADE_AMOUNT"
                    },
                    {
                        maxSellPrice: "999999",
                        buyPriceUpRate: "0.05",
                        sellPriceDownRate: "0.05",
                        filterType: "LIMIT_TRADING"
                    },
                    {
                        buyPriceUpRate: "0.05",
                        sellPriceDownRate: "0.05",
                        filterType: "MARKET_TRADING"
                    },
                    {
                        noAllowMarketStartTime: "0",
                        noAllowMarketEndTime: "0",
                        limitOrderStartTime: "0",
                        limitOrderEndTime: "0",
                        limitMinPrice: "0",
                        limitMaxPrice: "0",
                        filterType: "OPEN_QUOTE"
                    }],
                exchangeId: "301",
                symbol: symbol.replace('/', ''),
                symbolName: symbol.replace('/', ''),
                status: "TRADING",
                baseAsset: symbol.split('/')[0].toUpperCase(),
                baseAssetName: symbol.split('/')[0].toUpperCase(),
                baseAssetPrecision: "0.01",
                quoteAsset: symbol.split('/')[1].toUpperCase(),
                quoteAssetName: symbol.split('/')[1].toUpperCase(),
                quotePrecision: "0.00000001",
                icebergAllowed: false,
                isAggregate: false,
                allowMargin: false
            }
        };

        // Merge with user config
        const finalConfig = {...defaultConfig, ...marketConfig};

        // Ensure base and quote are set correctly
        if (symbol.includes('/')) {
            finalConfig.base = finalConfig.base || symbol.split('/')[0];
            finalConfig.quote = finalConfig.quote || symbol.split('/')[1];
        }
        // Add to markets
        this.exchange.markets[symbol] = finalConfig;

        // Add to markets_by_id (critical for ccxt.pro WebSocket)
        if (!this.exchange.markets_by_id) {
            this.exchange.markets_by_id = {};
        }

        // Check if this id already exists (ID collision with swap/future markets)
        const existingMarket = this.exchange.markets_by_id[finalConfig.id];
        if (existingMarket) {
            if (Array.isArray(existingMarket)) {
                // Already an array, check if we should replace or add
                const spotIndex = existingMarket.findIndex(m => m.spot === true);
                if (spotIndex >= 0) {
                    // Replace existing spot market
                    console.log(`[${this.exchangeId}] Replacing existing spot market for ${symbol}`);
                    existingMarket[spotIndex] = finalConfig;
                } else {
                    // Add new spot market to array
                    console.log(`[${this.exchangeId}] Warning: ID ${finalConfig.id} collision, adding spot market to array`);
                    existingMarket.push(finalConfig);
                }
            } else {
                // Single market exists, check types
                if (existingMarket.spot && finalConfig.spot) {
                    // Both are spot, replace
                    console.log(`[${this.exchangeId}] Replacing existing spot market ${existingMarket.symbol} with ${symbol}`);
                    this.exchange.markets_by_id[finalConfig.id] = finalConfig;
                } else {
                    // Different types, convert to array
                    console.log(`[${this.exchangeId}] ID ${finalConfig.id} collision: ${existingMarket.type} vs ${finalConfig.type}, converting to array`);
                    this.exchange.markets_by_id[finalConfig.id] = [existingMarket, finalConfig];
                }
            }
        } else {
            // No collision, add directly as single object
            this.exchange.markets_by_id[finalConfig.id] = [finalConfig];
        }

        // Add to symbols array
        if (!this.exchange.symbols) {
            this.exchange.symbols = [];
        }
        if (!this.exchange.symbols.includes(symbol)) {
            this.exchange.symbols.push(symbol);  // Push symbol, not id!
        }

        // Add to ids array
        if (!this.exchange.ids) {
            this.exchange.ids = [];
        }
        if (!this.exchange.ids.includes(finalConfig.id)) {
            this.exchange.ids.push(finalConfig.id);
        }

        // Add to validSymbols
        this.validSymbols.add(symbol);

        console.log(`[${this.exchangeId}] Added custom market: ${symbol} (id: ${finalConfig.id})`);
        console.log(`[${this.exchangeId}]   - markets[${symbol}]: ✓`);
        console.log(`[${this.exchangeId}]   - markets_by_id[${finalConfig.id}]: ${Array.isArray(this.exchange.markets_by_id[finalConfig.id]) ? 'array' : 'object'}`);

        // Debug: check if market() can resolve this symbol
        try {
            const testMarket = this.exchange.market(symbol);
            console.log(`[${this.exchangeId}]   - market('${symbol}') resolved: ✓ (type: ${testMarket.type})`);
        } catch (error) {
            console.error(`[${this.exchangeId}]   - market('${symbol}') failed: ${error.message}`);
        }

        return finalConfig;
    }

    async validateSymbol(symbol) {
        if (!this.marketsLoaded) {
            await this.loadMarkets();
        }

        // Check if symbol exists
        if (this.validSymbols.has(symbol)) {
            console.log(`[${this.exchangeId}] ✓ Symbol ${symbol} validated`);
            return symbol;
        }

        // Try to find similar symbols
        const base = symbol.split('/')[0];
        const quote = symbol.split('/')[1];

        const similarSymbols = Array.from(this.validSymbols).filter(s => {
            const sBase = s.split('/')[0];
            const sQuote = s.split('/')[1];
            return sBase.includes(base) || (quote && sQuote.includes(quote)) ||
                   base.includes(sBase) || (quote && quote.includes(sQuote));
        }).slice(0, 10);

        console.error(`\n❌ Symbol ${symbol} not found on ${this.exchangeId}`);
        console.error(`   Total available markets: ${this.validSymbols.size}`);

        if (similarSymbols.length > 0) {
            console.error(`   Similar symbols found:`);
            similarSymbols.forEach(s => {
                const m = this.exchange.markets[s];
                console.error(`     - ${s} (id: ${m.id}, type: ${m.type || 'spot'})`);
            });
            console.error(`\n   💡 Try using one of the similar symbols above, or use "customMarket" if the symbol should exist.`);
        } else {
            console.error(`   No similar symbols found.`);
            console.error(`\n   💡 Use: node scripts/find-symbols.js ${this.exchangeId} ${base}`);
            console.error(`   Or add "customMarket" configuration if you're sure this symbol exists.`);
        }

        console.error(`   📚 Run "node scripts/find-symbols.js ${this.exchangeId} ${base}" for help\n`);

        const errorMsg = `Symbol ${symbol} not found on ${this.exchangeId}`;
        throw new Error(errorMsg);
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

    async watchDepth(symbol, percentage, minValue, notificationInterval = 0, duration = 0, useRawId = false) {
        console.log(`[${this.exchangeId}] Starting depth watch for ${symbol} (Duration: ${duration}s)`);

        // Validate symbol before starting
        try {
            await this.validateSymbol(symbol);
        } catch (error) {
            console.error(`[${this.exchangeId}] ${error.message}`);
            return;
        }

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
                // ccxt will use exchange.markets[symbol] directly, avoiding markets_by_id lookup
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

    async watchTrades(symbol, maxSilenceTime, notificationInterval = 0, useRawId = false) {
        console.log(`[${this.exchangeId}] Starting trade watch for ${symbol}`);

        // Validate symbol before starting
        try {
            await this.validateSymbol(symbol);
        } catch (error) {
            console.error(`[${this.exchangeId}] ${error.message}`);
            return;
        }

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
