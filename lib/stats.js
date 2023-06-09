require('array.prototype.find');



var
    _ = require('underscore'),
    BPromise = require('bluebird'),
    EventEmitter = require('events').EventEmitter,
    through = require('through2'),
    async = require('async'),
    moment = require('moment'),
    app = require('../app'),
    leaderboard = require('./leaderboard'),
    bookshelf = app.get('bookshelf'),
    performance = require('./playerPerformance'),
    events = new EventEmitter();



events.on('client.join', getStats);
events.on('game.end', getStats);



var greaterThanZero = function(value) {
    return value > 0;
};



var sortDesc = function(a, b) {
    return b - a;
};



function getStats() {
    countConsecutive();
    largestWhooping();
    totalCompanyGames();
    mostFrequentPlayer();
    mostImprovedPlayer();
    greatestGameScore();
    nemesese();
}



module.exports = {
    stats: {
        leaderboard: leaderboardForStats,
        streaks: countConsecutive,
        whooping: largestWhooping,
        totalGames: totalCompanyGames,
        mostFrequentPlayer: mostFrequentPlayer,
        mostImprovedPlayer: mostImprovedPlayer,
        nemesese: nemesese,
        greatestGameScore: greatestGameScore
    },
    events: events
};



/**
 * Counts consecutive wins or losses and returns
 * the greatest or smallest.
 */
function countConsecutive(criteria, cb) {

    var
        resolver = BPromise.pending(),
        calculated = 0;

    bookshelf.knex
        .select('*')
        .from('players')
        .then(function(players) {

            players.forEach(function(player) {

                var wins = [];
                var losses = [];
                var currentWinningStreak = 0;
                var currentLosingStreak = 0;

                bookshelf.knex
                    .select('*')
                    .from('games')
                    .where('player0_id', '=', player.id)
                    .orWhere('player1_id', '=', player.id)
                    .then(function(games) {

                        games.forEach(function(game, i) {

                            var
                                previous = games[i - 1],
                                isFirst = i === 0,
                                won = game.winner_id === player.id,
                                lost = !won,
                                isConsecutiveLoss,
                                isConsecutiveWin,
                                previousLost,
                                previousWon;

                            if(!isFirst) {
                                previousWon = previous.winner_id === player.id;
                                previousLost = !previousWon;
                                isConsecutiveWin = !isFirst && previousWon && won;
                                isConsecutiveLoss = !isFirst && previousLost && lost;
                            }

                            if(isFirst && won) {
                                currentWinningStreak ++;
                            }

                            if(isFirst && lost) {
                                currentLosingStreak ++;
                            }

                            if(isConsecutiveWin) {
                                currentWinningStreak ++;
                            }

                            if(isConsecutiveLoss) {
                                currentLosingStreak ++;
                            }

                            if(!isFirst && !isConsecutiveWin) {
                                wins.push(currentWinningStreak);
                                currentWinningStreak = 0;
                            }

                            if(!isFirst && !isConsecutiveLoss) {
                                losses.push(currentLosingStreak);
                                currentLosingStreak = 0;
                            }

                        });

                        player.winningStreaks = wins
                            .filter(greaterThanZero)
                            .sort(sortDesc);

                        player.losingStreaks = losses
                            .filter(greaterThanZero)
                            .sort(sortDesc);

                        calculated ++;

                        if(calculated === players.length) {

                            var streaks = findLongestStreaks(players);

                            events.emit('biggestWinningStreak', streaks.winning);
                            events.emit('mostConsecutiveLosses', streaks.losing);

                            resolver.resolve({
                                type: 'streaks',
                                data: streaks
                            });

                        }

                    });

                });

            });

    return resolver.promise;

}



function mostImprovedPlayer() {

    var
        resolver = BPromise.pending(),
        fromTime = moment().subtract(1, 'weeks').format('YYYY/MM/DD'),
        toTime = moment().format('YYYY/MM/DD');

    bookshelf.knex
        .select('*')
        .from('players')
        .then(function(players) {

            var deltaCalculations = [];

            players.forEach(function(player) {

                var calculation = performance.delta(player.id, fromTime, toTime, { percentage: true })
                    .then(function(delta) {
                        player.performanceDelta = delta;
                    });

                deltaCalculations.push(calculation);

            });

            BPromise.all(deltaCalculations)
                .then(function(deltas) {

                    var sorted, mostImprovedPlayer, data;

                    sorted = players.sort(function(a, b) {
                        return b.performanceDelta.delta - a.performanceDelta.delta;
                    });

                    mostImprovedPlayer = sorted[0];

                    data = {
                        name: mostImprovedPlayer.name,
                        performanceDelta: mostImprovedPlayer.performanceDelta
                    };

                    events.emit('stats.mostImprovedPlayer', data);

                    resolver.resolve({
                        type: 'mostImprovedPlayer',
                        data: data
                    });

                });

        });

    return resolver.promise;

}



