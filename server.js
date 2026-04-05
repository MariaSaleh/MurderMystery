const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./data/database');
const DatabaseService = require('./data/DatabaseService');
const { syncScenariosFromJson } = require('./data/syncScenariosFromJson');
const { createExtensionState } = require('./data/sessionExtensions');
const { attachSessionFeatureHandlers } = require('./socket/sessionFeatureHandlers');
const { timingSafeEqualToken } = require('./serverRoomUtils');
const GameManager = require('./classes/GameManager');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();

/** Isolated session state per room code — each group is independent. */
const rooms = new Map();

app.set('trust proxy', 1);

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    })
);

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

const uploadRoot = path.join(__dirname, 'uploads');
const upload = multer({
    storage: multer.diskStorage({
        destination(req, _file, cb) {
            const dir = path.join(uploadRoot, 'sessions', req.params.sessionId);
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename(_req, file, cb) {
            const ext = path.extname(file.originalname || '') || '';
            cb(null, `${crypto.randomUUID()}${ext}`);
        },
    }),
    limits: { fileSize: 12 * 1024 * 1024 },
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

function findRoomBySessionId(sessionId) {
    for (const room of rooms.values()) {
        if (room.sessionId === sessionId) {
            return room;
        }
    }
    return null;
}

app.use('/uploads', express.static(uploadRoot));

app.post('/api/sessions/:sessionId/upload', uploadLimiter, upload.single('file'), (req, res) => {
    const { sessionId } = req.params;
    const room = findRoomBySessionId(sessionId);
    if (!room) {
        return res.status(404).json({ ok: false, error: 'Session not found.' });
    }
    const token = req.headers['x-host-token'];
    if (typeof token !== 'string' || !timingSafeEqualToken(token, room.hostToken)) {
        return res.status(403).json({ ok: false, error: 'Forbidden.' });
    }
    if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No file uploaded.' });
    }
    const publicUrl = `/uploads/sessions/${sessionId}/${req.file.filename}`;
    const meta = {
        id: crypto.randomUUID(),
        originalName: req.file.originalname || 'file',
        url: publicUrl,
        uploadedAt: Date.now(),
    };
    room.extensions.documents.push(meta);
    res.json({ ok: true, document: meta });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'] }));

app.get('/sw.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/health', (_req, res) => {
    res.json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: false,
    },
});

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
        code += ROOM_CODE_CHARS[crypto.randomInt(0, ROOM_CODE_CHARS.length)];
    }
    return rooms.has(code) ? generateRoomCode() : code;
}

function sanitizeDisplayName(raw) {
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 1 || trimmed.length > 40) {
        return null;
    }
    if (/[<>]/.test(trimmed)) {
        return null;
    }
    return trimmed;
}

function getRoomOrEmitError(socket, roomCode, eventName) {
    const room = rooms.get(roomCode);
    if (!room) {
        socket.emit(eventName, { ok: false, error: 'Room not found or expired.' });
        return null;
    }
    return room;
}

function broadcastLobby(roomCode, room) {
    const names = room.game
        ? room.game.getPlayerNames()
        : Array.from(room.prePlayers.values()).map(p => p.name);
    io.to(roomCode).emit('lobby:players', names);
}

