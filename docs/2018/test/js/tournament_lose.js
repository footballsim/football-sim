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


    /**
     * TournamentLoseCtrl
     */
    app.controller('TournamentLoseCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                if (sessionStorage.getItem('page') != 'tournament_lose') {
                    var url = location.origin + location.pathname;
                    location.href = url.substring(0, url.lastIndexOf('/') + 1);
                }

                var env = JSON.parse(sessionStorage.getItem('env'));
                $rootScope.name = env.name;
                $rootScope.result = env.result;
                $rootScope.glPoint = env.glPoint;
                $rootScope.stage = env.stage;

                $scope.playerPoint = Number(env.playerPoint).toLocaleString();

                $scope.result = $rootScope.result;
                $scope.message1 = $rootScope.name + "ジャパン";
                switch ($rootScope.stage) {
                    case 4:
                        $scope.message2 = "ベスト8ならず！";
                        break;
                    case 5:
                        $scope.message2 = "ベスト4ならず！";
                        break;
                    case 6:
                        $scope.message2 = "決勝進出ならず！";
                        break;
                    case 7:
                        $scope.message2 = "準優勝！！";
                        break;
                }
                $scope.sharetext = $scope.message1 + "、" + $scope.message2;
                $scope.$apply();
            });

            $scope.restart = function() {
                sessionStorage.setItem('page', 'init');
                location.href = sessionStorage.getItem('url') + 'init.html';
            };

            $scope.replay = function() {
                var env = JSON.parse(sessionStorage.getItem('env'));
                env.result = [];
                env.glPoint = [
                    {
                        'country': '日本',
                        'win': 0,
                        'lose': 0,
                        'draw': 0,
                        'point': 0,
                        'goalFor': 0,
                        'goalAgainst': 0},
                    {
                        'country': 'コロンビア',
                        'win': 2,
                        'lose': 0,
                        'draw': 0,
                        'point': 6,
                        'goalFor': 4,
                        'goalAgainst': 0},
                    {
                        'country': 'セネガル',
                        'win': 1,
                        'lose': 1,
                        'draw': 0,
                        'point': 3,
                        'goalFor': 2,
                        'goalAgainst': 2},
                    {
                        'country': 'ポーランド',
                        'win': 0,
                        'lose': 2,
                        'draw': 0,
                        'point': 0,
                        'goalFor': 1,
                        'goalAgainst': 5},
                ];
                env.playerPoint = 0;
                env.stage = 0;
                sessionStorage.setItem('env', JSON.stringify(env));
                sessionStorage.setItem('page', 'ingame');
                location.href = sessionStorage.getItem('url') + 'ingame.html';
            };
        }]);

    /**
     * RankingCtrl
     */
    app.controller('RankingCtrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                $http.get('remote.php?action=getranking').
                    success(function(data, status, headers, config) {
                        $scope.ranking = data.ranking;
                        $scope.ranking.forEach(function(item, index, array) {
                            item.point = Number(item.point).toLocaleString();
                        });
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            });
        }]);

})();
