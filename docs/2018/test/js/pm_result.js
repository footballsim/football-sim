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
     * PmResultCtrl
     */
    app.controller('PmResultCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                if (sessionStorage.getItem('page') != 'pm_result') {
                    var url = location.origin + location.pathname;
                    location.href = url.substring(0, url.lastIndexOf('/') + 1);
                }

                var env = JSON.parse(sessionStorage.getItem('env'));
                $rootScope.name = env.name;
                $rootScope.result = env.result;
                $rootScope.stage = env.stage;

                $scope.playerPoint = Number(env.playerPoint).toLocaleString();

                $scope.result = $rootScope.result;
                $scope.sharetext = $rootScope.name + "ジャパン、対"
                    + $scope.result[0].country + "に" + $scope.result[0].score1
                    + "-" + $scope.result[0].score2 + "で";
                if ($scope.result[0].icon == '◯') {
                    $scope.resultimg = 'win_small.jpg';
                    $scope.sharetext += "勝利！";
                } else if ($scope.result[0].icon == '●') {
                    $scope.resultimg = 'lose_small.jpg';
                    $scope.sharetext += "敗北。";
                } else {
                    $scope.resultimg = 'lose_small.jpg';
                    $scope.sharetext += "引き分け。";
                }
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
