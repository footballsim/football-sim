<?php
require_once('lib/setup.php');
require_once('MyDB.class.php');

function lockFile($path)
{
    $lock = $path . '.lock';
    for ($i = 0; !mkdir($lock) && $i < 50; $i++) {
        usleep(100000);
    }
}

function unlockFile($path)
{
    rmdir($path . '.lock');
}

function cmpRanking($a, $b)
{
    if ($a['point'] == $b['point'])
        return 0;
    return ($a['point'] > $b['point']) ? -1 : 1;
}

function getMembers($country)
{
    $path = "data/".$country.".csv";
    $fp = fopen($path, 'r');
    if ($fp === FALSE)
        return FALSE;

    $members = array();
    while (($d = fgetcsv($fp, 0, "\t")) !== FALSE) {
        $a = array(
            'model' => $d[2],
            'playerid' => $d[4],
            'name' => $d[5],
            'longname' => $d[6],
            'birthdate' => $d[7],
            'height' => $d[8],
            'weight' => $d[9],
            'profile' => $d[10],
            'fatigue' => 0,
            'condition' => rand(0, 4),
            'mposition' => $d[11]);
        $b = array();
        for ($i = 12; $i <= 17; $i++) {
            if (!empty($d[$i]))
                $b[] = $d[$i];
        }
        $a['positions'] = $b;
        $a['icon'] = $d[85];
        $a['params'] = array_slice($d, 18, 36);
        $members[] = $a;
    }
    fclose($fp);
    return $members;
}

$db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

