const db = require('./database');
const { syncScenariosFromJson } = require('./syncScenariosFromJson');

db.initDatabase((err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    syncScenariosFromJson((e) => {
        if (e) {
            console.error(e);
            process.exit(1);
        }
        process.exit(0);
    });
});
