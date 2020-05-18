module.exports = class Game {
    constructor(channel, founding_player) {
        this.channel = channel;
        this.players = [];
        this.players.push(founding_player);
        this.commands = new Map();
        this.active = true;
        this.in_progress;
        this.line_break = "------------------------------------------------------------------------------------------------------------";
    }

    extract_params(msg) {
        var words = msg.content.split(" ");
        var command = words[0];
        words.shift();
        return words;
    }

    add_player(player){
        this.players.push(player);
    }

    has_player(player) {
        return this.players.includes(player);
    }

    get_players() {
        return this.players;
    }

    get_channel() {
        return this.channel;
    }

    replay() {
        //not implemented
    }

    msg_user_by_id(user_id, message) {
        this.channel.client.users.get(user_id).send(message);
    }

    broadcast_individual_players(message) {
        for (var i = 0; i < this.players.length; i++) {
            this.players[i].fetch()
                .then(this.players[i].send(message))
                .catch(console.error);
        }
    }

    broadcast_game_channel(message) {
        this.channel.fetch()
            .then(this.channel.send(message))
            .catch(console.error);
    }

    test_broadcast() {
        this.broadcast_game_channel("Channel 30 second ping");
        this.broadcast_individual_players("Individual 30 second ping");
    }
}