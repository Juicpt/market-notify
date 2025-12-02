const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../monitor.db');
const db = new Database(dbPath);

// Enable WAL mode
db.pragma('journal_mode = WAL');

function initDB() {
    return new Promise((resolve, reject) => {
        try {
            db.exec(`CREATE TABLE IF NOT EXISTS depth_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT,
                symbol TEXT,
                timestamp INTEGER,
                bid_depth_value REAL,
                ask_depth_value REAL,
                mid_price REAL,
                bid_quantity REAL,
                ask_quantity REAL
            )`);

            // Attempt to add columns if they don't exist (for migration)
            const columns = ['mid_price', 'bid_quantity', 'ask_quantity'];
            columns.forEach(col => {
                try {
                    db.exec(`ALTER TABLE depth_logs ADD COLUMN ${col} REAL`);
                } catch (err) {
                    // Ignore error if column exists
                    if (!err.message.includes('duplicate column name')) {
                        console.error(`Error adding column ${col}:`, err);
                    }
                }
            });

            db.exec(`CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT,
                symbol TEXT,
                timestamp INTEGER,
                message TEXT
            )`);

            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

function logDepth(exchange, symbol, timestamp, bidDepth, askDepth, midPrice, bidQuantity, askQuantity) {
    const stmt = db.prepare("INSERT INTO depth_logs (exchange, symbol, timestamp, bid_depth_value, ask_depth_value, mid_price, bid_quantity, ask_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(exchange, symbol, timestamp, bidDepth, askDepth, midPrice, bidQuantity, askQuantity);
}

function logAlert(exchange, symbol, timestamp, message) {
    const stmt = db.prepare("INSERT INTO alerts (exchange, symbol, timestamp, message) VALUES (?, ?, ?, ?)");
    stmt.run(exchange, symbol, timestamp, message);
}

module.exports = { initDB, logDepth, logAlert };
