const db = require('./database');

const PERSIST_VERSION = 1;
const persistTimers = new Map();

function offlineSocketId(playerId) {
    return `__offline__${playerId}`;
}

function socketToPlayerId(room, socketId) {
    if (!socketId || typeof socketId !== 'string') {
        return null;
    }
    if (socketId.startsWith('__offline__')) {
        return socketId.slice('__offline__'.length) || null;
    }
    const pre = room.prePlayers.get(socketId);
    if (pre && pre.playerId) {
        return pre.playerId;
    }
    if (room.game) {
        const pl = room.game.players.get(socketId);
        if (pl && pl.playerId) {
            return pl.playerId;
        }
    }
    return null;
}

function serializeExtensions(room) {
    const inv = room.extensions.investigations || { version: 0, data: {} };
    const clues = {};
    for (const [id, c] of Object.entries(room.extensions.clues || {})) {
        const targetPlayerId = socketToPlayerId(room, c.targetSocketId);
        clues[id] = { text: c.text, givenAt: c.givenAt, targetPlayerId };
    }
    const notificationLog = (room.extensions.notificationLog || []).map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt,
        targetPlayerId: socketToPlayerId(room, n.targetSocketId),
    }));
    return {
        investigations: { version: inv.version, data: { ...inv.data } },
        clues,
        notificationLog,
        documents: [...(room.extensions.documents || [])],
        chatMessages: [...(room.extensions.chatMessages || [])],
    };
}

function deserializeExtensions(extPayload, createExtensionState) {
    const ext = createExtensionState();
    const inv = extPayload.investigations || {};
    ext.investigations.version = typeof inv.version === 'number' ? inv.version : 0;
    ext.investigations.data = inv.data && typeof inv.data === 'object' ? { ...inv.data } : {};
    ext.documents = Array.isArray(extPayload.documents) ? [...extPayload.documents] : [];
    ext.chatMessages = Array.isArray(extPayload.chatMessages) ? [...extPayload.chatMessages] : [];
    for (const [id, c] of Object.entries(extPayload.clues || {})) {
        const sid = c.targetPlayerId ? offlineSocketId(c.targetPlayerId) : '';
        if (sid) {
            ext.clues[id] = {
                targetSocketId: sid,
                text: c.text || '',
                givenAt: c.givenAt || Date.now(),
            };
        }
    }
    for (const n of extPayload.notificationLog || []) {
        const sid = n.targetPlayerId ? offlineSocketId(n.targetPlayerId) : '';
        ext.notificationLog.push({
            id: n.id,
            targetSocketId: sid,
            title: n.title,
            body: n.body,
            createdAt: n.createdAt,
        });
    }
    return ext;
}

function serializeRoom(room) {
    const prePlayers = [];
    for (const p of room.prePlayers.values()) {
        prePlayers.push({ playerId: p.playerId, name: p.name });
    }
    let game = null;
    if (room.game) {
        const players = [];
        for (const pl of room.game.players.values()) {
            players.push({
                playerId: pl.playerId,
                name: pl.name,
                character: pl.character || null,
            });
        }
        game = {
            state: room.game.state,
            killer: room.game.killer,
            scenarioId: room.game.scenario.id,
            players,
        };
    }
    return {
        version: PERSIST_VERSION,
        sessionId: room.sessionId,
        hostTokenHex: room.hostToken.toString('hex'),
        hostDisplayName: room.hostDisplayName,
        scenarioMeta: room.scenarioMeta,
        prePlayers,
        game,
        extensions: serializeExtensions(room),
    };
}

function rowToFullScenario(scenarioData, characters) {
    let theme = null;
    const tj = scenarioData.theme_json;
    if (typeof tj === 'string' && tj) {
        try {
            theme = JSON.parse(tj);
        } catch {
            theme = null;
        }
    }
    return {
        ...scenarioData,
        theme,
        cast: characters,
    };
}

/**
 * @param {import('socket.io').Server} io
 * @param {string} roomCode
 * @param {object} payload
 * @param {object | null} fullScenario required when payload.game is set
 * @param {typeof import('../classes/GameManager')} GameManager
 * @param {typeof import('./sessionExtensions').createExtensionState} createExtensionState
 */
