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
     * SelectCategoryCtrl
     */
    app.controller('SelectCategoryCtrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                $http.get('remote.php?action=getcategorylist&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        $scope.categories = data;
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            });

            $scope.submit = function(category) {
                $rootScope.category = category;
                $scope.myNavigator.pushPage(
                    'views/singlematch/selectteam.html?v=' + Date.now());
            };
        }]);

    /**
     * SelectTeamCtrl
     */
    app.controller('SelectTeamCtrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                $http.get('remote.php?action=getteamlist&category='
                        + $rootScope.category + '&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        $scope.teams = data;
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            });

            $scope.submit = function(teamid) {
                $http.get('remote.php?action=getteam&id=' + teamid
                        + '&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        var env = {team1: data};
                        sessionStorage.setItem('env', JSON.stringify(env));
                        location.href = "./singlematch2.html";
                        console.log(data);
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            };
        }]);

    /**
     * SelectCategory2Ctrl
     */
    app.controller('SelectCategory2Ctrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                var env = JSON.parse(sessionStorage.getItem('env'));
                if (env.team1 === undefined)
                    location.href = "./singlematch.html";
                $http.get('remote.php?action=getcategorylist&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        $scope.categories = data;
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            });

            $scope.submit = function(category) {
                $rootScope.category = category;
                $scope.myNavigator.pushPage(
                    'views/singlematch/selectteam2.html?v=' + Date.now());
            };
        }]);

    /**
     * SelectTeam2Ctrl
     */
    app.controller('SelectTeam2Ctrl', ['$scope', '$rootScope', '$http',
        function($scope, $rootScope, $http) {
            ons.ready(function() {
                $http.get('remote.php?action=getteamlist&category='
                        + $rootScope.category + '&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        $scope.teams = data;
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            });

            $scope.submit = function(teamid) {
                $http.get('remote.php?action=getteam&id=' + teamid
                        + '&v=' + Date.now()).
                    success(function(data, status, headers, config) {
                        var env = JSON.parse(sessionStorage.getItem('env'));
                        env.team2 = data;
                        sessionStorage.setItem('env', JSON.stringify(env));
                        location.href = "./singlematch_ingame.html";
                    }).
                    error(function(data, status, headers, config) {
                        console.log("ERROR!!!!!!!!");
                    });
            };
        }]);

})();
