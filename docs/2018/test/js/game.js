/*******************************************************************************
 * Team オブジェクト
 */
var Team = function(name, players, lineup, system, tactics, keyplayer,
		team_color, flag_image) {
	this.name = name;
	this.players = players;
	this.lineup = lineup;
	this.system = 0;
	for ( var i = 0; i < system_data.length; i++) {
		if (system_data[i].name == system) {
			this.system = i;
			break;
		}
	}
	this.tactics = tactics;
	this.keyplayer = keyplayer;
	this.team_color = team_color;
	this.flag_image = flag_image;
	
    this.reset();
};

Team.prototype = {
	reset : function() {
		for ( var i = this.players.length - 1; i >= 0; i--) {
			var r = Math.random();
			var condition = 4;
			if (r < 0.08)
				condition = 0;
			else if (r < 0.25)
				condition = 1;
			else if (r < 0.75)
				condition = 2;
			else if (r < 0.92)
				condition = 3;
			this.players[i]["condition"] = condition;

			this.players[i]["chance_counter"] = 0;

			// TODO: 疲労の蓄積に対応
			this.players[i]["fatigue"] = 0;

			this.players[i]["used"] = false;
		}

        this.currentParams = [];
		this.score = 0;
		this.chanceCounter = 0;
		this.shootCounter = 0;
		this.gkSaveCounter = 0;
        this.goals = [];
	},
	getPlayer : function(n) {
		return this.players[n];
	},
	getPlayerNoAtPosition : function(position) {
		return this.lineup[position];
	},
	getPlayerAtPosition : function(position) {
		return this.getPlayer(this.lineup[position]);
	},
	getKeyPlayer : function() {
		return this.players[this.lineup[this.keyplayer]];
	},
	getSystem : function() {
		return system_data[this.system];
	},
	getTactics : function() {
		return tactics_data[this.tactics];
	},
	getPositionName : function(position) {
		if (position < 11)
			return system_data[this.system].positions[position];
		return null;
	},
	getPositionX : function(position) {
		if (position < 11)
			return system_data[this.system].x[position];
		return 0;
	},
	getPositionY : function(position) {
		if (position < 11)
			return system_data[this.system].y[position];
		return 0;
	},
	getPositionType : function(position) {
		if (position < 11) {
			var res = this.getPositionName(position);
			if (res[0] == "右" || res[0] == "左")
				return res.substr(1);
			return res;
		}
		return null;
	},
	updateParams : function() {
		var total = 0.0;

		this.currentParams = [];
		for ( var position = 0; position < 11; position++) {
			var f = 1.0;
			var player = this.players[this.lineup[position]];

			// コンディションによる影響
			/*
			 * TODO: あとでコメントを外す var n = player.condition; if (n == 0) f += 0.15;
			 * else if (n == 1) f += 0.07; else if (n == 3) f -= 0.07; else if
			 * (n == 4) f -= 0.15;
			 */

			// 得意ポジションと実際の配置の照合
			var postype = this.getPositionType(position);
			var positions = player.positions;
			for ( var i = positions.length - 1; i >= 0; i--) {
				if (positions[i] == postype)
					break;
			}
			if (i < 0)
				f -= 0.05;

			// スタミナの影響

			i = 4 - Math.max(Math.floor(player.params[STAMINA] / 5), 5)
					+ Math.min(player.chance_counter, 16);
			if (i > 0 && position > 0)
				f -= 0.05 * i;

			// 疲労度による影響

			f -= 0.005 * Math.min(player.fatigue, 100);

			// パラメーターのコピー
			var params = [];
			for (i = 0; i < player.params.length; i++)
				params.push(player.params[i] * Math.max(f, 0.01));

			// 戦術による影響
			if (this.tactics == TACTICS_PRESS) {
				if (postype == "FW" || postype == "WG"
						|| postype.substr(-2) == "MF") {
					for (i = 20; i <= 29; i++)
						params[i] *= 1.10;
				}
			} else if (this.tactics == TACTICS_COUNTER) {
				if (postype == "SMF" || postype == "CMF" || postype == "DMF"
						|| postype == "SW" || postype.substr(-1) == "B") {
					for (i = 20; i <= 29; i++)
						params[i] *= 1.05;
				}
			} else if (this.tactics == TACTICS_CATENACCIO) {
				for (i = 0; i <= 19; i++)
					params[i] *= 0.95;
				for (i = 20; i <= 26; i++)
					params[i] *= 1.10;
			}

			for (i = params.length - 1; i >= 0; i--)
				total += params[i];
			this.currentParams.push(params);
		}
		return total;
	},
	getCurrentParam : function(position) {
		return this.currentParams[position];
	},
	getActionParam : function(position, action) {
		var params = this.currentParams[position];

		switch (action) {
		case "ショートパス":
			return (params[SHORTPASS_ACCURACY] + params[SHORTPASS_SPEED]) / 2;
		case "対ショートパス":
			return (params[RESPONSE] + params[PASS_CUT] + params[TACKLE]) / 3;
		case "ロングパス":
			return (params[LONGPASS_ACCURACY] + params[LONGPASS_SPEED]) / 2;
		case "対ロングパス":
			return (params[RESPONSE] + params[PASS_CUT]) / 2;
		case "ドリブル突破":
			return (params[ACCELERATION] + params[AGILITY]
					+ params[DRIBBLE_ACCURACY] + params[DRIBBLE_SPEED]) / 4;
		case "対ドリブル突破":
			return (params[RESPONSE] + params[TACKLE] + params[MAN_MARKING]) / 3;
		case "飛び出し":
			return (params[ACCELERATION] + params[RESPONSE] + params[AGILITY]
					+ params[POSITIONING] + params[OFFENSIVE]) / 5;
		case "対飛び出し":
			return (params[RESPONSE] + params[ACCELERATION] + params[AGILITY]
					+ params[COVERING] + params[CHASING]) / 5;
		case "ポストプレー":
			return (params[POWER] + params[RESPONSE]
					+ params[SHORTPASS_ACCURACY] + params[SHORTPASS_SPEED] + params[BALL_TECH]) / 5;
		case "対ポストプレー":
			return (params[POWER] + params[RESPONSE] + params[TACKLE] + params[MAN_MARKING]) / 4;
		case "クロス":
			return (params[LONGPASS_ACCURACY] + params[LONGPASS_SPEED] + params[CURVE]) / 3;
		case "対クロス":
			return (params[ACCELERATION] + params[RESPONSE] + params[PASS_CUT]
					+ params[TACKLE] + params[MAN_MARKING]) / 5;
		case "中央からシュート":
			return (params[SHOOT_ACCURACY] + params[SHOOT_MAKING]
					+ params[SHOOT_TECH] + params[MENTALITY]) / 4;
		case "サイドからシュート":
			return (params[SHOOT_ACCURACY] + params[SHOOT_MAKING]
					+ params[SHOOT_TECH] + params[MENTALITY]) / 4 * 0.95;
		case "対中央からシュート":
		case "対サイドからシュート":
			return (params[RESPONSE] + params[JUMP] + params[POSITIONING]
					+ params[MENTALITY] + params[SAVING]) / 5;
		case "ボレーシュート":
			return (params[SHOOT_ACCURACY] + params[SHOOT_MAKING]
					+ params[SHOOT_TECH] + params[BALL_TECH] + params[POSITIONING]) / 5 * 1.1;
		case "対ボレーシュート":
			if (position == 0) // GK
				return (params[RESPONSE] + params[JUMP] + params[POSITIONING] + params[SAVING]) / 4;
			else
				return (params[RESPONSE] + params[MAN_MARKING] + params[POSITIONING]) / 3;
		case "ヘディングシュート":
			return (params[JUMP] + params[HEADING] + params[POSITIONING]) / 3 * 1.1;
		case "対ヘディングシュート":
			if (position == 0) // GK
				return (params[RESPONSE] + params[JUMP] + params[POSITIONING] + params[SAVING]) / 4;
			else
				return (params[RESPONSE] + params[JUMP] + params[MAN_MARKING] + params[HEADING] + params[POSITIONING]) / 5;
		case "フリーキック":
			return (params[SHOOT_MAKING] + params[FREEKICK_ACCURACY]) / 2;
		case "対フリーキック":
			return (params[RESPONSE] + params[JUMP] + params[SAVING]
					+ params[POSITIONING] + params[MENTALITY]) / 5;
		}
		return null;
	},
	selectFKKicker : function() {
		var a = [ [ 0, this.getActionParam(0, "フリーキック") ],
				[ 1, this.getActionParam(1, "フリーキック") ] ];
		for ( var i = 1; i < 11; i++) {
			var n = this.getActionParam(i, "フリーキック");
			if (n >= a[0][1]) {
                if (a[0][1] >= a[1][1])
                    a[1] = a[0];
				a[0] = [ i, n ];
            } else if (n >= a[1][1]) {
				a[1] = [ i, n ];
            }
		}
		return a[Math.floor(Math.random() * 2)][0];
	},
	addGoal : function(time, player) {
        this.score += 1;
        this.goals.push({'time': time, 'player': player});
    }
};

