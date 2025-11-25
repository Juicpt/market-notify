const fs = require('fs');
const path = require('path');
const ExchangeMonitor = require('./monitor');
const { initDB } = require('./db');

// Load config
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const monitors = {};

async function startMonitoring() {
    console.log('Starting CCXT Exchange Monitor (WebSocket Mode)...');

    try {
        await initDB();
        console.log('Database initialized.');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        return;
    }

    // Initialize monitors for each exchange
    const exchanges = [...new Set(config.monitors.map(m => m.exchange))];
    for (const exchangeId of exchanges) {
        try {
            monitors[exchangeId] = new ExchangeMonitor(exchangeId);
            console.log(`Initialized monitor for ${exchangeId}`);
        } catch (error) {
            console.error(`Failed to initialize monitor for ${exchangeId}:`, error.message);
        }
    }

    // Start monitoring loops
    for (const item of config.monitors) {
        const monitor = monitors[item.exchange];
        if (!monitor) continue;

        // Check Depth
        if (item.depth) {
            // Don't await here, let it run in background
            monitor.watchDepth(item.symbol, item.depth.percentage, item.depth.minValue);
        }

        // Check Trade Silence
        if (item.tradeSilence) {
            // Don't await here, let it run in background
            monitor.watchTrades(item.symbol, item.tradeSilence.maxSilenceTime);
        }
    }
}

startMonitoring();
