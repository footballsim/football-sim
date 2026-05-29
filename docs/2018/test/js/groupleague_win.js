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
     * GroupLeagueWinCtrl
     */
    app.controller('GroupLeagueWinCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                if (sessionStorage.getItem('page') != 'groupleague_win') {
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
                $scope.glPoint = $rootScope.glPoint;
                $scope.sharetext = $rootScope.name + "ジャパン、グループリーグ";
                if ($rootScope.glPoint[0].country == '日本')
                    $scope.sharetext += "を一位通過！";
                else if ($rootScope.glPoint[1].country == '日本')
                    $scope.sharetext += "を二位通過！";
                else
                    $scope.sharetext += "敗退。";
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
