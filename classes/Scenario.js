class Scenario {
    constructor(id, title, description, characters = []) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.characters = characters;
    }

    getRandomizedCast(count) {
        // Shuffle the deck and pick only as many as we have players
        const shuffled = [...this.characters].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }
}
module.exports = Scenario;