/*******************************************************************************
 * Game オブジェクト
 */
var Game = function() {
    this.date = "";
    this.weather = "";
    this.team1 = null;
    this.team2 = null;
    this.offence = null;
    this.defence = null;
    this.chanceNo = 0;
    this.chanceTime = "";
    this.log = "";
}

Game.prototype = {
	reset : function() {
		if (this.team1)
			this.team1.reset();
		if (this.team2)
			this.team2.reset();
		this.chanceNo = 0;
		this.clearLog();
	},
	addLog : function(mes) {
		this.log += mes + "\n";
	},
	clearLog : function() {
		this.log = "";
	},
	makeChanceScene : function() {
		var scene;
		var inCounter = false;

		this.clearLog();
		this.chanceTime = this.calcTime(this.chanceNo++);
		this.addLog("時間：" + this.chanceTime);

		// 各チーム出場選手のトータルポイントを計算
		var t1point = this.team1.updateParams();
		var t2point = this.team2.updateParams();
		this.addLog("Team1の総ポイント：" + t1point);
		this.addLog("Team2の総ポイント：" + t2point);
		var f = t1point / (t1point + t2point);
		this.addLog("Team1側攻撃確率：" + f);

		// 戦術による影響
		if (this.team1.tactics == TACTICS_POSSESSION)
			t1point *= 1.1;
		else if (this.team1.tactics == TACTICS_COUNTER)
			t1point *= 0.9;
		else if (this.team1.tactics == TACTICS_CATENACCIO)
			t1point *= 0.9;
		if (this.team2.tactics == TACTICS_POSSESSION)
			t2point *= 1.1;
		else if (this.team2.tactics == TACTICS_COUNTER)
			t2point *= 0.9;
		else if (this.team2.tactics == TACTICS_CATENACCIO)
			t2point *= 0.9;

		// 攻撃側チームの決定
		f = t1point / (t1point + t2point);
		this.addLog("戦術による影響を考慮後：" + f);
		if (Math.random() < f) {
			this.offence = this.team1;
			this.defence = this.team2;
			this.addLog("攻撃： Team1");
		} else {
			this.offence = this.team2;
			this.defence = this.team1;
			this.addLog("攻撃： Team2");
		}

		this.scenes = [];

		// ************************************************
		// シーン1

		this.addLog("***** シーン" + (this.scenes.length + 1) + " *****");

		// エリアの決定
		var area = this.selectArea();
		this.addLog("エリア：" + area_data[area].name);

		// 攻撃側ポジションの決定
		var ofsPos = this.selectOffencePosition(area);
		var ofsPlayer = this.offence.getPlayerAtPosition(ofsPos);
		this.addLog("攻撃側：" + this.offence.getPositionName(ofsPos) + "　"
				+ ofsPlayer.name);
		ofsPlayer.chance_counter++;
		ofsPlayer.fatigue++;

		// 守備側ポジションの決定
		var dfsPos = this.selectDefencePosition(area, ofsPos, -1);
        if (dfsPos < 0) {
            this.addLog("***** 守備側選手を選択できません ***");
            return this.log;
        }
		var dfsPlayer = this.defence.getPlayerAtPosition(dfsPos);
		this.addLog("守備側：" + this.defence.getPositionName(dfsPos) + "　"
				+ dfsPlayer.name);
		dfsPlayer.chance_counter++;
		dfsPlayer.fatigue++;

		// アクション決定
		var action = this.selectAction(area, ofsPos);
		this.addLog("アクション：" + action);

		// 成否の決定
		var ofsPoint = this.offence.getActionParam(ofsPos, action);
		var dfsPoint = this.defence.getActionParam(dfsPos, "対" + action);
        /*
		if (this.defence == this.team1 && ofsPos == this.team2.keyplayer) {
			this.addLog("要注意プレーヤーに該当：攻撃側15％ダウン");
			ofsPoint *= 0.85;
		}
        */
		// TODO: scouted_playerとweatherの影響
		this.addLog("攻撃側ポイント：" + ofsPoint);
		this.addLog("守備側ポイント：" + dfsPoint);
		this.addLog("結果：" + (ofsPoint > dfsPoint ? "成功" : "失敗"));

		scene = {
			offence : this.offence,
			defence : this.defence,
			area : area,
			ofsPos : ofsPos,
			dfsPos : dfsPos,
			action : action,
			scenario : action,
			result : ofsPoint > dfsPoint ? "成功" : "失敗"
		};
		this.scenes.push(scene);

		if (scene.result == "失敗" && !inCounter && this.testCounterAtack(scene)) {
			inCounter = true;
			
			var t = this.offence;
			this.offence = this.defence;
			this.defence = t;

			// 次がクロスかシュートの場合に備えて
			ofsPos = dfsPos;
			ofsPlayer = dfsPlayer;

			scene.result = "カウンター";
			this.addLog("【カウンター発動】");
		}

		// ************************************************
		// シーン2以降

		while (scene.result == "成功" || scene.result == "カウンター") {

			// エリアの決定
			area = this.selectNextArea(scene);
			if (area.substr(0, 2) == "CR")
				break;

			this.addLog("***** シーン" + (this.scenes.length + 1) + " *****");
			this.addLog("エリア：" + area_data[area].name);

			// 攻撃側ポジションの決定
			ofsPos = this.selectOffencePosition(area);
			if (scene.action == "ロングパス") {
				while (ofsPos == scene.ofsPos)
					ofsPos = this.selectOffencePosition(area);
			}
			ofsPlayer = this.offence.getPlayerAtPosition(ofsPos);
			this.addLog("攻撃側：" + this.offence.getPositionName(ofsPos) + "　"
					+ ofsPlayer.name);
			ofsPlayer.chance_counter++;
			ofsPlayer.fatigue++;

			// 守備側ポジションの決定
			dfsPos = this.selectDefencePosition(area, ofsPos,
					scene.result == "成功" ? scene.dfsPos : -1);
			if (dfsPos < 0) {
				this.addLog("***** 守備側選手を選択できません ***");
				return this.log;
			}
			dfsPlayer = this.defence.getPlayerAtPosition(dfsPos);
			this.addLog("守備側：" + this.defence.getPositionName(dfsPos) + "　"
					+ dfsPlayer.name);
			dfsPlayer.chance_counter++;
			dfsPlayer.fatigue++;

			// アクション決定
			action = this.selectAction(area, ofsPos);
			this.addLog("アクション：" + action);

			// 成否の決定
			ofsPoint = this.offence.getActionParam(ofsPos, action);
			dfsPoint = this.defence.getActionParam(dfsPos, "対" + action);
            /*
			if (this.defence == this.team1 && ofsPos == this.team2.keyplayer) {
				this.addLog("要注意プレーヤーに該当：攻撃側15％ダウン");
				ofsPoint *= 0.85;
			}
            */
			// TODO: scouted_playerとweatherの影響
			this.addLog("攻撃側ポイント：" + ofsPoint);
			this.addLog("守備側ポイント：" + dfsPoint);
			this.addLog("結果：" + (ofsPoint > dfsPoint ? "成功" : "失敗"));

			scene = {
				offence : this.offence,
				defence : this.defence,
				area : area,
				ofsPos : ofsPos,
				dfsPos : dfsPos,
				action : action,
				scenario : action,
				result : ofsPoint > dfsPoint ? "成功" : "失敗"
			};
			this.scenes.push(scene);

			if (scene.result == "成功") {
				if (area.substr(0, 2) == "FW") {
					f = (100 - this.defence.getCurrentParam(dfsPos)[FAIR_PLAY]) / 100;
					this.addLog("ファールの確率：" + f);
					if (Math.random() < f) {
						this.addLog("ファール！");
						area = "CR_" + area.substr(-1);
						scene.result = "ファール";
						break;
					}
					this.addLog("ファールなし");
				}
			} else if (!inCounter && this.testCounterAtack(scene)) {
				inCounter = true;
				
				var t = this.offence;
				this.offence = this.defence;
				this.defence = t;

				// 次がクロスかシュートの場合に備えて
				ofsPos = dfsPos;
				ofsPlayer = dfsPlayer;

				scene.result = "カウンター";
				this.addLog("【カウンター発動】");
			}
		}

		if (area.substr(0, 2) == "CR") {
			CrossScene: {
				this.offence.chanceCounter++;
				
				if (scene.result == "ファール") {
					if (area.substr(-1) == "M") {
						// FKキッカーの決定
						ofsPos = this.offence.selectFKKicker();
						ofsPlayer = this.offence.getPlayerAtPosition(ofsPos);
						action = "フリーキック";
						break CrossScene;
					}

					this.addLog("***** セットプレー *****");

					crossPos = this.offence.selectFKKicker();
					crossPlayer = this.offence.getPlayerAtPosition(crossPos);
					this.addLog("キッカー：" + crossPlayer.name);

					// 攻撃側ポジションの決定
					ofsPos = crossPos;
					while (ofsPos == crossPos)
						ofsPos = this.selectOffencePosition(area);
				} else {
					if (area.substr(-1) == "M") {
						action = "中央からシュート";
						break CrossScene;
					}

					// 攻撃側ポジションの決定
					crossPos = ofsPos;
					crossPlayer = ofsPlayer;
					ofsPos = this.selectOffencePosition(area);
					if (ofsPos == crossPos) {
						action = "サイドからシュート";
						break CrossScene;
					}

					this.addLog("***** クロスシーン *****");
				}

				ofsPlayer = this.offence.getPlayerAtPosition(ofsPos);
				this.addLog("クロス攻撃側：" + this.offence.getPositionName(ofsPos)
						+ "　" + ofsPlayer.name);

				// 守備側ポジションの決定
				dfsPos = this.selectDefencePosition(area, ofsPos,
						scene.result == "カウンター" ? -1 : scene.dfsPos);
				dfsPlayer = this.defence.getPlayerAtPosition(dfsPos);
				this.addLog("クロス守備側：" + this.defence.getPositionName(dfsPos)
						+ "　" + dfsPlayer.name);

				ofsPlayer.chance_counter++;
				ofsPlayer.fatigue++;
				dfsPlayer.chance_counter++;
				dfsPlayer.fatigue++;

				// アクション決定
				action = this.selectAction(area, ofsPos);
				this.addLog("アクション：" + action);

				// 成否の決定
				ofsPoint = this.offence.getActionParam(ofsPos, action);
				dfsPoint = this.defence.getActionParam(dfsPos, "対" + action);
                /*
				if (this.defence == this.team1 && ofsPos == this.team2.keyplayer) {
					this.addLog("要注意プレーヤーに該当：攻撃側15％ダウン");
					ofsPoint *= 0.85;
				}
                */
				// TODO: scouted_playerとweatherの影響
				this.addLog("攻撃側ポイント：" + ofsPoint);
				this.addLog("守備側ポイント：" + dfsPoint);
				this.addLog("結果：" + (ofsPoint > dfsPoint ? "成功" : "失敗"));

				scene = {
					offence : this.offence,
					defence : this.defence,
					area : area,
					crossPos : crossPos,
					ofsPos : ofsPos,
					dfsPos : dfsPos,
					action : action,
					scenario : scene.result == "ファール" ? "セットプレー" : "クロス",
					result : ofsPoint > dfsPoint ? "成功" : "失敗"
				};
				this.scenes.push(scene);
			}

			if (scene.result != "失敗") {
				this.addLog("***** シュートシーン *****");
				
				this.offence.shootCounter++;

				// 攻撃側ポジションの決定
				this.addLog("シュート攻撃側：" + this.offence.getPositionName(ofsPos)
						+ "　" + ofsPlayer.name);

				// 守備側ポジションの決定
				dfsPos = 0; // GK
				dfsPlayer = this.defence.getPlayerAtPosition(dfsPos);
				this.addLog("シュート守備側：" + this.defence.getPositionName(dfsPos)
						+ "　" + dfsPlayer.name);

				// アクション決定（決定済）
				this.addLog("アクション：" + action);

				// 成否の決定
				ofsPoint = this.offence.getActionParam(ofsPos, action);
				dfsPoint = this.defence.getActionParam(dfsPos, "対" + action);
                /*
				if (this.defence == this.team1 && ofsPos == this.team2.keyplayer) {
					this.addLog("要注意プレーヤーに該当：攻撃側15％ダウン");
					ofsPoint *= 0.85;
				}
                */
				// TODO: scouted_playerとweatherの影響
				this.addLog("攻撃側ポイント：" + ofsPoint);
				this.addLog("守備側ポイント：" + dfsPoint);

				scene = {
					offence : this.offence,
					defence : this.defence,
					area : area,
					ofsPos : ofsPos,
					dfsPos : dfsPos,
					action : action,
					scenario : "シュート",
					result : ofsPoint > dfsPoint ? "成功" : "失敗"
				};

				if (Math.random() * 100 > ofsPoint) {
					scene.result = "枠を外した！";
					this.addLog("枠を外した！");
				} else if (ofsPoint > dfsPoint) {
					scene.result = "ゴール！！";
					this.addLog("ゴール！！");
					this.offence.addGoal(this.chanceTime, ofsPlayer);
					this.addLog(this.team1.name + " " + this.team1.score
							+ " : " + this.team2.score + " " + this.team2.name);
				} else {
					scene.result = "GK防いだ！";
					this.defence.gkSaveCounter++;
					this.addLog("GK防いだ！");
				}
				this.scenes.push(scene);
			}
		}

		for ( var i = 0; i < this.scenes.length; i++)
			this.scenes[i].text = this.sceneToText(i);

		return this.log;
	},
	calcTime : function(chanceNo) {
		var r = Math.random();
		if (chanceNo <= 3)
			return "前半" + (Math.floor(r * 10) + chanceNo * 10) + "分";
		else if (chanceNo == 4)
			return "前半" + (Math.floor(r * 6) + 40) + "分";
		else if (chanceNo <= 8)
			return "後半" + (Math.floor(r * 10) + (chanceNo - 5) * 10) + "分";
		else if (chanceNo == 9)
			return "後半" + (Math.floor(r * 6) + 40) + "分";
		else if (chanceNo == 10)
			return "後半ロスタイム";
		else if (chanceNo <= 12)
			return "延長前半" + (Math.floor(r * 8) + (chanceNo - 11) * 8) + "分";
		else if (chanceNo <= 14)
			return "延長後半" + (Math.floor(r * 8) + (chanceNo - 13) * 8) + "分";
		else
			return "延長後半ロスタイム";
	},
	// エリアの決定
	selectArea : function() {
		var areas = [ "MF_M", "MF_L", "MF_R", "DF_M", "DF_L", "DF_R" ];
		var n = 6;
		if (this.defence.tactics == TACTICS_COUNTER
				|| this.defence.tactics == TACTICS_CATENACCIO) {
			n = 3;
		}
		return areas[Math.floor(Math.random() * n)];
	},
	// 次のエリアの決定
	selectNextArea : function(lastScene) {
		var pos = lastScene.area.substr(0, 2);
		var side = lastScene.area.substr(-1);

		// カウンターならエリアを反転する
		if (lastScene.result == "カウンター") {
			if (pos == "DF")
				pos = "FW";
			else if (pos == "FW")
				pos = "DF";
			if (side == "R")
				side = "L";
			else if (side == "L")
				side = "R";
		}

		if (pos == "FW") {
			pos = "CR";
		} else {
			if (pos == "DF") {
				if (lastScene.result != "カウンター" && lastScene.action == "ロングパス") {
					pos = "FW";
				} else
					pos = "MF";
			} else
				pos = "FW";

			var r = Math.random();
			if (side == "M") {
				if (r < 0.3)
					side = "L";
				else if (r < 0.6)
					side = "R";
			} else {
				if (r < 0.4)
					side = "M";
			}
		}

		return pos + "_" + side;
	},
	// 攻撃側ポジションの決定
	selectOffencePosition : function(area) {
		var positions = this.offence.getSystem().positions;
		var offences = area_data[area].offences;
		var a = [];
		var sum = 0;
		for ( var i = offences.length - 1; i >= 0; i--) {
			var j = positions.indexOf(offences[i][0]);
			if (j >= 0) {
				var rate = offences[i][1];
				// キープレーヤーなら選ばれる確率が20％アップ
                /*
				if (j == this.offence.keyplayer)
					rate *= 1.2;
                */
				sum += rate;
				a.push([ j, sum ]);
			}
		}
		var r = Math.random();
		for (i = 0; i < a.length; i++) {
			if (r < a[i][1] / sum)
				return a[i][0];
		}
		return a[a.length - 1][0];
	},
	selectDefencePosition : function(area, ofsPos, omit) {
		var a = area_data[area].matchup[this.offence.getPositionName(ofsPos)];
		var positions = this.defence.getSystem().positions;
		var p0 = [];
		var p1 = [];
		var p2 = [];
		var p3 = [];
		var p4 = [];
		var pos, i, b;

		b = a[0];
		for (i = b.length - 1; i >= 0; i--) {
			if ((pos = positions.indexOf(b[i])) >= 0 && pos != omit)
				p0.push(pos);
		}
		b = a[1];
		for (i = b.length - 1; i >= 0; i--) {
			if ((pos = positions.indexOf(b[i])) >= 0 && pos != omit)
				p1.push(pos);
		}
		b = a[2];
		for (i = b.length - 1; i >= 0; i--) {
			if ((pos = positions.indexOf(b[i])) >= 0 && pos != omit)
				p2.push(pos);
		}
		b = a[3];
		for (i = b.length - 1; i >= 0; i--) {
			if ((pos = positions.indexOf(b[i])) >= 0 && pos != omit)
				p3.push(pos);
		}
		b = a[4];
		for (i = b.length - 1; i >= 0; i--) {
			if ((pos = positions.indexOf(b[i])) >= 0 && pos != omit)
				p4.push(pos);
		}

		if (p0.length + p1.length + p2.length + p3.length + p4.length == 0)
			return -1;

		while (1) {
			var r = Math.random();
			if (p0.length > 0 && r < 0.45)
				return p0[Math.floor(Math.random() * p0.length)];
			if (p1.length > 0 && r < 0.8)
				return p1[Math.floor(Math.random() * p1.length)];
			if (p2.length > 0)
				return p2[Math.floor(Math.random() * p2.length)];
			if (p3.length > 0)
				return p3[Math.floor(Math.random() * p3.length)];
			if (p4.length > 0)
				return p4[Math.floor(Math.random() * p4.length)];
		}
	},
	selectAction : function(area, position) {
		var a = area_data[area].actions;
		var areaType = area.substr(0, 2);
		var i;

		// TODO: 確率の変化に対応
		if (this.tactics == TACTICS_POSSESSION) {
			if ((areaType == "DF" || areaType == "MF")
					&& a.indexOf("ショートパス") >= 0
					&& Math.random() < 0.25 / a.length) {
				return "ショートパス";
			}
		} else if (this.tactics == TACTICS_CATENACCIO) {
			if (areaType == "DF") {
				i = a.indexOf("ロングパス");
				if (i >= 0) {
					if (Math.random() < 0.5)
						return "ロングパス";
					a.splice(i, 1);
				}
			}
		}

		var p = [];
		var sum = 0;
		for (i = 0; i < a.length; i++) {
			// アクションパラメータから60を引いた値で確率を計算
			sum += Math.max(this.offence.getActionParam(position, a[i]) - 60, 0);
			p.push(sum);
		}

		var r = Math.random();
		for (i = 0; i < a.length; i++) {
			if (r < p[i] / sum)
				return a[i];
		}
        return a[a.length - 1];
	},
	testCounterAtack : function(lastScene) {
		var pos = lastScene.area.substr(0, 2);
		var f = 0.05;

		switch (parseInt(lastScene.defence.tactics)) {
		case TACTICS_PRESS:
			if (pos == "DF" || pos == "MF")
				f = 0.2;
			break;
		case TACTICS_COUNTER:
			if (pos == "FW" || pos == "MF")
				f = 0.2;
			break;
		case TACTICS_CATENACCIO:
			if (pos == "FW")
				f = 0.15;
			break;
		}
		this.addLog("カウンター発動率：" + f);
		return Math.random() < f;
	},
	sceneToText : function(sceneNo) {
		var res = "";
		var scene = this.scenes[sceneNo];
		var key = scene.scenario + "|" + scene.result;
		switch (scene.scenario) {
		case "ショートパス":
		case "ロングパス":
		case "ドリブル突破":
		case "飛び出し":
		case "ポストプレー":
			if (scene.result == "成功") {
				key += "|" + this.scenes[sceneNo + 1].scenario;
				var ns = this.scenes[sceneNo + 1].scenario;
				if (ns != "クロス" && ns != "シュート") {
					key += (scene.ofsPos == this.scenes[sceneNo + 1].ofsPos ? "|同"
							: "|別");
				}
			}
			break;
		case "クロス":
		case "シュート":
		case "セットプレー":
			key += "|" + scene.action;
			break;
		}

		var s = scenario_data[key];
		if (s == undefined)
			return "***** シナリオデータ無し: " + key;

		if (s.indexOf("【対象エリア】") >= 0)
			s = s.split("【対象エリア】").join(area_data[scene.area].name);
		s = s.split("【攻撃選手】").join(
				this.getColoredPlayerName(scene.offence, scene.ofsPos));
		s = s.split("【守備選手】").join(
				this.getColoredPlayerName(scene.defence, scene.dfsPos));
		s = s.split("【シュート選手】").join(
				this.getColoredPlayerName(scene.offence, scene.ofsPos));
		if (scene.crossPos != undefined) {
			s = s.split("【クロス選手】").join(
					this.getColoredPlayerName(scene.offence, scene.crossPos));
		}
		if (sceneNo < this.scenes.length - 1) {
			s = s.split("【次の攻撃選手】").join(
					this.getColoredPlayerName(scene.offence,
							this.scenes[sceneNo + 1].ofsPos));
		}
		return s;
	},
	getColoredPlayerName : function(team, pos) {
		return '<b>' + team.getPlayerAtPosition(pos).name + '</b>';
	}
};
