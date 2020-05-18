var Game = require('../Game');
var FakeDB = require('../FakeDB');

module.exports = class DefinitionGame extends Game {
    constructor(channel, founding_player) {
        super(channel, founding_player);
        this.PHASE_ENUMS = Object.freeze({
            "SUBMITTING": 0
            , "READING": 1
            , "VOTING": 2
            , "SCORING": 3
            , "COMPLETE": 4
            , "CONFIG": 5
        });
        this.submission_phase_timer = 0;
        this.next_round_timer = 30000;
        this.min_submission_phase_timer = 60000;
        this.max_submission_phase_timer = 60000 * 10;
        this.vote_phase_timer = 0;
        this.min_vote_phase_timer = 60000;
        this.max_vote_phase_timer = 60000 * 5;
        this.curr_phase;
        this.round_num = 0;
        this.rounds_to_play = 10;
        this.min_players = 3;
        this.max_players = 12;
        this.duplicate_pts = 4;
        this.correct_guess_pts = 3;
        this.wrong_guess_pts = 1;
        this.initializeCommands(this);
        this.DB = new FakeDB();
        this.in_progress = false;
        this.word_ptr = 0;
        this.curr_word = "Not Set";
        this.curr_definition = "Not set";
        this.player_definitions = [];
        this.round_leader_ptr = 0;
        this.round_leader = "Not set";
        this.round_score = new Map();
        this.game_score = new Map();
        this.recorded_votes = new Map();
        this.init_scores();
        this.welcome_message();
        this.timers = {};
        this.timers.submission = [];
        this.timers.vote = [];
        this.timers.nextRound = [];
        this.set_collection("default");
    }

    init_scores() {
        for (var i = 0; i < this.players.length; i++) {
            this.game_score.set(this.players[i].id, 0);
        }
    }

    welcome_message() {
        this.broadcast_game_channel("!config - if you want to make changes to game settings (you can always go with the defaults)."
            + "\n!help - can be used at any time to get command help."
            + "\n!begin - when you're ready to start the game."
            + "\n!join - if you want to participate in the game.");
    }

    list_collections() {
        if (!this.available_collections) this.available_collections = this.get_collections_from_db();
        return Array.from(this.available_collections.keys()).toString();
    }

    get_collections_from_db() {
        return this.DB.get("word_collections");
    }

    is_valid_collection(collection_name) {
        if (!this.available_collections) this.available_collections = this.get_collections_from_db();
        return this.available_collections.has(collection_name);
    }

    get_collection(collection_name) {
        if (!this.available_collections) this.available_collections = this.get_collections_from_db();
        return this.available_collections.get(collection_name);
    }

    set_collection(collection_name) {
        if (this.is_valid_collection(collection_name)) {
            this.collection = this.get_collection(collection_name);
            this.words_list = Array.from(this.collection.keys());
            return true;
        }
        return false;
    }

    get_next_word() {
        //var next_word = this.words_list[this.word_ptr];
        this.shuffle_array(this.words_list);
        var next_word = this.words_list.pop();
        this.word_ptr++;
        if (this.word_ptr >= this.words_list.length) this.word_ptr = 0;
        return next_word;
    }

    get_next_round_leader() {
        var next_leader = this.players[this.round_leader_ptr];
        this.round_leader_ptr++;
        if (this.round_leader_ptr >= this.players.length) this.round_leader_ptr = 0;
        return next_leader;
    }

    reset_round_scores() {
        this.round_score = new Map();
        for (var i = 0; i < this.players.length; i++) {
            this.round_score.set(this.players[i].id, 0);
        }
    }

    update_game_scores() {
        var oldscore;
        for (const [p_id, pts] of this.round_score.entries()) {
            oldscore = 0;
            if (this.game_score.has(p_id)) oldscore = this.game_score.get(p_id);
            this.game_score.set(p_id, oldscore + pts);
        }
        this.reset_round_scores();
    }

    next_round() {
        this.cancel_next_round_timers();
        this.update_game_scores();

        if (this.round_num > 0) this.broadcast_individual_players(this.get_game_score());

        if (this.round_num >= this.rounds_to_play) {
            this.broadcast_individual_players("GAME OVER!");
            this.in_progress = false;
        }

        if (this.round_num < this.rounds_to_play) {
            this.player_definitions = [];
            this.curr_word = this.get_next_word();
            this.curr_definition = this.collection.get(this.curr_word);
            this.round_leader = this.get_next_round_leader();
            this.player_definitions.push({ id: null, definition: this.curr_definition, correct_answer: true });
            this.recorded_votes = new Map();
            this.curr_phase = this.PHASE_ENUMS.SUBMITTING;
            if (this.submission_phase_timer > 0) this.submission_phase_auto_advance(this);
            this.broadcast_individual_players("Round " + ++this.round_num + ". This round's reader is " + this.round_leader.username + ". Your word is " + this.curr_word + ". Type !submit followed by a space, then the definition to provide your answer.");
        }
    }

    submit_definition(player_id, player_definition) {
        for (var i = 0; i < this.player_definitions.length; i++) {
            if (this.player_definitions[i].id == player_id) {
                this.player_definitions[i] = { id: player_id, definition: player_definition, correct_answer: false };
                return;
            }
        }
        this.player_definitions.push({ id: player_id, definition: player_definition, correct_answer: false });
        this.shuffle_array(this.player_definitions);

        //If all players have submitted definitions, move to reading
        if (this.player_definitions.length > this.players.length) {
            this.curr_phase = this.PHASE_ENUMS.READING;
            this.cancel_submission_timers();
            this.broadcast_individual_players("All submissions have been received. The round leader will now read the definitions.\n"
                + this.line_break
                + "\nType !vote [number] to make your pick.");
            this.round_leader.send(this.get_definitions());
        }
    }

    remove_definition(index) {
        this.player_definitions.splice(index, 1);
    }

    submission_phase_auto_advance() {
        var warning_time = 15000;
        var _this = this;
        _this.timers.submission = [];

        var warningTimer = setTimeout(function () {
            if (_this.curr_phase == _this.PHASE_ENUMS.SUBMITTING) {
                _this.broadcast_individual_players("15 seconds left to submit your definitions!");
            }
        }, _this.submission_phase_timer - warning_time);

        var doneTimer = setTimeout(function () {
            if (_this.curr_phase == _this.PHASE_ENUMS.SUBMITTING) {
                _this.broadcast_individual_players("Time is up, submissions are closed. The round leader will now read the definitions.");
                _this.curr_phase = _this.PHASE_ENUMS.READING;
                this.round_leader.send(this.get_definitions());
            }
            return;
        }, _this.submission_phase_timer);

        _this.timers.submission.push(warningTimer);
        _this.timers.submission.push(doneTimer);
    }

    cancel_submission_timers() {
        for (var i = 0; i < this.timers.submission.length; i++) {
            clearTimeout(this.timers.submission[i]);
        }
    }

    vote_phase_auto_advance() {
        var warning_time = 15000;
        var _this = this;
        _this.timers.vote = [];

        var warningTimer = setTimeout(function () {
            if (_this.curr_phase == _this.PHASE_ENUMS.VOTING) {
                _this.broadcast_individual_players("15 seconds left to vote!");
            }
        }, _this.vote_phase_timer - warning_time);

        var doneTimer = setTimeout(function () {
            if (_this.curr_phase == _this.PHASE_ENUMS.VOTING) {
                _this.broadcast_individual_players("Time is up, voting is closed.");
                _this.curr_phase = _this.PHASE_ENUMS.COMPLETE;
                _this.round_end_msgs();
                _this.next_round_auto_advance();
            }
            return;
        }, _this.vote_phase_timer);

        _this.timers.vote.push(warningTimer);
        _this.timers.vote.push(doneTimer);
    }

    cancel_vote_timers() {
        for (var i = 0; i < this.timers.vote.length; i++) {
            clearTimeout(this.timers.vote[i]);
        }
    }

    next_round_auto_advance() {
        var _this = this;
        _this.timers.nextRound = [];

        var nextTimer = setTimeout(function () {
            if (_this.curr_phase == _this.PHASE_ENUMS.COMPLETE) {
                _this.broadcast_individual_players(_this.round_leader.username + " is the round leader and should type !next, when you are ready to advance to the next round.");
            }
            return;
        }, _this.next_round_timer);

        _this.timers.nextRound.push(nextTimer);
    }

    cancel_next_round_timers() {
        for (var i = 0; i < this.timers.nextRound.length; i++) {
            clearTimeout(this.timers.nextRound[i]);
        }
    }

    shuffle_array(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    give_pts(player_id, pts) {
        var old_score = 0;
        if (this.round_score.has(player_id)) {
            old_score = this.round_score.get(player_id);
        }
        this.round_score.set(player_id, pts + old_score);
    }

    register_vote(voter_id, player_getting_votes_id, pts_given) {
        this.recorded_votes.set(voter_id, { recipient_id: player_getting_votes_id, pts: pts_given });
        if (this.recorded_votes.size >= this.players.length) {
            this.broadcast_individual_players("Voting has finished.");
            //this.curr_phase = self.PHASE_ENUMS.SCORING;
            this.curr_phase = this.PHASE_ENUMS.COMPLETE;
            this.cancel_vote_timers();
            this.round_end_msgs();
            this.next_round_auto_advance();

            //if this was the last round, move to next in order to end game
            if (this.round_num >= this.rounds_to_play) {
                this.next_round();
            }
        }
    }

    round_end_msgs() {
        this.broadcast_individual_players("And the correct definition was...\n");
        this.broadcast_individual_players(this.curr_word + ": " + this.curr_definition);
        this.broadcast_individual_players(this.get_round_score());
    }

    revoke_vote(voting_player_id) {
        var lastVote = this.recorded_votes.get(voting_player_id);
        var player_getting_votes_id = lastVote.recipient_id;
        var points = lastVote.pts;
        var old_score = this.round_score.get(player_getting_votes_id);
        this.round_score.set(player_getting_votes_id, old_score - points);
    }

    get_definitions() {
        var ret_string = " \n";
        for (var i = 0; i < this.player_definitions.length; i++) {
            var def_num = i + 1;
            ret_string = ret_string + "\nDefinition " + def_num + ": " + this.player_definitions[i].definition;
        }
        return ret_string;
    }

    get_round_score() {
        var ret_string = this.line_break + "\nRound " + this.round_num + " scores:";
        for (var i = 0; i < this.players.length; i++) {
            ret_string = ret_string + "\n" + this.players[i].username + " - " + this.round_score.get(this.players[i].id) + " pts";
        }
        return ret_string;
    }

    get_game_score() {
        var ret_string = this.line_break + "\nGame scores:";
        for (var i = 0; i < this.players.length; i++) {
            ret_string = ret_string + "\n" + this.players[i].username + " - " + this.game_score.get(this.players[i].id) + " pts";
        }
        return ret_string;
    }

    set_vote_time(milliseconds) {
        if (milliseconds == 0) {
            this.vote_phase_timer = 0;
            return true;
        }

        if (milliseconds < this.min_vote_phase_timer || milliseconds > this.max_vote_phase_timer) {
            return false;
        }

        this.vote_phase_timer = milliseconds;
        return true;
    }

    set_submission_time(milliseconds) {
        if (milliseconds == 0) {
            this.submission_phase_timer = 0;
            return true;
        }

        if (milliseconds < this.min_submission_phase_timer || milliseconds > this.max_submission_phase_timer) {
            return false;
        }

        this.submission_phase_timer = milliseconds;
        return true;
    }

    replay() {
        this.reset_game();
    }

    reset_game() {
        this.round_num = 0;
        this.player_definitions = [];
        this.round_leader_ptr = 0;
        this.round_leader = "Not set";
        this.round_score = new Map();
        this.game_score = new Map();
        this.recorded_votes = new Map();
        this.init_scores();
        this.welcome_message();
        this.timers = {};
        this.timers.submission = [];
        this.timers.vote = [];
    }
     
    initializeCommands(_this) {
        var commandMap = new Map();

        commandMap.set('config', function (msg) {
            var params = _this.extract_params(msg);
            if (_this.in_progress) {
                msg.reply("Sorry, this command is not available while a game is in progress");
            } else {
                msg.reply("Use the following configuration commands to customize your game:"
                    + "\n!dictionaries to display the words lists available for the game."
                    + "\n!dictionary [dictionary name] to choose a new words list for the game."
                    + "\n!rounds [number] to determine the number of rounds for the game (10 rounds is the default)."
                    + "\n!timer-vote [seconds] to set vote time allowed, or submit a time of 0 for no timer (timer is off by default)."
                    + "\n!timer-submit [seconds] to set vote time allowed, or submit a time of 0 for no timer (timer is off by default)."
                    + ")");
            }
        });

        commandMap.set('help', function (msg) {
            var params = _this.extract_params(msg);
            
            msg.reply("Common commands:"
                + "\n!submit [definition text] - to provide your made up definition for a word."
                + "\n!duplicate [number] - removes a player definition and provides points when a players definition matches the correct answer (only available to the current round leader)."
                + "\n!vote [number] - to pick your choice for the right definition."
                + "\n!rockthevote - Starts vote timer for the round."
                + "\n!next - advances to the next round (only available to the current round leader)."
                + "\n!replay - to start a new game with the same settings.");
        });

        commandMap.set('dictionary', function (msg) {
            var params = _this.extract_params(msg);
            var collection_name = params[0];
            if (_this.in_progress) {
                msg.reply("Sorry, this command is not available while a game is in progress");
            } else {
                if (_this.set_collection(collection_name)) {
                    msg.reply("Using " + collection_name + " dictionary");
                    msg.reply("Now lets determine the number of rounds to play.Type \"rounds [number]\" to make your selection.");
                } else {
                    msg.reply("Invalid dictionary name parameter: " + collection_name);
                }
            }
        });

        commandMap.set('dictionaries', function (msg) {
            if (_this.in_progress) {
                msg.reply("Sorry, this command is not avaialble while a game is in progress");
            } else {
                msg.reply(_this.list_collections());
            }
        });

        commandMap.set('rounds', function (msg) {
            var params = _this.extract_params(msg);
            var desired_rounds = params[0];
            if (_this.in_progress) {
                msg.reply("The game is already in progress, you cannot change the number of rounds mid-game");
            } else {
                _this.rounds_to_play = desired_rounds;
                msg.reply("Ok, we're just about done. I'll assume you know how to play already, "
                    + "but if at any time you need a refresher just type \"rules\". That's it, when you're ready to begin type \"begin\".");
            }
        });

        commandMap.set('begin', function (msg) {
            var params = _this.extract_params(msg);
            if (_this.in_progress) {
                msg.reply("Cannot \"begin\", a game is already in progress");
            } else {
                _this.in_progress = true;
                msg.reply("Game messages will be sent directly to players instead of broadcast on this channel. Let's get started.");
                _this.next_round();
            }
        });

        commandMap.set('submit', function (msg) {

            var params = _this.extract_params(msg);
            var player_id = msg.author.id;
            var player_definition = params.join(" ");

            if (_this.in_progress) {
                if (_this.curr_phase == _this.PHASE_ENUMS.SUBMITTING) {
                    _this.submit_definition(player_id, player_definition);
                    msg.reply("Definition received.");
                } else {
                    msg.reply("Sorry you cannot submit a definition now.");
                }
            } else {
                msg.reply("No game is yet in progress");
            }
        });

        commandMap.set('next', function (msg) {
            var params = _this.extract_params(msg);

            if (msg.author.id != _this.round_leader.id) {
                msg.reply("Sorry, only the round leader can advance to the next round");
                return;
            }
            if (_this.in_progress) {
                if (_this.curr_phase == _this.PHASE_ENUMS.COMPLETE) {
                    _this.next_round();
                } else {
                    msg.reply("Cannot move to the next round until voting has completed.");
                }
            } else {
                msg.reply("No game is yet in progress");
            }
        });

        commandMap.set('definitions', function (msg) {
            var params = _this.extract_params(msg);

            if (!_this.in_progress) {
                msg.reply("No game is yet in progress");
                return;
            }
            if (msg.author.id != _this.round_leader.id) {
                msg.reply("Sorry, only the round leader can see submitted definitions");
                return;
            }
            if (_this.curr_phase == _this.PHASE_ENUMS.READING) {
                msg.reply(_this.get_definitions());
            } else {
                msg.reply("Sorry you cannot access definitions at this time.");
            }
            
        });

        commandMap.set('rockthevote', function (msg) {
            if (msg.author.id != _this.round_leader.id) {
                msg.reply("Sorry, only the round leader can signal that it is time to vote");
                return;
            }

            if (_this.curr_phase != _this.PHASE_ENUMS.READING) {
                msg.reply("Sorry, you can only trigger a vote after definitions have been submitted.");
            } else {
                _this.curr_phase = _this.PHASE_ENUMS.VOTING;
                if (_this.vote_phase_timer > 0) _this.vote_phase_auto_advance(_this);
                _this.broadcast_individual_players(_this.line_break + "\nTime to vote! Message me \"!vote [definition number]\" to cast your vote. Example: !vote 2");    
            }
        });

        commandMap.set('vote', function (msg) {

            var params = _this.extract_params(msg);
            var index = params[0] - 1;
            var pt_recipient_id;
            var pts_earned = 0;

            if (!_this.in_progress) {
                msg.reply("No game is yet in progress");
                return;
            }

            if (_this.curr_phase != _this.PHASE_ENUMS.VOTING && _this.curr_phase != _this.PHASE_ENUMS.READING) {
                msg.reply("You cannot vote for a definition at this time");
                return;
            }

            if (index < 0 || index > _this.player_definitions.length - 1) {
                msg.reply("Whoops, that defnition number does not exist. Try again.");
                return;
            }

            if (_this.player_definitions[index].id == msg.author.id) {
                msg.reply("Tsk.Tsk. Are you really trying to vote for your own definition?");
                return;
            }

            if (_this.player_definitions[index].correct_answer) {
                pt_recipient_id = msg.author.id;
                pts_earned = _this.correct_guess_pts;
            } else {
                pt_recipient_id = _this.player_definitions[index].id;
                pts_earned = _this.wrong_guess_pts;
            }
            
            if (_this.recorded_votes.has(msg.author.id)) {
                _this.revoke_vote(msg.author.id);
                _this.give_pts(pt_recipient_id, pts_earned);
                msg.reply("Vote updated.");
            } else {
                _this.give_pts(pt_recipient_id, pts_earned);
                msg.reply("Vote received.");
            }
            _this.register_vote(msg.author.id, pt_recipient_id, pts_earned);

        });

        commandMap.set('duplicate', function (msg) {

            var params = _this.extract_params(msg);
            var index = params[0] - 1;
            var pt_recipient_id;
            var pts_earned = 0;

            if (msg.author.id != _this.round_leader.id) {
                msg.reply("Sorry, only the round leader can mark duplicate definitions");
                return;
            }

            if (!_this.in_progress) {
                msg.reply("No game is yet in progress");
                return;
            }

            if (_this.curr_phase != _this.PHASE_ENUMS.VOTING && _this.curr_phase != _this.PHASE_ENUMS.READING) {
                msg.reply("You mark a duplicate definition at this time");
                return;
            }

            if (index < 0 || index > _this.player_definitions.length - 1) {
                msg.reply("Whoops, that definition number does not exist. Try again.");
                return;
            }

            if (_this.player_definitions[index].correct_answer) {
                msg.reply("Whoops, that isn't a duplicate that's the real answer. Please mark the other as the duplicate.");
                //_this.player_definitions[similar].correct_answer = true;
                //_this.remove_definition(index);
            } else {
                pt_recipient_id = _this.player_definitions[index].id;
                pts_earned = _this.duplicate_pts;
                _this.give_pts(pt_recipient_id, pts_earned);
                _this.remove_definition(index);
                msg.reply("Duplicate removed. These are the remaining definitions:" + _this.get_definitions());
            }
        });

        commandMap.set('round-score', function (msg) {
            if (!_this.in_progress) {
                msg.reply("No game is yet in progress");
                return;
            }
            if (!_this.curr_phase == _this.PHASE_ENUMS.SCORING) {
                msg.reply("Round scores are only shown at the end of the round");
                return;
            }
            _this.broadcast_individual_players(_this.get_round_score());
        });

        commandMap.set('game-score', function (msg) {
            if (!_this.in_progress) {
                msg.reply("No game is yet in progress");
                return;
            }
            _this.broadcast_individual_players(_this.get_game_score());
        });

        commandMap.set('timer-vote', function (msg) {
            if (_this.in_progress) {
                msg.reply("Sorry vote timers cannot be changed mid-game.");
                return;
            }

            var params = _this.extract_params(msg);
            var time = params[0];
            var ms_time = time * 1000;
            if (_this.set_vote_time(ms_time)) {
                msg.reply("Vote time changed to: " + time + " seconds.");
            } else {
                msg.reply("Unable to change vote time.");
            }
        });

        commandMap.set('timer-submission', function (msg) {
            if (_this.in_progress) {
                msg.reply("Sorry vote timers cannot be changed mid-game.");
                return;
            }

            var params = _this.extract_params(msg);
            var time = params[0];
            var ms_time = time * 1000;
            if (_this.set_submission_time(ms_time)) {
                msg.reply("Vote time changed to: " + time + " seconds.");
            } else {
                msg.reply("Unable to change vote time.");
            }
        });

        this.commands = commandMap;
    }
}