const fs = require('fs');
const path = require('path');

/** Authoring format on disk — imported into SQLite by `syncScenariosFromJson` (server start / `npm run seed`). */
const SCENARIOS_DIR = path.join(__dirname, '../scenarios');

class ScenarioLoader {
    static loadAll() {
        if (!fs.existsSync(SCENARIOS_DIR)) {
            return [];
        }
        const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.json'));
        const scenarios = [];
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');
                const data = JSON.parse(raw);
                if (data && data.id && data.title && Array.isArray(data.cast)) {
                    scenarios.push(data);
                }
            } catch (e) {
                console.warn(`[ScenarioLoader] Skipping invalid scenario file: ${file}`, e.message);
            }
        }
        return scenarios;
    }

    static getById(id) {
        if (typeof id !== 'string' || id.length > 64) {
            return null;
        }
        return this.loadAll().find((s) => s.id === id) || null;
    }
}

module.exports = ScenarioLoader;
