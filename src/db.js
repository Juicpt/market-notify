const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function getDB() {
    if (!db) {
        const dbPath = path.join(__dirname, '../monitor.db');
        try {
            db = new Database(dbPath);
            // Enable WAL mode for better concurrency
            db.pragma('journal_mode = WAL');
            // Set busy timeout to handle concurrent access
            db.pragma('busy_timeout = 5000');
        } catch (error) {
            throw new Error(`Failed to open database at ${dbPath}: ${error.message}`);
        }
    }
    return db;
}

function initDB() {
    return new Promise((resolve, reject) => {
        try {
            const database = getDB();

            database.exec(`CREATE TABLE IF NOT EXISTS depth_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT NOT NULL,
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                bid_depth_value REAL NOT NULL,
                ask_depth_value REAL NOT NULL,
                mid_price REAL,
                bid_quantity REAL,
                ask_quantity REAL
            )`);

            // Create index for better query performance
            database.exec(`CREATE INDEX IF NOT EXISTS idx_depth_logs_exchange_symbol_timestamp
                ON depth_logs(exchange, symbol, timestamp)`);

            // Attempt to add columns if they don't exist (for migration)
            const columns = ['mid_price', 'bid_quantity', 'ask_quantity'];
            columns.forEach(col => {
                try {
                    database.exec(`ALTER TABLE depth_logs ADD COLUMN ${col} REAL`);
                } catch (err) {
                    // Ignore error if column exists
                    if (!err.message.includes('duplicate column name')) {
                        console.error(`Error adding column ${col}:`, err.message);
                    }
                }
            });

            database.exec(`CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT NOT NULL,
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                message TEXT NOT NULL
            )`);

            // Create index for alerts
            database.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_exchange_symbol_timestamp
                ON alerts(exchange, symbol, timestamp)`);

            resolve();
        } catch (err) {
            reject(new Error(`Failed to initialize database: ${err.message}`));
        }
    });
}

function logDepth(exchange, symbol, timestamp, bidDepth, askDepth, midPrice, bidQuantity, askQuantity) {
    try {
        const database = getDB();
        const stmt = database.prepare(`INSERT INTO depth_logs
            (exchange, symbol, timestamp, bid_depth_value, ask_depth_value, mid_price, bid_quantity, ask_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(exchange, symbol, timestamp, bidDepth, askDepth, midPrice, bidQuantity, askQuantity);
    } catch (error) {
        console.error(`Failed to log depth for ${exchange} ${symbol}:`, error.message);
    }
}

function logAlert(exchange, symbol, timestamp, message) {
    try {
        const database = getDB();
        const stmt = database.prepare(`INSERT INTO alerts
            (exchange, symbol, timestamp, message)
            VALUES (?, ?, ?, ?)`);
        stmt.run(exchange, symbol, timestamp, message);
    } catch (error) {
        console.error(`Failed to log alert for ${exchange} ${symbol}:`, error.message);
    }
}

function closeDB() {
    if (db) {
        try {
            db.close();
            db = null;
        } catch (error) {
            console.error('Error closing database:', error.message);
        }
    }
}

module.exports = { initDB, logDepth, logAlert, closeDB };
