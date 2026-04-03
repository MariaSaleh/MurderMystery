const crypto = require('crypto');
const Player = require('./Player');

class GameManager {
    constructor(io, scenario, roomId) {
        this.io = io;
        this.scenario = scenario;
        this.roomId = roomId;
        this.players = new Map();
        this.state = 'LOBBY';
    }

    addPlayer(socketId, name) {
        this.players.set(socketId, new Player(socketId, name));
        console.log(`[${this.scenario.title}] ${name} joined room ${this.roomId}.`);
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    getPlayerNames() {
        return Array.from(this.players.values()).map((p) => p.name);
    }

    broadcastPlayers() {
        this.io.to(this.roomId).emit('lobby:players', this.getPlayerNames());
    }

    startGame() {
        const count = this.players.size;
        const cast = [...this.scenario.cast];
        if (count < 2) {
            return { success: false, error: 'Need at least two guest players in the lobby (the admin does not take a role).' };
        }
        if (cast.length < count) {
            return {
                success: false,
                error: `This case only has ${cast.length} roles; remove players or pick another scenario.`,
            };
        }

        for (let i = cast.length - 1; i > 0; i -= 1) {
            const j = crypto.randomInt(0, i + 1);
            [cast[i], cast[j]] = [cast[j], cast[i]];
        }
        const shuffledCast = cast.slice(0, count);
        const playerArray = Array.from(this.players.values());
        const killerIndex = crypto.randomInt(0, count);

        playerArray.forEach((player, i) => {
            const charData = shuffledCast[i];
            player.assignCharacter(charData, i === killerIndex);
            this.io.to(player.id).emit('GAME_START', {
                dossier: player.getDossier(),
                scenarioTitle: this.scenario.title,
                scenarioDesc: this.scenario.description,
                theme: this.scenario.theme || null,
            });
        });

        this.state = 'INVESTIGATION';
        return { success: true };
    }
}

module.exports = GameManager;
