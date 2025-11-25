const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../monitor.db');
const db = new sqlite3.Database(dbPath);

function initDB() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS depth_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT,
        symbol TEXT,
        timestamp INTEGER,
        bid_depth_value REAL,
        ask_depth_value REAL
      )`);

            db.run(`CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT,
        symbol TEXT,
        timestamp INTEGER,
        message TEXT
      )`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function logDepth(exchange, symbol, timestamp, bidDepth, askDepth) {
    const stmt = db.prepare("INSERT INTO depth_logs (exchange, symbol, timestamp, bid_depth_value, ask_depth_value) VALUES (?, ?, ?, ?, ?)");
    stmt.run(exchange, symbol, timestamp, bidDepth, askDepth);
    stmt.finalize();
}

function logAlert(exchange, symbol, timestamp, message) {
    const stmt = db.prepare("INSERT INTO alerts (exchange, symbol, timestamp, message) VALUES (?, ?, ?, ?)");
    stmt.run(exchange, symbol, timestamp, message);
    stmt.finalize();
}

module.exports = { initDB, logDepth, logAlert };
