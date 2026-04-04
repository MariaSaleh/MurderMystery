const db = require('./database');

class DatabaseService {
    static getCatalog() {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT id, title, description, theme_json, events_json FROM scenarios ORDER BY title COLLATE NOCASE',
                [],
                (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(
                        (rows || []).map((r) => ({
                            id: r.id,
                            title: r.title,
                            description: r.description,
                            theme: r.theme_json ? safeJsonParse(r.theme_json) : null,
                            events: r.events_json ? safeJsonParse(r.events_json) : [],
                        }))
                    );
                }
            );
        });
    }

    static getScenarioById(id) {
        if (typeof id !== 'string' || id.length > 64) {
            return Promise.resolve(null);
        }
        return new Promise((resolve, reject) => {
            db.get('SELECT id, title, description, theme_json, events_json FROM scenarios WHERE id = ?', [id], (err, scenarioRow) => {
                if (err) {
                    return reject(err);
                }
                if (!scenarioRow) {
                    return resolve(null);
                }
                db.all(
                    'SELECT name, bio, secret FROM characters WHERE scenario_id = ? ORDER BY sort_order ASC, id ASC',
                    [id],
                    (err2, castRows) => {
                        if (err2) {
                            return reject(err2);
                        }
                        resolve({
                            id: scenarioRow.id,
                            title: scenarioRow.title,
                            description: scenarioRow.description,
                            theme: scenarioRow.theme_json ? safeJsonParse(scenarioRow.theme_json) : null,
                            events: scenarioRow.events_json ? safeJsonParse(scenarioRow.events_json) : [],
                            cast: (castRows || []).map((c) => ({
                                name: c.name,
                                bio: c.bio,
                                secret: c.secret,
                            })),
                        });
                    }
                );
            });
        });
    }
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

module.exports = DatabaseService;
