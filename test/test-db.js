const { initDB, logDepth, logAlert } = require('../src/db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function testDB() {
    try {
        await initDB();
        console.log('DB Initialized');

        const timestamp = Date.now();
        logDepth('binance', 'BTC/USDT', timestamp, 1000, 2000);
        console.log('Logged depth');

        logAlert('binance', 'BTC/USDT', timestamp, 'Test Alert');
        console.log('Logged alert');

        // Wait for async inserts
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify data
        const dbPath = path.join(__dirname, '../monitor.db');
        const db = new sqlite3.Database(dbPath);

        db.get("SELECT * FROM depth_logs WHERE timestamp = ?", [timestamp], (err, row) => {
            if (err) throw err;
            if (row && row.bid_depth_value === 1000) {
                console.log('Verified depth log:', row);
            } else {
                console.error('Failed to verify depth log');
            }
        });

        db.get("SELECT * FROM alerts WHERE timestamp = ?", [timestamp], (err, row) => {
            if (err) throw err;
            if (row && row.message === 'Test Alert') {
                console.log('Verified alert log:', row);
            } else {
                console.error('Failed to verify alert log');
            }
        });

    } catch (error) {
        console.error('DB test failed:', error);
    }
}

testDB();
