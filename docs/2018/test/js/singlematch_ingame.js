const FBSIM_VERSION = (new Date).getTime();

(function(){
    'use strict';

//    window.onbeforeunload = function() { return "ゲームを終了します。"; };
    
    var app = angular.module('myApp', ['onsen']);

    app.run(function($rootScope, $templateCache) {
        $rootScope.$on('$viewContentLoaded', function() {
            $templateCache.removeAll();
        });
    });

    app.controller('AppCtrl', function($scope) { });


    /**************************************************************
     * 試合前
     */

    /**
     * SettingCtrl
     */
    app.controller('SettingCtrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                var env = JSON.parse(sessionStorage.getItem('env'));
                if (env.team1 === undefined || env.team2 === undefined)
                    location.href = "./singlematch.html";

                $rootScope.game = new Game();
                $rootScope.game.team1 = new Team(env.team1.name,
                        env.team1.players, env.team1.default_lineup,
                        env.team1.default_system,
                        env.team1.default_tactics,
                        env.team1.default_keyplayer,
                        env.team1.team_color,
                        env.team1.flag_image);
                $rootScope.game.team2 = new Team(env.team2.name,
                        env.team2.players, env.team2.default_lineup,
                        env.team2.default_system,
                        env.team2.default_tactics,
                        env.team2.default_keyplayer,
                        env.team2.team_color,
                        env.team2.flag_image);
                $scope.game = $rootScope.game;

                $scope.game.reset();
//                $scope.game.team1.score = env.debugScore; // テスト用

                $rootScope.ingame = false;
                $rootScope.swapCount = 0;

                $scope.$watch('game.team1.system', function() {
                    $scope.fieldplayerPos = [];
                    for (var i = 0; i < 11; i++) {
                        var x = $scope.game.team1.getPositionX(i);
                        var y = $scope.game.team1.getPositionY(i) / 2 + 48;
                        $scope.fieldplayerPos[i] = {left: x + '%', top: y + '%'};
                    }
                });
                $scope.$watch('game.team2.system', function() {
                    if ($scope.game.team2) {
                        $scope.fieldplayerPos2 = [];
                        for (var i = 0; i < 11; i++) {
                            var x = 100 - $scope.game.team2.getPositionX(i);
                            var y = 50.5 - $scope.game.team2.getPositionY(i) / 2;
                            $scope.fieldplayerPos2[i] = {left: x + '%', top: y + '%'};
                        }
                    }
                });

                $scope.$apply();
            });

            $scope.memstatus = function(i) {
                $scope.myNavigator.pushPage(
                        'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                        {item: $scope.game.team1.getPlayerAtPosition(i)});
            };

            $scope.memstatus2 = function(i) {
                $scope.myNavigator.pushPage(
                        'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                        {item: $scope.game.team2.getPlayerAtPosition(i)});
            };

            $scope.selectSystem = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_system.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectTactics = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_tactics.html?v='
                        + FBSIM_VERSION);
            };

            $scope.swapPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_swapplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectKeyPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_keyplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectMarkPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_markplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.submit = function() {
                $scope.myNavigator.resetToPage(
                        'views/singlematch/ingame.html?v=' + FBSIM_VERSION);
            };
        }]);

    /**
     * SettingSystemCtrl
     */
    app.controller('SettingSystemCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.systems = system_data;
                $scope.system = $scope.game.team1.system;
            });

            $scope.submit = function() {
                $scope.game.team1.system = $scope.system;
                $scope.myNavigator.popPage();
            };
        }]);

    /**
     * SettingTacticsCtrl
     */
    app.controller('SettingTacticsCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.tacticslist = tactics_data;
                $scope.tactics = $scope.game.team1.tactics;
            });

            $scope.submit = function() {
                $scope.game.team1.tactics = $scope.tactics;
                $scope.myNavigator.popPage();
            };
        }]);

    /**
     * SettingSwapPlayerCtrl
     */
    app.controller('SettingSwapPlayerCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.player1 = -1;

                $scope.lineup = [];
                for (var i = 0; i < 11; i++) {
                    $scope.lineup.push(
                        $scope.game.team1.getPlayerAtPosition(i));
                }

                $scope.system = $scope.game.team1.getSystem();
            });

            $scope.memstatus = function(i) {
                $scope.myNavigator.pushPage(
                    'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                    {item: $scope.lineup[i]});
            };

            $scope.submit = function() {
                $scope.myNavigator.replacePage(
                    'views/tournament/setting_swapplayer2.html?v='
                        + FBSIM_VERSION,
                    {player1: $scope.player1});
            };
        }]);

    app.controller('SettingSwapPlayer2Ctrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.players = $rootScope.game.team1.players;
                $scope.player1
                    = $scope.myNavigator.getCurrentPage().options.player1;
                $scope.player2 = -1;

                $scope.lineup = $rootScope.game.team1.lineup;
                $scope.members = [];
                for (var i = 0; i < $scope.lineup.length; i++) {
                    $scope.members.push($scope.players[$scope.lineup[i]]);
                }

                $scope.system = $scope.game.team1.getSystem();
            });

            $scope.memstatus = function(i) {
                $scope.myNavigator.pushPage(
                    'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                    {item: $scope.members[i]});
            };

            $scope.submit = function() {
                var p = $scope.lineup[$scope.player1];
                $scope.lineup[$scope.player1] = $scope.lineup[$scope.player2];
                $scope.lineup[$scope.player2] = p;
                if ($rootScope.ingame && $scope.player2 >= 11) {
                    if (++$rootScope.swapCount >= 3) {
                        for (var i = 11; i < $scope.lineup.length; i++) {
                            $scope.players[$scope.lineup[i]].used = true;
                        }
                    } else {
                        $scope.players[p].used = true;
                    }
                }
                $scope.myNavigator.popPage();
            };
        }]);

    /**
     * SettingKeyPlayerCtrl
     */
    app.controller('SettingKeyPlayerCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.keyplayer = $scope.game.team1.keyplayer;

                $scope.lineup = [];
                for (var i = 0; i < 11; i++) {
                    $scope.lineup.push(
                        $scope.game.team1.getPlayerAtPosition(i));
                }

                $scope.system = $scope.game.team1.getSystem();
            });

            $scope.submit = function() {
                $scope.game.team1.keyplayer = $scope.keyplayer;
                $scope.myNavigator.popPage();
            };
        }]);

    /**
     * SettingMarkPlayerCtrl
     */
    app.controller('SettingMarkPlayerCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.markplayer = $scope.game.team2.keyplayer;

                $scope.lineup = [];
                for (var i = 0; i < 11; i++) {
                    $scope.lineup.push(
                        $scope.game.team2.getPlayerAtPosition(i));
                }

                $scope.system = $scope.game.team2.getSystem();
            });

            $scope.submit = function() {
                $scope.game.team2.keyplayer = $scope.markplayer;
                $scope.myNavigator.popPage();
            };
        }]);


    /**************************************************************
     * 試合中
     */

    /**
     * InGameCtrl
     */
    app.controller('InGameCtrl',
        ['$scope', '$rootScope', '$compile',
        function($scope, $rootScope, $compile) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $scope.settingbuttondisabled = true;
                $scope.processedChanceNo = -1;

                // TODO
                $scope.setting = {};
                $scope.score1 = 0;
                $scope.score2 = 0;

                $scope.sceneCounter = 0;
                $scope.scenes = [];
                $scope.game.report = [];

                $scope.commentary = angular.element(document.getElementById('ingame-commentary'));

                $scope.$apply();
            });

            $scope.updateScene = function(scene) {
                var x, y, fw;
                
                switch (scene.area.substr(0, 2)) {
                    case 'DF':
                        x = -1;
                        break;
                    case 'MF':
                        x = 0;
                        break;
                    default:
                        x = 1;
                        break;
                }
                switch (scene.area.substr(3, 1)) {
                    case 'L':
                        y = -1;
                        break;
                    case 'R':
                        y = 1;
                        break;
                    default:
                        y = 0;
                        break;
                }

                if (scene.offence === $scope.game.team1) {
                    $scope.matchup1 = scene.offence.getPlayerAtPosition(scene.ofsPos);
                    $scope.matchup2 = scene.defence.getPlayerAtPosition(scene.dfsPos);
                    $scope.ballimage = 'btl-left';
                } else {
                    $scope.matchup2 = scene.offence.getPlayerAtPosition(scene.ofsPos);
                    $scope.matchup1 = scene.defence.getPlayerAtPosition(scene.dfsPos);
                    $scope.ballimage = 'btl-right';
                    x *= -1;
                    y *= -1;
                }
                x = x * 25 + 36;
                y = y * 30 + 42;
                $scope.matchupPos = {left: x + '%', top: y + '%'};

                fw = document.getElementById("fieldbox").clientWidth;
                $scope.matchupIconSize = {height: (40 * fw / 450) + 'px'};

                $scope.commentary.append($compile('<p>' + scene.text + '</p>')($scope));
                $scope.game.report.push('<p>' + scene.text + '</p>');
            };

            $scope.nextChanceScene = function() {
                if ($scope.processedChanceNo == $scope.game.chanceNo)
                    return;
                $scope.processedChanceNo = $scope.game.chanceNo;

                if ($scope.game.chanceNo == 10 || $scope.game.chanceNo == 15) {
                    // ロスタイム
                    if (Math.random() < 0.5) {
                        $scope.game.chanceNo++;
                        $scope.processedChanceNo = $scope.game.chanceNo;
                    }
                }

                if ($scope.game.chanceNo == 11) {
                    var icon;

                    if ($scope.game.team1.score > $scope.game.team2.score) {
                        icon = '◯';
                    } else if ($scope.game.team1.score < $scope.game.team2.score) {
                        icon = '●';
                    } else {
                        icon = '△';
                    }

                    $rootScope.result = {country: $scope.game.team2.name,
                            score1: $scope.game.team1.score,
                            score2: $scope.game.team2.score,
                            icon: icon};

                    $scope.myNavigator.resetToPage(
                        'views/singlematch/result.html?v=' + FBSIM_VERSION);
                } else {
                    var log = $scope.game.makeChanceScene();
                    /*
                    console.log(log);
                    console.log($scope.game.scenes);
                    */

                    $scope.commentary.empty();
                    $scope.commentary.append($compile("<p>" + $scope.game.chanceTime + "</p>")($scope));
                    $scope.game.report.push('<p style="padding-top: 10px;"><big>' + $scope.game.chanceTime + '</big></p>');

                    // DEBUG
                    if ($scope.game.scenes[0] === undefined) {
                        console.log(log);
                        console.log($scope.game.scenes);
                    }
                    $scope.updateScene($scope.game.scenes[0]);

                    $scope.sceneCounter = 1;

                    if ($scope.game.scenes.length <= 1) {
                        $scope.score1 = $scope.game.team1.score;
                        $scope.score2 = $scope.game.team2.score;
                        $scope.settingbuttondisabled = false;
                    } else {
                        $scope.settingbuttondisabled = true;
                    }
                }
            };

            $scope.nextButton = function() {
                if (!$scope.nextbuttonenabled)
                    return;
                $scope.nextbuttonenabled = false;
                if ($scope.sceneCounter < $scope.game.scenes.length) {
                    $scope.commentary.empty();
                    $scope.updateScene($scope.game.scenes[$scope.sceneCounter++]);
                } else {
                    $scope.nextChanceScene();
                }

                if ($scope.sceneCounter >= $scope.game.scenes.length) {
                    $scope.score1 = $scope.game.team1.score;
                    $scope.score2 = $scope.game.team2.score;
                    $scope.settingbuttondisabled = false;
                }
                $scope.nextbuttonenabled = true;
            };

            $scope.setting = function() {
                $scope.myNavigator.pushPage(
                        'views/singlematch/ingame_setting.html?v='
                        + FBSIM_VERSION);
            };

            $scope.nextChanceScene();
            $scope.nextbuttonenabled = true;
        }]);

    /**
     * IngameSettingCtrl
     */
    app.controller('IngameSettingCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                $scope.game = $rootScope.game;
                $rootScope.ingame = true;

                $scope.$watch('game.team1.system', function() {
                    $scope.fieldplayerPos = [];
                    for (var i = 0; i < 11; i++) {
                        var x = $scope.game.team1.getPositionX(i);
                        var y = $scope.game.team1.getPositionY(i) / 2 + 48;
                        $scope.fieldplayerPos[i] = {left: x + '%', top: y + '%'};
                    }
                });
                $scope.$watch('game.team2.system', function() {
                    $scope.fieldplayerPos2 = [];
                    for (var i = 0; i < 11; i++) {
                        var x = 100 - $scope.game.team2.getPositionX(i);
                        var y = 50.5 - $scope.game.team2.getPositionY(i) / 2;
                        $scope.fieldplayerPos2[i] = {left: x + '%', top: y + '%'};
                    }
                });
            });

            $scope.memstatus = function(i) {
                $scope.myNavigator.pushPage(
                        'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                        {item: $scope.game.team1.getPlayerAtPosition(i)});
            };

            $scope.memstatus2 = function(i) {
                $scope.myNavigator.pushPage(
                        'views/tournament/memstatus.html?v=' + FBSIM_VERSION,
                        {item: $scope.game.team2.getPlayerAtPosition(i)});
            };

            $scope.selectSystem = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_system.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectTactics = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_tactics.html?v='
                        + FBSIM_VERSION);
            };

            $scope.swapPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_swapplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectKeyPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_keyplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.selectMarkPlayer = function() {
                $scope.myNavigator.pushPage(
                        'views/tournament/setting_markplayer.html?v='
                        + FBSIM_VERSION);
            };

            $scope.submit = function() {
                $scope.myNavigator.popPage();
            };
        }]);

    /**
     * InGameResultCtrl
     */
    app.controller('InGameResultCtrl', ['$scope', '$rootScope', '$compile',
            '$http',
        function($scope, $rootScope, $compile, $http) {
            ons.ready(function() {
                var i, r;

                // console.table($rootScope.result);

                $scope.result = $rootScope.result;

                $scope.game = $rootScope.game;
                $scope.report = angular.element(
                    document.getElementById('gamereport'));
                $scope.game.report.forEach(function (item) {
                    $scope.report.append($compile(item)($scope));
                });

                $scope.$apply();
            });

            $scope.submit = function() {
                var env = JSON.parse(sessionStorage.getItem('env'));
                env.team1.default_lineup = $rootScope.game.team1.lineup;
                env.team1.default_system
                    = system_data[$rootScope.game.team1.system].name;
                env.team1.default_tactics = $rootScope.game.team1.tactics;
                env.team1.default_keyplayer = $rootScope.game.team1.keyplayer;
                env.result = $rootScope.result;

                sessionStorage.setItem('env', JSON.stringify(env));
                location.href = "singlematch_result.html";
            };
        }]);

    /**
     * MemStatusCtrl
     */
    app.controller('MemStatusCtrl', ['$scope', function($scope) {
        ons.ready(function() {
            $scope.item = $scope.myNavigator.getCurrentPage().options.item;
            $scope.sdata = [
                Math.round(($scope.item.params[DRIBBLE_ACCURACY]
                        + $scope.item.params[DRIBBLE_SPEED]
                        + $scope.item.params[SHORTPASS_ACCURACY]
                        + $scope.item.params[SHORTPASS_SPEED]
                        + $scope.item.params[LONGPASS_ACCURACY]
                        + $scope.item.params[LONGPASS_SPEED]
                        + $scope.item.params[SHOOT_ACCURACY]
                        + $scope.item.params[SHOOT_MAKING]
                        + $scope.item.params[OFFENSIVE]) / 9),
                Math.round(($scope.item.params[PASS_CUT]
                        + $scope.item.params[TACKLE]
                        + $scope.item.params[MAN_MARKING]
                        + $scope.item.params[COVERING]
                        + $scope.item.params[CHASING]) / 5),
                Math.round(($scope.item.params[SHOOT_TECH]
                        + $scope.item.params[FREEKICK_ACCURACY]
                        + $scope.item.params[CURVE]
                        + $scope.item.params[BALL_TECH]) / 4),
                Math.round(($scope.item.params[POWER]
                        + $scope.item.params[STAMINA]
                        + $scope.item.params[JUMP]
                        + $scope.item.params[HEADING]) / 4),
                Math.round(($scope.item.params[TOP_SPEED]
                        + $scope.item.params[ACCELERATION]
                        + $scope.item.params[RESPONSE]
                        + $scope.item.params[AGILITY]) / 4),
                Math.round(($scope.item.params[POSITIONING]
                        + $scope.item.params[MENTALITY]
                        + $scope.item.params[CONDITION_STABILITY]
                        + $scope.item.params[STRATEGIC_EYE]) / 4)
                ];
            if ($scope.item.mposition == 'GK') {
                $scope.sdata[1] = Math.round(($scope.item.params[SAVING]
                            + $scope.item.params[HIGHBALL]) / 2);
            }
        });
    }]);

})();
