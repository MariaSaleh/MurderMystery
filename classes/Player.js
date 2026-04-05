class Player {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.character = null;
        this.isKiller = false;
    }

    assignCharacter(character, isKiller) {
        this.character = character;
        this.isKiller = isKiller;
    }

    getDossier() {
        return {
            playerName: this.name,
            isKiller: this.isKiller,
            character: {
                name: this.character.name,
                bio: this.character.bio,
                secret: this.character.secret
            }
        };
    }
}
module.exports = Player;