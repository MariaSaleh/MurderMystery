const Player = require('./Player');

class GameManager {
    constructor(io, scenario, roomCode) {
        this.io = io;
        this.scenario = scenario;
        this.roomCode = roomCode;
        this.players = new Map(); // [socket.id, Player]
        this.state = 'LOBBY'; // LOBBY, ACTIVE, ENDED
        this.killer = null;
        this.disconnect_timeout = 30 * 1000; // 30 seconds
    }

    addPlayer(socketId, name) {
        const player = new Player(socketId, name);
        this.players.set(socketId, player);
        return player;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    findPlayerByPlayerId(playerId) {
        for (const player of this.players.values()) {
            if (player.playerId === playerId) {
                return player;
            }
        }
        return null;
    }

    reconnectPlayer(socketId, existingPlayer) {
        existingPlayer.id = socketId;
        this.players.set(socketId, existingPlayer);

        // Send the player their character info again
        if (existingPlayer.character) {
            this.io.to(socketId).emit('GAME_START', {
                scenarioTitle: this.scenario.title,
                theme: this.scenario.theme,
                dossier: {
                    character: existingPlayer.character,
                    isKiller: existingPlayer.character.name === this.killer,
                },
            });
        }
    }

    getPlayerNames() {
        return Array.from(this.players.values()).map(p => p.name);
    }

    startGame() {
        if (this.state !== 'LOBBY') {
            return { success: false, error: 'Game already started' };
        }

        const characters = [...this.scenario.cast];
        if (characters.length < this.players.size) {
            return { success: false, error: 'Not enough characters for all players.' };
        }

        // Assign killer
        const killerIndex = Math.floor(Math.random() * characters.length);
        this.killer = characters[killerIndex].name;

        // Assign characters to players
        for (const [socketId, player] of this.players.entries()) {
            const charIndex = Math.floor(Math.random() * characters.length);
            const assignedChar = characters.splice(charIndex, 1)[0];
            player.assignCharacter(assignedChar);

            const dossier = {
                character: assignedChar,
                isKiller: assignedChar.name === this.killer,
            };

            this.io.to(socketId).emit('GAME_START', {
                scenarioTitle: this.scenario.title,
                theme: this.scenario.theme,
                dossier,
            });
        }

        this.state = 'ACTIVE';
        return { success: true };
    }
}

module.exports = GameManager;
