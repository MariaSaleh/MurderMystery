const db = require('./database');
const ScenarioLoader = require('./ScenarioLoader');

/**
 * Replaces scenario rows in SQLite with the contents of scenarios/*.json
 * (edit JSON files, then restart the server or run `npm run seed`).
 */
function syncScenariosFromJson(callback) {
    const scenarios = ScenarioLoader.loadAll();
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('DELETE FROM characters');
        db.run('DELETE FROM scenarios', (err) => {
            if (err) {
                db.run('ROLLBACK');
                return callback(err);
            }

            let idx = 0;
            function nextScenario() {
                if (idx >= scenarios.length) {
                    db.run('COMMIT', (e) => {
                        if (e) {
                            return callback(e);
                        }
                        console.log(`[sync] Loaded ${scenarios.length} scenario(s) from JSON into SQLite.`);
                        callback(null);
                    });
                    return;
                }

                const s = scenarios[idx];
                idx += 1;
                db.run(
                    'INSERT INTO scenarios (id, title, description, theme_json, events_json) VALUES (?,?,?,?,?)',
                    [s.id, s.title, s.description || '', JSON.stringify(s.theme ?? null), JSON.stringify(s.events ?? [])],
                    (e2) => {
                        if (e2) {
                            db.run('ROLLBACK');
                            return callback(e2);
                        }
                        const cast = s.cast || [];
                        let cidx = 0;
                        function nextChar() {
                            if (cidx >= cast.length) {
                                nextScenario();
                                return;
                            }
                            const c = cast[cidx];
                            const order = cidx;
                            cidx += 1;
                            db.run(
                                'INSERT INTO characters (scenario_id, sort_order, name, bio, secret) VALUES (?,?,?,?,?)',
                                [s.id, order, c.name, c.bio, c.secret],
                                (e3) => {
                                    if (e3) {
                                        db.run('ROLLBACK');
                                        return callback(e3);
                                    }
                                    nextChar();
                                }
                            );
                        }
                        nextChar();
                    }
                );
            }
            nextScenario();
        });
    });
}

module.exports = { syncScenariosFromJson };
