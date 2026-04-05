const crypto = require('crypto');
const { timingSafeEqualToken } = require('../serverRoomUtils');

const MAX_CHAT = 2000;
const MAX_NOTIFY_TITLE = 120;
const MAX_NOTIFY_BODY = 4000;
const MAX_CLUE_TEXT = 8000;

function socketInRoom(socket, roomCode) {
    return socket.rooms && socket.rooms.has(roomCode);
}

function sanitizeShort(s, max) {
    if (typeof s !== 'string') {
        return '';
    }
    const t = s.trim().replace(/\s+/g, ' ');
    if (t.length > max) {
        return t.slice(0, max);
    }
    return t.replace(/[<>]/g, '');
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {Map<string, any>} rooms
 */
function attachSessionFeatureHandlers(socket, io, rooms) {
    function getRoomEntry(roomCode) {
        return rooms.get(roomCode) || null;
    }

    function isHost(room, sock) {
        return room.hostSocketId === sock.id;
    }

    function isParticipant(room, sock) {
        if (isHost(room, sock)) {
            return true;
        }
        if (room.prePlayers.has(sock.id)) {
            return true;
        }
        if (room.game && room.game.players.has(sock.id)) {
            return true;
        }
        return false;
    }

    function displayName(room, sock) {
        if (isHost(room, sock)) {
            return room.hostDisplayName;
        }
        if (room.prePlayers.has(sock.id)) {
            return room.prePlayers.get(sock.id).name;
        }
        if (room.game && room.game.players.has(sock.id)) {
            return room.game.players.get(sock.id).name;
        }
        return 'Guest';
    }

    socket.on('feature:investigation:patch', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const room = getRoomEntry(roomCode);
        if (!room || !socketInRoom(socket, roomCode) || !isParticipant(room, socket)) {
            socket.emit('feature:investigation:error', { error: 'Invalid session.' });
            return;
        }
        if (!isHost(room, socket)) {
            socket.emit('feature:investigation:error', { error: 'Only the room admin can update investigations.' });
            return;
        }
        if (!payload?.hostToken || typeof payload.hostToken !== 'string') {
            socket.emit('feature:investigation:error', { error: 'Unauthorized.' });
            return;
        }
        if (!timingSafeEqualToken(payload.hostToken, room.hostToken)) {
            socket.emit('feature:investigation:error', { error: 'Unauthorized.' });
            return;
        }
        const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
        room.extensions.investigations.data = { ...room.extensions.investigations.data, ...patch };
        room.extensions.investigations.version += 1;
        io.to(roomCode).emit('feature:investigation:sync', {
            version: room.extensions.investigations.version,
            data: room.extensions.investigations.data,
            sessionId: room.sessionId,
        });
    });

    socket.on('feature:clue:give', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const room = getRoomEntry(roomCode);
        if (!room || !socketInRoom(socket, roomCode)) {
            socket.emit('feature:clue:error', { error: 'Invalid session.' });
            return;
        }
        if (!isHost(room, socket)) {
            socket.emit('feature:clue:error', { error: 'Only the admin can assign clues.' });
            return;
        }
        if (!payload?.hostToken || typeof payload.hostToken !== 'string') {
            socket.emit('feature:clue:error', { error: 'Unauthorized.' });
            return;
        }
        if (!timingSafeEqualToken(payload.hostToken, room.hostToken)) {
            socket.emit('feature:clue:error', { error: 'Unauthorized.' });
            return;
        }
        const targetSocketId = typeof payload.targetSocketId === 'string' ? payload.targetSocketId : '';
        if (!targetSocketId || (!room.prePlayers.has(targetSocketId) && !(room.game && room.game.players.has(targetSocketId)))) {
            socket.emit('feature:clue:error', { error: 'Invalid player.' });
            return;
        }
        const clueId = typeof payload.clueId === 'string' && payload.clueId.length <= 64 ? payload.clueId : crypto.randomUUID();
        const text = sanitizeShort(payload.text, MAX_CLUE_TEXT);
        room.extensions.clues[clueId] = { targetSocketId, text, givenAt: Date.now() };
        io.to(targetSocketId).emit('feature:clue:received', {
            clueId,
            text,
            sessionId: room.sessionId,
        });
    });

    socket.on('feature:notify:send', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const room = getRoomEntry(roomCode);
        if (!room || !socketInRoom(socket, roomCode)) {
            socket.emit('feature:notify:error', { error: 'Invalid session.' });
            return;
        }
        if (!isHost(room, socket)) {
            socket.emit('feature:notify:error', { error: 'Only the admin can push notifications.' });
            return;
        }
        if (!payload?.hostToken || typeof payload.hostToken !== 'string') {
            socket.emit('feature:notify:error', { error: 'Unauthorized.' });
            return;
        }
        if (!timingSafeEqualToken(payload.hostToken, room.hostToken)) {
            socket.emit('feature:notify:error', { error: 'Unauthorized.' });
            return;
        }
        const targetSocketId = typeof payload.targetSocketId === 'string' ? payload.targetSocketId : '';
        if (!targetSocketId || (!room.prePlayers.has(targetSocketId) && !(room.game && room.game.players.has(targetSocketId)))) {
            socket.emit('feature:notify:error', { error: 'Invalid player.' });
            return;
        }
        const title = sanitizeShort(payload.title, MAX_NOTIFY_TITLE);
        const body = sanitizeShort(payload.body, MAX_NOTIFY_BODY);
        const id = crypto.randomUUID();
        room.extensions.notificationLog.push({
            id,
            targetSocketId,
            title,
            body,
            createdAt: Date.now(),
        });
        io.to(targetSocketId).emit('feature:notify:toast', {
            id,
            title,
            body,
            sessionId: room.sessionId,
        });
    });

    socket.on('feature:chat:send', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const room = getRoomEntry(roomCode);
        if (!room || !socketInRoom(socket, roomCode) || !isParticipant(room, socket)) {
            socket.emit('feature:chat:error', { error: 'Invalid session.' });
            return;
        }
        const text = sanitizeShort(payload?.text, MAX_CHAT);
        if (!text) {
            return;
        }
        const id = crypto.randomUUID();
        const from = displayName(room, socket);
        const entry = { id, from, text, ts: Date.now() };
        room.extensions.chatMessages.push(entry);
        if (room.extensions.chatMessages.length > 200) {
            room.extensions.chatMessages.splice(0, room.extensions.chatMessages.length - 200);
        }
        io.to(roomCode).emit('feature:chat:message', {
            ...entry,
            sessionId: room.sessionId,
        });
    });

    socket.on('feature:document:list', (payload) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const room = getRoomEntry(roomCode);
        if (!room || !socketInRoom(socket, roomCode) || !isParticipant(room, socket)) {
            socket.emit('feature:document:listResult', { ok: false, error: 'Invalid session.' });
            return;
        }
        socket.emit('feature:document:listResult', {
            ok: true,
            items: room.extensions.documents,
            sessionId: room.sessionId,
        });
    });
}

module.exports = { attachSessionFeatureHandlers };
