require('dotenv').config();
var Server = require('./Server');
var Game = require('./Game');
var DefinitionGame = require('./Games/DefinitionGame');

const Discord = require('discord.js');
const client = new Discord.Client();
GAME_SERVER = new Server();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.login(process.env.DISCORD_TOKEN);

client.on('message', msg => {
    if (msg.author.bot === false) {
        GAME_SERVER.process_command(msg);
    }
});