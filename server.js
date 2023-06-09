var
    BPromise = require('bluebird'),
    path = require('path'),
    net = require('net'),
    chalk = require('chalk'),
    jade = require('jade'),
    serveStatic = require('serve-static'),
    environment = process.env.NODE_ENV = process.env.NODE_ENV || 'production',
    app = require('./app.js'),
    cardReader = require('./lib/cardReader'),
    leaderboard = require('./lib/leaderboard'),
    leaderboardCron = require('./lib/leaderboardCron'),
    stats = require('./lib/stats').stats;

getConfig = require('./config');
config = getConfig[environment];
settings = getConfig.global;

app.set('settings', settings);
app.engine('jade', jade.__express);
app.use(serveStatic('./ui/public'));
app.locals.config = config;
app.locals.settings = settings;

_ = require('underscore');
io = require('socket.io');
moment = require('moment');
spark = require('sparknode');
core = new spark.Core(settings.sparkCore);

leaderboardCron();

gameController = require('./classes/gameController');

game = {};
player = {};

// Setup socketio
io = io.listen(config.wsPort);
console.log(chalk.green('Websocket Server: Listening on port ' + config.wsPort));

io.configure(function() {
    io.set('log level', 2);
});

app.get('/', function(req, res) {

    delete require.cache[path.resolve('./versions/js.json')];
    delete require.cache[path.resolve('./versions/css.json')];

    res.render('home.jade', {
        title: 'Ping Pong',
        metaDesc: 'Ping Pong',
        JSVersions: require('./versions/js'),
        CSSVersions: require('./versions/css')
    });

});

app.get('/leaderboard', function(req, res) {
    leaderboard.get(8)
        .then(function(players) {
            res.json(players);
        });
});

app.get('/api/v1/stats', function(req, res) {

    var
        types = Object.keys(stats),
        output = {},
        generators;

    generators = types.map(function(type) {
        return stats[type]();
    });

    BPromise.all(generators)
        .then(function(stats) {

            stats.forEach(function(stat) {
                output[stat.type] = stat.data;
            });

            res.json(output);

        });

});

app.listen(config.clientPort);
console.log(chalk.green('Web Server: Listening on port ' + config.clientPort));

game = new gameController();

game.feelersPingReceived();

io.sockets.on('connection', function(client) {

    game.reset();
    game.clientJoined();
    //game.test();

    cardReader.connectionStatus();
    client.on('fakeScored', game.feelerPressed); // Fake score event for easier testing

});

core.on('scored', game.feelerPressed);
core.on('ping', game.feelersPingReceived);
core.on('batteryLow', game.batteryLow);

core.on('online', function() {
    game.feelersOnline();
    game.feelerStatus();
    game.feelersPingReceived();
});

cardReader.on('read', function(data) {
    console.log('New read', data);
    game.addPlayerByRfid(data.rfid);
});

cardReader.on('err', game.cardReadError);

cardReader.on('connect', function() {
    io.sockets.emit('cardReader.connect');
});

cardReader.on('disconnect', function() {
    io.sockets.emit('cardReader.disconnect');
});
