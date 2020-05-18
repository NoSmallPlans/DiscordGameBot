module.exports = class FakeDB {
    constructor() {
        this.db = new Map();
        var dict_one = new Map();
        dict_one.set("WordOne", "Definition One");
        dict_one.set("WordTwo", "Definition Two");
        dict_one.set("WordThree", "Definition Three");
        this.db.set("word_collections", new Map());
        this.db.get("word_collections").set("default", dict_one);
    }

    contains(key) {
        return this.db.has(key);
    }

    get(key) {
        return this.db.get(key);
    }


}