const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../mystery.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

function migrateIfNeeded(callback) {
    db.get(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='scenarios'",
        [],
        (e, row) => {
            if (e) {
                return callback(e);
            }
            if (!row) {
                return callback(null); // No table, no migration needed
            }
            const sql = row.sql;
            const isOldIntegerId = /id\s+INTEGER\s+PRIMARY\s+KEY/i.test(sql);
            const hasEventsJson = /events_json/i.test(sql);

            if (isOldIntegerId || !hasEventsJson) {
                console.log('[database] Schema is outdated, recreating tables.');
                db.exec('DROP TABLE IF EXISTS characters; DROP TABLE IF EXISTS scenarios;', callback);
            } else {
                callback(null);
            }
        }
    );
}

function createTables(callback) {
    db.exec(
        `
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            theme_json TEXT,
            events_json TEXT
        );
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL,
            bio TEXT,
            secret TEXT,
            FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );
        `,
        callback
    );
}

function initDatabase(callback) {
    migrateIfNeeded((err) => {
        if (err) {
            return callback(err);
        }
        createTables(callback);
    });
}

db.initDatabase = initDatabase;

module.exports = db;