io.on('connection', (socket) => {
    let joinedRoom = null;

    attachSessionFeatureHandlers(socket, io, rooms);

    socket.on('catalog:request', () => {
        DatabaseService.getScenarios((err, catalog) => {
            if (err) {
                console.error('[catalog]', err);
                socket.emit('catalog:data', []);
            } else {
                socket.emit('catalog:data', catalog);
            }
        });
    });

    socket.on('room:create', (payload) => {
        const hostName = sanitizeDisplayName(payload?.hostName);
        if (!hostName) {
            socket.emit('room:createResult', { ok: false, error: 'Enter your name as host (1–40 characters).' });
            return;
        }
        const roomCode = generateRoomCode();
        const hostToken = crypto.randomBytes(32);
        const sessionId = crypto.randomUUID();
        rooms.set(roomCode, {
            sessionId,
            hostSocketId: socket.id,
            hostDisplayName: hostName,
            hostToken,
            game: null,
            scenarioMeta: null,
            prePlayers: new Map(),
            extensions: createExtensionState(),
        });
        socket.join(roomCode);
        joinedRoom = roomCode;
        socket.emit('room:created', {
            roomCode,
            sessionId,
            role: 'admin',
            hostToken: hostToken.toString('hex'),
        });
        socket.emit('room:createResult', { ok: true });
        broadcastLobby(roomCode, rooms.get(roomCode));
    });

    socket.on('room:join', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const name = sanitizeDisplayName(payload?.name);
        if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
            socket.emit('room:joinResult', { ok: false, error: 'Enter a valid 6-character room code.' });
            return;
        }
        if (!name) {
            socket.emit('room:joinResult', { ok: false, error: 'Enter a display name (1–40 characters).' });
            return;
        }
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('room:joinResult', { ok: false, error: 'Room not found. Check the code with your host.' });
            return;
        }
        socket.join(roomCode);
        joinedRoom = roomCode;

        const playerId = crypto.randomUUID();

        if (room.game) {
            const player = room.game.addPlayer(socket.id, name);
            player.playerId = playerId;
        } else {
            const player = { id: socket.id, name, playerId };
            room.prePlayers.set(socket.id, player);
        }
        broadcastLobby(roomCode, room);
        socket.emit('room:joinResult', {
            ok: true,
            roomCode,
            sessionId: room.sessionId,
            role: 'player',
            scenarioTitle: room.scenarioMeta ? room.scenarioMeta.title : null,
            playerId,
        });
    });

    socket.on('session:rejoin', (payload) => {
        const { roomCode, playerId } = payload;
        const room = rooms.get(roomCode);

        if (!room) return;

        let playerEntry = null;
        let oldSocketId = null;

        const playersSource = room.game ? room.game.players : room.prePlayers;

        for (const [sid, p] of playersSource.entries()) {
            if (p.playerId === playerId) {
                playerEntry = p;
                oldSocketId = sid;
                break;
            }
        }

        if (playerEntry) {
            if (oldSocketId) playersSource.delete(oldSocketId);
            playerEntry.id = socket.id;
            playersSource.set(socket.id, playerEntry);

            socket.join(roomCode);
            joinedRoom = roomCode;
            broadcastLobby(roomCode, room);

            if (room.game) {
                room.game.reconnectPlayer(socket.id, playerEntry);
            }

            socket.emit('room:joinResult', {
                ok: true,
                roomCode,
                sessionId: room.sessionId,
                role: 'player',
                scenarioTitle: room.scenarioMeta ? room.scenarioMeta.title : null,
                playerId,
            });
        }
    });

    socket.on('session:rejoinHost', (payload) => {
        const { roomCode, hostToken } = payload;
        const room = rooms.get(roomCode);
    
        if (room && room.hostToken && timingSafeEqualToken(hostToken, room.hostToken)) {
            room.hostSocketId = socket.id;
            socket.join(roomCode);
            joinedRoom = roomCode;
    
            socket.emit('room:createResult', { ok: true });
            socket.emit('room:created', {
                roomCode,
                sessionId: room.sessionId,
                role: 'admin',
                hostToken: room.hostToken.toString('hex'),
            });
            
            if (room.scenarioMeta) {
                socket.emit('scenario:mountResult', { ok: true });
                socket.emit('scenario:mounted', { title: room.scenarioMeta.title });
            }
            
            if (room.game && room.game.state === 'ACTIVE') {
                socket.emit('game:started', {
                    scenarioTitle: room.game.scenario.title,
                    sessionId: room.sessionId,
                });
            }
            
            broadcastLobby(roomCode, room);
        } else {
            socket.emit('session:ended', { message: 'Your previous session expired.' });
        }
    });

    socket.on('scenario:mount', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const scenarioId = typeof payload?.scenarioId === 'string' ? payload.scenarioId : '';
        const hostToken = typeof payload?.hostToken === 'string' ? payload.hostToken : '';
        if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
            socket.emit('scenario:mountResult', { ok: false, error: 'Invalid room.' });
            return;
        }
        const room = getRoomOrEmitError(socket, roomCode, 'scenario:mountResult');
        if (!room) {
            return;
        }
        if (!timingSafeEqualToken(hostToken, room.hostToken)) {
            socket.emit('scenario:mountResult', { ok: false, error: 'Not authorized to run this room.' });
            return;
        }
        DatabaseService.getScenarioById(scenarioId, (err, scenarioData) => {
            if (err) {
                console.error('[scenario:mount] getScenarioById', err);
                socket.emit('scenario:mountResult', { ok: false, error: 'Could not load scenario.' });
                return;
            }
            if (!scenarioData) {
                socket.emit('scenario:mountResult', { ok: false, error: 'Unknown scenario.' });
                return;
            }

            DatabaseService.getCharactersByScenarioId(scenarioId, (charErr, characters) => {
                if (charErr) {
                    console.error('[scenario:mount] getCharacters', charErr);
                    socket.emit('scenario:mountResult', { ok: false, error: 'Could not load scenario characters.' });
                    return;
                }

                const fullScenario = { ...scenarioData, cast: characters };

                if (room.game && room.game.state !== 'LOBBY') {
                    socket.emit('scenario:mountResult', { ok: false, error: 'The investigation has already begun.' });
                    return;
                }

                const gm = new GameManager(io, fullScenario, roomCode);
                for (const p of room.prePlayers.values()) {
                    const newPlayer = gm.addPlayer(p.id, p.name);
                    newPlayer.playerId = p.playerId;
                }
                room.prePlayers.clear();

                room.game = gm;
                room.scenarioMeta = { id: fullScenario.id, title: fullScenario.title };

                io.to(roomCode).emit('scenario:mounted', {
                    title: fullScenario.title,
                    description: fullScenario.description,
                    theme: fullScenario.theme || null,
                });

                broadcastLobby(roomCode, room);
                socket.emit('scenario:mountResult', { ok: true });
            });
        });
    });

    socket.on('game:start', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const hostToken = typeof payload?.hostToken === 'string' ? payload.hostToken : '';
        if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
            socket.emit('game:startResult', { ok: false, error: 'Invalid room.' });
            return;
        }
        const room = getRoomOrEmitError(socket, roomCode, 'game:startResult');
        if (!room) {
            return;
        }
        if (!timingSafeEqualToken(hostToken, room.hostToken)) {
            socket.emit('game:startResult', { ok: false, error: 'Not authorized to start the game.' });
            return;
        }
        if (!room.game) {
            socket.emit('game:startResult', { ok: false, error: 'Select a scenario first.' });
            return;
        }
        const result = room.game.startGame();
        if (!result.success) {
            socket.emit('game:startResult', { ok: false, error: result.error || 'Cannot start.' });
            return;
        }
        io.to(roomCode).emit('game:started', {
            scenarioTitle: room.game.scenario.title,
            sessionId: room.sessionId,
        });
        socket.emit('game:startResult', { ok: true });
    });

    socket.on('admin:event', (payload) => {
        const { roomCode, hostToken, message, users } = payload;

        if (typeof roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(roomCode)) {
            return;
        }

        const room = rooms.get(roomCode);
        if (!room) {
            return;
        }

        if (!timingSafeEqualToken(hostToken, room.hostToken)) {
            return;
        }

        if (!message || typeof message !== 'string') {
            return;
        }

        const eventPayload = { title: 'Admin Event', body: message };

        if (users && users.length > 0) {
            if (users.includes('all')) {
                io.to(roomCode).emit('feature:notify:toast', eventPayload);
            } else if (room.game) {
                for (const [socketId, player] of room.game.players.entries()) {
                    if (users.includes(player.name)) {
                        io.to(socketId).emit('feature:notify:toast', eventPayload);
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
        if (!joinedRoom) return;
        const room = rooms.get(joinedRoom);
        if (!room) return;

        const oldSocketId = socket.id;
        const timeout = 30000; // 30 seconds

        setTimeout(() => {
            const currentRoom = rooms.get(joinedRoom);
            if (!currentRoom) return;

            // If the host disconnected and did not reconnect, end the session
            if (currentRoom.hostSocketId === oldSocketId) {
                io.to(joinedRoom).emit('session:ended', {
                    reason: 'host_left',
                    message: 'The host left; this session has ended.',
                });
                rooms.delete(joinedRoom);
                return;
            }

            // If a player disconnected and did not reconnect, remove them
            let playerRemoved = false;
            const playersSource = currentRoom.game ? currentRoom.game.players : currentRoom.prePlayers;
            if (playersSource.has(oldSocketId)) {
                playersSource.delete(oldSocketId);
                playerRemoved = true;
            }

            if (playerRemoved) {
                broadcastLobby(joinedRoom, currentRoom);
            }
        }, timeout);
    });
});

db.initDatabase((err) => {
    if (err) {
        console.error('[database]', err);
        process.exit(1);
    }
    syncScenariosFromJson((e2) => {
        if (e2) {
            console.error('[sync]', e2);
            process.exit(1);
        }
        server.listen(PORT, () => {
            console.log(`Murder Mystery server listening on http://localhost:${PORT}`);
        });
    });
});
