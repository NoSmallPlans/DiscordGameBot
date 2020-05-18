var Server = require('./Server');
var Game = require('./Game');
var DefinitionGame = require('./Games/DefinitionGame');

module.exports = class Server {
    constructor() {
        this.available_games = ['chess', 'thermonuclear war'];
        this.active_games = [];
        this.player_id_to_game_map = new Map();
        this.channel_id_to_game_map = new Map();
        this.initializeCommands(this);        
        this.init_available_games(this);
    } 

    get_available_games(){
        return Array.from(this.available_games_map.keys());
    }

    start_game(game_type, game_channel, founding_player) {
        var _this = this;
        founding_player.send("Welcome to the game!")
            .then(function () {
                var game_instance = new DefinitionGame(game_channel, founding_player);
                _this.active_games.push(game_instance);
                _this.player_id_to_game_map.set(founding_player.id, game_instance);
                _this.channel_id_to_game_map.set(game_channel.id, game_instance);
                _this.channel_id_to_game_map.set(founding_player.dmChannel.id, game_instance);
            })
            .catch(console.error);
    }

    join_game(player, game_instance) {
        var _this = this;
        player.send("Welcome to the game!")
            .then(function () {
                _this.player_id_to_game_map.set(player.id, game_instance);
                _this.channel_id_to_game_map.set(player.dmChannel.id, game_instance);
                game_instance.add_player(player);
            })
            .catch(console.error);
    }

    contains_game_by_channel_id(channel_id) {
        return this.channel_id_to_game_map.has(channel_id);
    }

    get_game_by_channel_id(channel_id) {
        return this.channel_id_to_game_map.get(channel_id);
    }

    get_active_games() {
        return this.active_games;
    }

    is_game_command(msg) {
        var game_instance;
        if (this.contains_game_by_channel_id(msg.channel.id)) {
            game_instance = this.get_game_by_channel_id(msg.channel.id);
            var words = msg.content.split(" ");
            var command = words[0];
            if (game_instance.active && game_instance.commands.has(command)) {
                return true;
            }
        }
        return false;
    }

    get_game_command(msg) {
        var game_instance = this.get_game_by_channel_id(msg.channel.id);
        var words = msg.content.split(" ");
        var command = words[0];
        return game_instance.commands.get(command);
    }

    process_command(msg) {
        if (msg.content.charAt(0) == '!') {
            msg.content = msg.content.substring(1);
            var words = msg.content.split(" ");
            var command = words[0];
            var func;
            if (this.commands.has(command)) {
                func = this.commands.get(command);
                func(msg);
                //checking msg instead of underlying command
                //for game bc we need to allow these funcs to get the channel from msg
            } else if (this.is_game_command(msg)) {
                func = this.get_game_command(msg);
                func(msg);
            } else {
                msg.reply("Invalid command: " + msg.content);
            }
        }
    }

    extract_params(msg) {
        var words = msg.content.split(" ");
        var command = words[0];
        words.shift();
        return words;
    }

    initializeCommands(_this) {
        var commandMap = new Map();

        commandMap.set('games', function (msg) {
            var games_list = _this.get_available_games();
            msg.reply(games_list.toString());
        });

        //todo parameterized start commands
        commandMap.set('play', function (msg) {
            var params = _this.extract_params(msg);
            var game_name = params[0];
            if (_this.contains_game_by_channel_id(msg.channel.id)) {
                msg.reply("Sorry, a game already exists on this channel");
            } else {
                if (_this.available_games_map.has(game_name)) {
                    msg.reply("Starting " + game_name + " for " + msg.author.username);
                    var game_channel = msg.channel;
                    var founding_player = msg.author;
                    _this.start_game(game_name, game_channel, founding_player);
                } else {
                    msg.reply(game_name + "is not a recognized game");
                }
            }
        });

        commandMap.set('join', function (msg) {
            if (!_this.contains_game_by_channel_id(msg.channel.id)) {
                msg.reply("Sorry, there is no game currently on this channel");
            } else {
                var game_instance = _this.get_game_by_channel_id(msg.channel.id);
                if (!game_instance.has_player(msg.author)) {
                    _this.join_game(msg.author, game_instance);
                    msg.reply(msg.author.username + " is joining the game");
                } else {
                    msg.reply(msg.author.username + " was already in the game");
                }
            }
        });

        commandMap.set('replay', function (msg) {
            if (!_this.contains_game_by_channel_id(msg.channel.id)) {
                msg.reply("Sorry, there is no game to replay");
            } else {
                var game_instance = _this.get_game_by_channel_id(msg.channel.id);
                game_instance.replay();
            }
        });

        _this.commands = commandMap;
    }

    init_available_games(_this) {
        _this.available_games_map = new Map();
        _this.available_games_map.set("definitions", DefinitionGame);
    }
}