const fs = require('fs');
const path = require('path');
const ExchangeMonitor = require('./monitor');
const { initDB, closeDB } = require('./db');

const monitors = {};
let isShuttingDown = false;

// Load and validate config
function loadConfig() {
    const configPath = path.join(__dirname, '../config.json');
    try {
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file not found at ${configPath}`);
        }
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);

        // Validate config structure
        if (!config.monitors || !Array.isArray(config.monitors)) {
            throw new Error('Invalid config: monitors must be an array');
        }

        for (const monitor of config.monitors) {
            if (!monitor.exchange || !monitor.symbol) {
                throw new Error('Invalid monitor config: exchange and symbol are required');
            }
            if (monitor.notificationInterval && monitor.notificationInterval < 0) {
                throw new Error('Invalid notificationInterval: must be >= 0');
            }
            if (monitor.depth) {
                if (!monitor.depth.percentage || !monitor.depth.minValue) {
                    throw new Error('Invalid depth config: percentage and minValue are required');
                }
                if (monitor.depth.duration && monitor.depth.duration < 0) {
                    throw new Error('Invalid depth.duration: must be >= 0');
                }
            }
            if (monitor.tradeSilence && !monitor.tradeSilence.maxSilenceTime) {
                throw new Error('Invalid tradeSilence config: maxSilenceTime is required');
            }
        }

        return config;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in config file: ${error.message}`);
        }
        throw error;
    }
}

async function gracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\nShutting down gracefully...');

    // Stop all monitors
    for (const [exchangeId, monitor] of Object.entries(monitors)) {
        try {
            await monitor.stop();
            console.log(`Stopped monitor for ${exchangeId}`);
        } catch (error) {
            console.error(`Error stopping monitor for ${exchangeId}:`, error.message);
        }
    }

    // Close database
    try {
        closeDB();
        console.log('Database closed.');
    } catch (error) {
        console.error('Error closing database:', error.message);
    }

    console.log('Shutdown complete.');
    process.exit(0);
}

// Handle process signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown();
});

async function startMonitoring() {
    console.log('Starting CCXT Exchange Monitor (WebSocket Mode)...');

    // Load config
    let config;
    try {
        config = loadConfig();
        console.log(`Loaded config with ${config.monitors.length} monitors`);
    } catch (error) {
        console.error('Failed to load config:', error.message);
        process.exit(1);
    }

    // Initialize database
    try {
        await initDB();
        console.log('Database initialized.');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
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
            monitor.watchDepth(item.symbol, item.depth.percentage, item.depth.minValue, item.notificationInterval, item.depth.duration || 0)
                .catch(error => {
                    console.error(`Fatal error in depth watch for ${item.symbol}:`, error);
                });
        }

        // Check Trade Silence
        if (item.tradeSilence) {
            monitor.watchTrades(item.symbol, item.tradeSilence.maxSilenceTime, item.notificationInterval || 0)
                .catch(error => {
                    console.error(`Fatal error in trade watch for ${item.symbol}:`, error);
                });
        }
    }

    console.log('All monitors started successfully.');
}

startMonitoring().catch(error => {
    console.error('Failed to start monitoring:', error);
    process.exit(1);
});