function nemesese() {

    var resolver = BPromise.pending();

    bookshelf.knex
        .select('*')
        .from('games')
        .then(function(games) {

            var pairs = games
                .map(function(game) {

                    return [ game.player0_id, game.player1_id ]
                        .map(function(player) {
                            return parseInt(player);
                        })
                        .sort(function(a, b) {
                            return a - b;
                        })
                        .join('.');

                });

            pairs = _.groupBy(pairs);

            pairs = _.map(pairs, function(instances, pair) {

                pair = pair
                    .split('.')
                    .map(function(player) {
                        return parseInt(player);
                    });

                return {
                    pair: pair,
                    count: instances.length
                };

            });

            pairs = pairs.sort(function(a, b) {
                return b.count - a.count;
            });

            bookshelf.knex
                .select('*')
                .from('players')
                .where('guest', '=', '0')
                .then(function(players) {

                    var data = players
                        .map(function(player) {

                            var pair, opponentId, opponent;

                            pair = pairs.find(function(pair) {
                                return pair.pair.indexOf(parseInt(player.id)) > -1;
                            });

                            if(!pair) {
                                return;
                            }

                            opponentId = pair.pair.find(function(pairPlayer) {
                                return parseInt(pairPlayer) !== parseInt(player.id);
                            });

                            if(!opponentId) {
                                return;
                            }

                            opponent = players.find(function(opponentPlayer) {
                                return parseInt(opponentPlayer.id) === parseInt(opponentId);
                            });

                            if(opponent) {
                                return {
                                    player: player.name,
                                    nemesis: opponent.name,
                                    count: pair.count
                                };
                            }

                        })
                        .filter(function(pair) {
                            return pair;
                        });

                    events.emit('nemesese', data);

                    resolver.resolve({
                        type: 'nemesese',
                        data: data
                    });

                });

        });

    return resolver.promise;

}



function findLongestStreaks(players) {

    var
        winning = [],
        losing = [];

    var sortStreaksDesc = function(a, b) {
        return b.streak - a.streak;
    };

    players.forEach(function(player) {

        winning.push({
            player: player.name,
            streak: player.winningStreaks[0] || 0
        });

        losing.push({
            player: player.name,
            streak: player.losingStreaks[0] || 0
        });

    });

    winning = winning.sort(sortStreaksDesc)[0];
    losing = losing.sort(sortStreaksDesc)[0];

    return {
        winning: winning,
        losing: losing
    };

}



function largestWhooping() {

    var
        resolver = BPromise.pending(),
        whooping;

    whooping = {
        players: [],
        scores: []
    };

    bookshelf.knex
        .select()
        .from('games')
        .orderBy('score_delta', 'desc')
        .limit(1)
        .then(function(game) {
            if(game.length === 0) return;
            game = game[0];
            whooping.scores = [game.player0_score, game.player1_score];
            async.parallel([
                function(cb) {
                    bookshelf.knex.select('name').from('players').where('id', game.player0_id).then(function(player) {
                        whooping.players[0] = player[0].name;
                        cb();
                    });
                },
                function(cb) {
                    bookshelf.knex.select('name').from('players').where('id', game.player1_id).then(function(player) {
                        whooping.players[1] = player[0].name;
                        cb();
                    });
                }
            ], function() {

                events.emit('largestWhooping', whooping);

                resolver.resolve({
                    type: 'whooping',
                    data: whooping
                });

            });
        });

    return resolver.promise;

}



/**
 * Number of games played
 */
function totalCompanyGames() {

    var resolver = BPromise.pending();

    bookshelf.knex('games').count('id as count')
        .then(function(count) {

            events.emit('totalCompanyGames', count[0].count);

            resolver.resolve({
                type: 'totalGames',
                data: count[0].count
            });

        });

    return resolver.promise;

}



/**
 * Get the name of the most frequent player
 */
function mostFrequentPlayer() {

    var resolver = BPromise.pending();

    bookshelf.knex
        .select('name')
        .from('players')
        .orderBy('play_count', 'desc')
        .limit(1)
        .then(function(player) {

            player = player[0].name;
            events.emit('mostFrequentPlayer', player);

            resolver.resolve({
                type: 'mostFrequentPlayer',
                data: player
            });

        });

    return resolver.promise;

}



function greatestGameScore() {

    var resolver = BPromise.pending();

    bookshelf.knex
        .select('*')
        .from('games')
        .then(function(games) {

            var greatest;

            games = games
                .map(function(game) {
                    game.total_score = parseInt(game.player0_score) + parseInt(game.player1_score);
                    return game;
                })
                .sort(function(a, b) {
                    return b.total_score - a.total_score;
                });

            greatest = games[0];

            bookshelf.knex
                .select('id', 'name')
                .from('players')
                .where('id', '=', greatest.player0_id)
                .orWhere('id', '=', greatest.player1_id)
                .then(function(players) {

                    var data;

                    players.forEach(function(player) {

                        var property = player.id === greatest.player0_id ?
                            'player0_name' :
                            'player1_name';

                        greatest[property] = player.name;

                    });

                    data = [
                        {
                            name: greatest.player0_name,
                            score: greatest.player0_score
                        },
                        {
                            name: greatest.player1_name,
                            score: greatest.player1_score
                        }
                    ];

                    events.emit('greatestGameScore', data);

                    resolver.resolve({
                        type: 'greatestGameScore',
                        data: data
                    });

                });

        });

    return resolver.promise;

}



function leaderboardForStats() {

    var resolver = BPromise.pending();

    leaderboard.get()
        .then(function(res) {
            resolver.resolve({
                type: 'leaderboard',
                data: res
            });
        });

    return resolver.promise;

}
