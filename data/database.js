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
                // Scenarios table doesn't exist, so no migration needed, it will be created.
                return callback(null); 
            }

            const sql = row.sql;
            const hasEventsJson = /events_json/i.test(sql);

            if (!hasEventsJson) {
                console.log('[database] Schema is outdated, adding events_json column.');
                db.exec('ALTER TABLE scenarios ADD COLUMN events_json TEXT', callback);
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
        CREATE TABLE IF NOT EXISTS persisted_rooms (
            room_code TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        `,
        callback
    );
}

function initDatabase(callback) {
    createTables((err) => {
        if (err) {
            return callback(err);
        }
        migrateIfNeeded(callback);
    });
}

db.initDatabase = initDatabase;

module.exports = db;
