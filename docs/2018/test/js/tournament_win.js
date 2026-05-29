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
     * TournamentWinCtrl
     */
    app.controller('TournamentWinCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                if (sessionStorage.getItem('page') != 'tournament_win') {
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
                        $scope.message2 = "ベスト8進出！";
                        break;
                    case 5:
                        $scope.message2 = "ベスト4進出！";
                        break;
                    case 6:
                        $scope.message2 = "決勝進出！";
                        break;
                }
                $scope.sharetext = $scope.message1 + "、" + $scope.message2;
                $scope.$apply();
            });

            $scope.submit = function() {
                $rootScope.stage += 1;

                var env = JSON.parse(sessionStorage.getItem('env'));
                env.stage = $rootScope.stage;
                sessionStorage.setItem('env', JSON.stringify(env));
                sessionStorage.setItem('page', 'ingame');
                location.href = sessionStorage.getItem('url') + 'ingame.html';
            };
        }]);

})();