switch ($_REQUEST['action']) {

case 'getplayerinfo':
    $sql = "SELECT longname, country, category FROM players WHERE playerid='"
        .$db->escape($_REQUEST['id'])."'";
    $res = $db->db->get_row($sql);
    if ($res)
        echo $res->longname."（".$res->country." / ".$res->category."）";
    else
        echo "";
    break;

case 'getcard':
    $sql = "SELECT * FROM cards WHERE cardid='"
        .$db->escape($_REQUEST['id'])."'";
    $res = $db->db->get_row($sql);
    if ($res) {
        echo json_encode($res, JSON_NUMERIC_CHECK);
    }
    break;

case 'getteam':
    header("Content-Type: application/json; charset=utf-8");

    $systems = array("4-1-3-2", "4-2-2-2", "4-4-2", "4-3-1-2", "4-1-4-1",
        "4-2-3-1", "4-3-2-1A", "4-3-2-1B", "4-1-2-3", "4-2-1-3", "3-1-3-3",
        "3-2-2-3", "3-4-3", "3-3-2-2", "3-2-3-2", "3-3-3-1", "3-4-2-1",
        "5-1-2-2", "5-2-1-2", "5-1-3-1", "5-2-2-1", "5-4-1");

    $sql = "SELECT * FROM teams WHERE teamid='"
        .$db->escape($_REQUEST['id'])."'";
    $team = $db->db->get_row($sql);
    if (!$team) {
        echo "{}";
        exit;
    }

    $data = array(
        "teamid" => $team->teamid,
        "flag_image" => ($team->teamid.'.png'),
        "name" => $team->name,
        "category" => $team->category,
        "year" => $team->year,
        "default_system" => $systems[$team->system],
        "default_tactics" => $team->tactics,
        "default_keyplayer" => 10);

    $mem = explode(",", $team->members);
    $a = array();
    $max = min(50, count($mem));
    for ($i = 0; $i < $max; $i++) {
        if ($mem[$i]) {
            $sql = "SELECT * FROM players WHERE playerid='{$mem[$i]}'";
            $res = $db->db->get_row($sql);
            $p = array("playerid" => $mem[$i]);
            if ($res) {
                $p['name'] = $res->name;
                $p['longname'] = $res->longname;
                $p['country'] = $res->country;
                $p['category'] = $res->category;
                $p['height'] = $res->height;
                $p['weight'] = $res->weight;
                $p['profile'] = $res->profile;
                $p['mposition'] = $res->mposition;
                $p['positions'] = explode(",", $res->positions);
                $p['params'] = array(
                    $res->power,
                    $res->stamina,
                    $res->top_speed,
                    $res->acceleration,
                    $res->response,
                    $res->jump,
                    $res->agility,
                    $res->dribble_accuracy,
                    $res->dribble_speed,
                    $res->shortpass_accuracy,
                    $res->shortpass_speed,
                    $res->longpass_accuracy,
                    $res->longpass_speed,
                    $res->shoot_accuracy,
                    $res->shoot_making,
                    $res->shoot_tech,
                    $res->freekick_accuracy,
                    $res->curve,
                    $res->ball_tech,
                    $res->offensive,
                    $res->pass_cut,
                    $res->tackle,
                    $res->man_marking,
                    $res->covering,
                    $res->chasing,
                    $res->saving,
                    $res->highball,
                    $res->heading,
                    $res->positioning,
                    $res->mentality,
                    $res->combination,
                    $res->condition_stability,
                    $res->strategic_eye,
                    $res->creativity,
                    $res->fair_play,
                    $res->fatigue);
            }
            $a[] = $p;
        }
    }
    $data['players'] = $a;

    $max = count($a);
    $lineup = array();
    for ($i = 0; $i < $max; $i++)
        $lineup[] = $i;
    $data['default_lineup'] = $lineup;

    echo json_encode($data, JSON_NUMERIC_CHECK);
    break;

case 'getcounter':
    header("Content-Type: application/json; charset=utf-8");
    $path = 'data/counter.dat';
    if (!file_exists($path)) {
        $data = array(
            "play" => 0,
            "tournament" => 0,
            "victory" => 0
        );
    } else {
        $s = file_get_contents($path);
        $data = unserialize($s);
    }
    echo json_encode($data, JSON_NUMERIC_CHECK);
    break;

case 'getranking':
    header("Content-Type: application/json; charset=utf-8");
    $path = 'data/ranking.dat';
    if (!file_exists($path)) {
        $a = array();
    } else {
        $s = file_get_contents($path);
        $a = unserialize($s);
    }
    $data = array("ranking" => $a);
    echo json_encode($data);
    break;

case 'incp':
    $t = time();
    if (!empty($_SESSION['incp']) && $t - $_SESSION['incp'] < 10)
        break;
    $_SESSION['incp'] = $t;
    if (empty($_SERVER['HTTP_REFERER'])
        || substr($_SERVER['HTTP_REFERER'], -11) != 'ingame.html') {
        break;
    }

    $path = 'data/counter.dat';
    lockFile($path);

    if (!file_exists($path)) {
        $data = array(
            "play" => 1,
            "tournament" => 0,
            "victory" => 0
        );
    } else {
        $s = file_get_contents($path);
        $data = unserialize($s);
        $data['play'] = (int)$data['play'] + 1;
    }
    file_put_contents($path, serialize($data));

    unlockFile($path);
    break;

case 'inct':
    $t = time();
    if (!empty($_SESSION['inct']) && $t - $_SESSION['inct'] < 10)
        break;
    $_SESSION['inct'] = $t;
    if (empty($_SERVER['HTTP_REFERER'])
        || substr($_SERVER['HTTP_REFERER'], -11) != 'ingame.html') {
        break;
    }

    $path = 'data/counter.dat';
    lockFile($path);

    $s = file_get_contents($path);
    $data = unserialize($s);
    $data['tournament'] = (int)$data['tournament'] + 1;
    file_put_contents($path, serialize($data));

    unlockFile($path);
    break;

case 'incv':
    $t = time();
    if (!empty($_SESSION['incv']) && $t - $_SESSION['incv'] < 10)
        break;
    $_SESSION['incv'] = $t;
    if (empty($_SERVER['HTTP_REFERER'])
        || substr($_SERVER['HTTP_REFERER'], -11) != 'ingame.html') {
        break;
    }

    $path = 'data/counter.dat';
    lockFile($path);

    $s = file_get_contents($path);
    $data = unserialize($s);
    $data['victory'] = (int)$data['victory'] + 1;
    file_put_contents($path, serialize($data));

    unlockFile($path);
    break;

case 'addranking':
    $t = time();
    if (!empty($_SESSION['addranking']) && $t - $_SESSION['addranking'] < 10)
        break;
    $_SESSION['addranking'] = $t;
    if (empty($_SERVER['HTTP_REFERER'])
        || substr($_SERVER['HTTP_REFERER'], -11) != 'ingame.html') {
        break;
    }

    $name = $_REQUEST['name'];
    $point = (int)$_REQUEST['point'];
    if ($name === "" || $point <= 0)
        break;
    $a = array('name' => $name, 'point' => $point);

    $path = 'data/ranking.dat';
    lockFile($path);

    if (!file_exists($path)) {
        $data = array($a);
    } else {
        $s = file_get_contents($path);
        $data = unserialize($s);
        $data[] = $a;
        usort($data, "cmpRanking");
        if (count($data) > 100)
            array_pop($data);
    }
    file_put_contents($path, serialize($data));

    unlockFile($path);
    break;

case 'getdata':
    header("Content-Type: application/json; charset=utf-8");

    switch ($_REQUEST['country']) {
    case 'jpn':
        $data = array(
            "name" => "日本",
            "team_color" => "#0000FF",
            "flag_image" => "flag-jpn.png",
            "default_lineup" => array(10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22),
            "default_system" => "4-2-3-1",
            "default_tactics" => 0,
            "default_keyplayer" => 0);
        break;
    case 'zmb':
        $data = array(
            "name" => "ザンビア",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 5, 3, 4, 1, 2, 0),
            "default_system" => "4-1-2-3",
            "default_tactics" => 2,
            "default_keyplayer" => 0);
        break;
    case 'ctv':
        $data = array(
            "name" => "コートジボワール",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 4, 5, 3, 1, 2, 0),
            "default_system" => "4-2-1-3",
            "default_tactics" => 2,
            "default_keyplayer" => 0);
        break;
    case 'grc':
        $data = array(
            "name" => "ギリシャ",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 5, 3, 4, 1, 2, 0),
            "default_system" => "4-1-2-3",
            "default_tactics" => 2,
            "default_keyplayer" => 0);
        break;
    case 'col':
        $data = array(
            "name" => "コロンビア",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 4, 5, 2, 3, 0, 1),
            "default_system" => "4-4-2",
            "default_tactics" => 1,
            "default_keyplayer" => 0);
        break;
    case 'cri':
        $data = array(
            "name" => "コスタリカ",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 9, 5, 7, 8, 6, 3, 4, 1, 2, 0),
            "default_system" => "5-4-1",
            "default_tactics" => 1,
            "default_keyplayer" => 0);
        break;
    case 'ury':
        $data = array(
            "name" => "ウルグアイ",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 4, 5, 2, 3, 0, 1),
            "default_system" => "4-4-2",
            "default_tactics" => 2,
            "default_keyplayer" => 0);
        break;
    case 'nld':
        $data = array(
            "name" => "オランダ",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 9, 7, 8, 5, 6, 3, 4, 2, 0, 1),
            "default_system" => "3-2-3-2",
            "default_tactics" => 1,
            "default_keyplayer" => 0);
        break;
    case 'bra':
        $data = array(
            "name" => "ブラジル",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 4, 5, 2, 3, 1, 0),
            "default_system" => "4-2-3-1",
            "default_tactics" => 1,
            "default_keyplayer" => 0);
        break;
    case 'ger':
        $data = array(
            "name" => "ドイツ",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 5, 3, 4, 1, 2, 0),
            "default_system" => "4-3-2-1A",
            "default_tactics" => 0,
            "default_keyplayer" => 0);
        break;
    case 'arg':
        $data = array(
            "name" => "アルゼンチン",
            "team_color" => "#0000FF",
            "flag_image" => "flag-".$_REQUEST['country'].".png",
            "default_lineup" => array(10, 6, 8, 9, 7, 4, 5, 2, 3, 1, 0),
            "default_system" => "4-2-3-1",
            "default_tactics" => 1,
            "default_keyplayer" => 0);
        break;
    default:
        echo "{}";
        exit;
    }
    if (($data['players'] = getMembers($_REQUEST['country'])) === FALSE) {
        echo "{}";
        exit;
    }
    echo json_encode($data, JSON_NUMERIC_CHECK);
    break;

case 'getcategorylist':
    header("Content-Type: application/json; charset=utf-8");

    $sql = "SELECT category FROM teams WHERE year='シングルマッチ' GROUP BY `category` ORDER BY `created`";
    $res = $db->db->get_results($sql);
    if (!$res) {
        echo "{}";
        exit;
    }
    echo json_encode($res, JSON_NUMERIC_CHECK);
    break;

case 'getteamlist':
    header("Content-Type: application/json; charset=utf-8");

    $sql = "SELECT teamid,name FROM teams WHERE category='"
        .$db->escape($_REQUEST['category'])."'";
    $res = $db->db->get_results($sql);
    if (!$res) {
        echo "{}";
        exit;
    }

    // 日本代表を先頭に移動
    for ($i = count($res) - 1; $i > 0; $i--) {
        if ($res[$i]->teamid == 81)
            break;
    }
    if ($i > 0) {
        $a = array_splice($res, $i, 1);
        array_unshift($res, $a[0]);
    }

    echo json_encode($res, JSON_NUMERIC_CHECK);
    break;
}
exit;
?>
