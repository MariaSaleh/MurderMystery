class Player {
    constructor(socketId, name, playerId) {
        this.id = socketId; // socket.id, changes on reconnect
        this.name = name;
        this.playerId = playerId; // persistent uuid, does not change
        this.character = null;
        this.isReady = false;
    }

    assignCharacter(character) {
        this.character = character;
    }
}

module.exports = Player;
