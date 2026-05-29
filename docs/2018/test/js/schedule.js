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
     * ScheduleCtrl
     */
    app.controller('ScheduleCtrl', ['$scope', '$rootScope',
        function($scope, $rootScope) {
            ons.ready(function() {
                if (sessionStorage.getItem('page') != 'schedule') {
                    var url = location.origin + location.pathname;
                    location.href = url.substring(0, url.lastIndexOf('/') + 1);
                }
            });

            $scope.submit = function() {
                sessionStorage.setItem('page', 'ingame');
                location.href = sessionStorage.getItem('url') + 'ingame.html';
            };
        }]);

})();
