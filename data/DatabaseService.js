const db = require('./database');

class DatabaseService {
    getScenarios(callback) {
        db.all('SELECT * FROM scenarios', [], (err, rows) => {
            if (err) {
                console.error('[sync] Error fetching scenarios:', err);
                return callback(err);
            }
            callback(null, rows);
        });
    }

    getScenarioById(id, callback) {
        db.get('SELECT * FROM scenarios WHERE id = ?', [id], (err, row) => {
            if (err) {
                return callback(err);
            }
            if (!row) {
                return callback(new Error('Scenario not found'));
            }
            callback(null, row);
        });
    }

    getCharactersByScenarioId(scenarioId, callback) {
        db.all(
            'SELECT * FROM characters WHERE scenario_id = ? ORDER BY sort_order ASC',
            [scenarioId],
            (err, rows) => {
                if (err) {
                    return callback(err);
                }
                callback(null, rows);
            }
        );
    }

    syncScenario(scenarioData, callback) {
        const { id, title, description, theme_json, events_json, characters } = scenarioData;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const scenarioQuery = `
                INSERT INTO scenarios (id, title, description, theme_json, events_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    theme_json = excluded.theme_json,
                    events_json = excluded.events_json;
            `;

            db.run(scenarioQuery, [id, title, description, theme_json, events_json], (err) => {
                if (err) {
                    console.error('[sync] Error syncing scenario:', err);
                    db.run('ROLLBACK;');
                    return callback(err);
                }

                db.run('DELETE FROM characters WHERE scenario_id = ?', [id], (err) => {
                    if (err) {
                        console.error('[sync] Error deleting old characters:', err);
                        db.run('ROLLBACK;');
                        return callback(err);
                    }

                    const charInsert = db.prepare(
                        'INSERT INTO characters (scenario_id, name, bio, secret) VALUES (?, ?, ?, ?)'
                    );
                    (characters || []).forEach((char) => {
                        charInsert.run(id, char.name, char.bio, char.secret);
                    });

                    charInsert.finalize((err) => {
                        if (err) {
                            console.error('[sync] Error inserting characters:', err);
                            db.run('ROLLBACK;');
                            return callback(err);
                        }

                        db.run('COMMIT;', (err) => {
                            if (err) {
                                console.error('[sync] Error committing transaction:', err);
                                return callback(err);
                            }
                            callback(null);
                        });
                    });
                });
            });
        });
    }
}

module.exports = new DatabaseService();