function rehydrateRoom(io, roomCode, payload, fullScenario, GameManager, createExtensionState) {
    const hostToken = Buffer.from(payload.hostTokenHex, 'hex');
    if (hostToken.length !== 32) {
        throw new Error('Invalid host token in persisted room');
    }
    const room = {
        sessionId: payload.sessionId,
        hostSocketId: null,
        hostDisplayName: payload.hostDisplayName,
        hostToken,
        game: null,
        scenarioMeta: payload.scenarioMeta || null,
        prePlayers: new Map(),
        extensions: deserializeExtensions(payload.extensions || {}, createExtensionState),
    };

    if (payload.game && fullScenario) {
        const gm = new GameManager(io, fullScenario, roomCode);
        gm.state = payload.game.state;
        gm.killer = payload.game.killer;
        for (const p of payload.game.players || []) {
            const sid = offlineSocketId(p.playerId);
            const plr = gm.addPlayer(sid, p.name);
            plr.playerId = p.playerId;
            if (p.character) {
                plr.assignCharacter(p.character);
            }
        }
        room.game = gm;
    } else {
        for (const p of payload.prePlayers || []) {
            const sid = offlineSocketId(p.playerId);
            room.prePlayers.set(sid, { id: sid, name: p.name, playerId: p.playerId });
        }
    }
    return room;
}

function persistRoomToDb(roomCode, room, callback) {
    let json;
    try {
        json = JSON.stringify(serializeRoom(room));
    } catch (e) {
        return callback(e);
    }
    const sql = `INSERT INTO persisted_rooms (room_code, data_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(room_code) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`;
    db.run(sql, [roomCode, json, Date.now()], (err) => callback(err));
}

function schedulePersistRoom(rooms, roomCode) {
    if (!roomCode || !rooms.get(roomCode)) {
        return;
    }
    const prev = persistTimers.get(roomCode);
    if (prev) {
        clearTimeout(prev);
    }
    persistTimers.set(
        roomCode,
        setTimeout(() => {
            persistTimers.delete(roomCode);
            const room = rooms.get(roomCode);
            if (!room) {
                return;
            }
            persistRoomToDb(roomCode, room, (err) => {
                if (err) {
                    console.error('[persist] Failed to save room', roomCode, err);
                }
            });
        }, 350)
    );
}

function deletePersistedRoom(roomCode, callback) {
    const prev = persistTimers.get(roomCode);
    if (prev) {
        clearTimeout(prev);
        persistTimers.delete(roomCode);
    }
    db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], (err) => {
        if (callback) {
            callback(err);
        }
    });
}

/**
 * @param {import('socket.io').Server} io
 * @param {Map<string, object>} rooms
 * @param {import('./DatabaseService')} DatabaseService
 * @param {typeof import('../classes/GameManager')} GameManager
 * @param {typeof import('./sessionExtensions').createExtensionState} createExtensionState
 */
function loadPersistedRooms(io, rooms, DatabaseService, GameManager, createExtensionState, callback) {
    db.all('SELECT room_code, data_json FROM persisted_rooms', [], (err, rows) => {
        if (err) {
            return callback(err);
        }
        if (!rows || !rows.length) {
            return callback(null);
        }

        let index = 0;
        function next() {
            if (index >= rows.length) {
                if (rows.length) {
                    console.log(`[persist] Restored ${rows.length} room(s) from disk.`);
                }
                return callback(null);
            }
            const row = rows[index];
            index += 1;
            const roomCode = row.room_code;
            let payload;
            try {
                payload = JSON.parse(row.data_json);
            } catch (e) {
                console.error('[persist] Invalid JSON for room', roomCode, e);
                return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
            }
            if (!payload || payload.version !== PERSIST_VERSION) {
                return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
            }

            if (payload.game) {
                DatabaseService.getScenarioById(payload.game.scenarioId, (e1, scenarioData) => {
                    if (e1 || !scenarioData) {
                        console.warn('[persist] Dropping room (scenario missing):', roomCode);
                        return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
                    }
                    DatabaseService.getCharactersByScenarioId(payload.game.scenarioId, (e2, characters) => {
                        if (e2) {
                            console.error('[persist] Characters load failed for', roomCode, e2);
                            return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
                        }
                        try {
                            const fullScenario = rowToFullScenario(scenarioData, characters);
                            const room = rehydrateRoom(io, roomCode, payload, fullScenario, GameManager, createExtensionState);
                            rooms.set(roomCode, room);
                        } catch (e) {
                            console.error('[persist] Rehydrate failed', roomCode, e);
                            return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
                        }
                        next();
                    });
                });
            } else {
                try {
                    const room = rehydrateRoom(io, roomCode, payload, null, GameManager, createExtensionState);
                    rooms.set(roomCode, room);
                } catch (e) {
                    console.error('[persist] Rehydrate failed', roomCode, e);
                    return db.run('DELETE FROM persisted_rooms WHERE room_code = ?', [roomCode], () => next());
                }
                next();
            }
        }
        next();
    });
}

module.exports = {
    schedulePersistRoom,
    deletePersistedRoom,
    loadPersistedRooms,
    persistRoomToDb,
    offlineSocketId,
};
