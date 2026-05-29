<?php
require_once('../lib/setup.php');
require_once('MyDB.class.php');
require_once('BaseController.class.php');

/**
 * コントローラクラス
 */
class EditorController extends BaseController
{
    var $cardid = "";
    var $teamid = "";
    var $playerid = "";
    var $name = "";
    var $team1 = "";
    var $team2 = "";
    var $teams;
    var $description = "";
    var $longname = "";
    var $country = "";
    var $category = "";
    var $year = "";
    var $tactics = "";
    var $system = "";
    var $members;
    var $height = "";
    var $weight = "";
    var $profile = "";
    var $mposition = "";
    var $positions;
    var $power = "";
    var $stamina = "";
    var $top_speed = "";
    var $acceleration = "";
    var $response = "";
    var $jump = "";
    var $agility = "";
    var $dribble_accuracy = "";
    var $dribble_speed = "";
    var $shortpass_accuracy = "";
    var $shortpass_speed = "";
    var $longpass_accuracy = "";
    var $longpass_speed = "";
    var $shoot_accuracy = "";
    var $shoot_making = "";
    var $shoot_tech = "";
    var $freekick_accuracy = "";
    var $curve = "";
    var $ball_tech = "";
    var $offensive = "";
    var $pass_cut = "";
    var $tackle = "";
    var $man_marking = "";
    var $covering = "";
    var $chasing = "";
    var $saving = "";
    var $highball = "";
    var $heading = "";
    var $positioning = "";
    var $mentality = "";
    var $combination = "";
    var $condition_stability = "";
    var $strategic_eye = "";
    var $creativity = "";
    var $fair_play = "";
    var $fatigue = "";
    var $created = "";
    var $kw = "";

    var $submit = "";

    var $data;

    
    function init()
    {
        parent::init();

        $this->_gw_view->smarty->template_dir .= '/admin/';
        $this->_gw_view->smarty->compile_dir .= '/admin/';
    }

    function executeDefault()
    {
        header("Location: {$this->root}admin/editor.php?action=cards");
    }

    function executeCards()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $sql = "SELECT *,(SELECT name FROM teams WHERE teamid=team1) as team1name,(SELECT name FROM teams WHERE teamid=team2) as team2name FROM cards ORDER BY cardid DESC";
        $this->data = $db->db->get_results($sql, ARRAY_A);
        if ($db->error()) {
            die($db->error());
        }
    }

    function executeEditCard()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $this->data = NULL;
        if ($this->cardid) {
            $sql = "SELECT * FROM cards WHERE cardid='"
                .$db->escape($this->cardid)."'";
            $this->data = $db->db->get_row($sql, ARRAY_A);
            if ($db->error()) {
                die($db->error());
            }
        }
        if (empty($this->data)) {
            $this->data = array("cardid" => "0");
        }

        $sql = "SELECT teamid,name,category,year FROM teams ORDER BY teamid DESC";
        $this->teams = $db->db->get_results($sql, ARRAY_A);
    }

    function executeSaveCard()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "REPLACE cards VALUES (";
        if ($this->cardid > 0)
            $sql .= $this->cardid;
        else
            $sql .= "NULL";
        $sql .= ",'".$db->escape($this->name)."'";
        $sql .= ",'".$db->escape($this->team1)."'";
        $sql .= ",'".$db->escape($this->team2)."'";
        $sql .= ",'".$db->escape($this->description)."'";
        if ($this->cardid > 0)
            $sql .= ",'".$db->escape($this->created)."'";
        else
            $sql .= ",NOW()";
        $sql .= ")";

        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=cards");
    }

    function executeDeleteCard()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "DELETE FROM cards WHERE cardid='"
                .$db->escape($this->cardid)."'";
        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=cards");
    }

    function executeTeams()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $sql = "SELECT teamid,name,category,year,created FROM teams ORDER BY teamid DESC";
        $this->data = $db->db->get_results($sql, ARRAY_A);
        if ($db->error()) {
            die($db->error());
        }
    }

    function executeEditTeam()
    {
        $this->data = NULL;
        if ($this->teamid) {
            $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
            $sql = "SELECT * FROM teams WHERE teamid='"
                .$db->escape($this->teamid)."'";
            $this->data = $db->db->get_row($sql, ARRAY_A);
            if ($db->error()) {
                die($db->error());
            }
            $this->members = explode(",", $this->data['members']);
            for ($i = count($this->members); $i < 50; $i++)
                $this->members[$i] = 0;
        }
        if (empty($this->data)) {
            $this->data = array("teamid" => "0");
            $this->members = array(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
    }

    function executeSaveTeam()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "REPLACE teams VALUES (";
        if ($this->teamid > 0)
            $sql .= $this->teamid;
        else
            $sql .= "NULL";
        $sql .= ",'".$db->escape($this->name)."'";
        $sql .= ",'".$db->escape($this->category)."'";
        $sql .= ",'".$db->escape($this->year)."'";
        $sql .= ",'".$db->escape($this->tactics)."'";
        $sql .= ",'".$db->escape($this->system)."'";
        ksort($this->members);
        $s = implode(",", $this->members);
        $sql .= ",'".$db->escape($s)."'";
        if ($this->teamid > 0)
            $sql .= ",'".$db->escape($this->created)."'";
        else
            $sql .= ",NOW()";
        $sql .= ")";

        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=teams");
    }

    function executeDeleteTeam()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "DELETE FROM teams WHERE teamid='"
                .$db->escape($this->teamid)."'";
        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=teams");
    }

    function executePlayers()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $sql = "SELECT playerid,name,longname,country,category,created FROM players";
        if ($this->kw != "") {
            $k = $db->escape($this->kw);
            $sql .= " WHERE name LIKE '%$k%' OR longname LIKE '%$k%' OR category LIKE '%$k%' OR country LIKE '%$k%'";
        }
        $sql .= " ORDER BY playerid DESC LIMIT 200";
        $this->data = $db->db->get_results($sql, ARRAY_A);
        if ($db->error()) {
            die($db->error());
        }
    }

    function executeEditPlayer()
    {
        $this->data = NULL;
        if ($this->playerid) {
            $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
            $sql = "SELECT * FROM players WHERE playerid='"
                .$db->escape($this->playerid)."'";
            $this->data = $db->db->get_row($sql, ARRAY_A);
            if ($db->error()) {
                die($db->error());
            }
        }
        if (empty($this->data)) {
            $this->data = array("playerid" => "0", "positions" => array(),
                    "fatigue" => "0");
        } else {
            $this->data['positions'] = explode(",", $this->data['positions']);
        }
    }

    function executeSavePlayer()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "REPLACE players VALUES (";
        if ($this->playerid > 0)
            $sql .= $this->playerid;
        else
            $sql .= "NULL";
        $sql .= ",'".$db->escape($this->name)."'";
        $sql .= ",'".$db->escape($this->longname)."'";
        $sql .= ",'".$db->escape($this->country)."'";
        $sql .= ",'".$db->escape($this->category)."'";
        $sql .= ",'".$db->escape($this->height)."'";
        $sql .= ",'".$db->escape($this->weight)."'";
        $sql .= ",'".$db->escape($this->profile)."'";
        $sql .= ",'".$db->escape($this->mposition)."'";
        $sql .= ",'".$db->escape(implode(",", $this->positions))."'";
        $sql .= ",'".$db->escape($this->power)."'";
        $sql .= ",'".$db->escape($this->stamina)."'";
        $sql .= ",'".$db->escape($this->top_speed)."'";
        $sql .= ",'".$db->escape($this->acceleration)."'";
        $sql .= ",'".$db->escape($this->response)."'";
        $sql .= ",'".$db->escape($this->jump)."'";
        $sql .= ",'".$db->escape($this->agility)."'";
        $sql .= ",'".$db->escape($this->dribble_accuracy)."'";
        $sql .= ",'".$db->escape($this->dribble_speed)."'";
        $sql .= ",'".$db->escape($this->shortpass_accuracy)."'";
        $sql .= ",'".$db->escape($this->shortpass_speed)."'";
        $sql .= ",'".$db->escape($this->longpass_accuracy)."'";
        $sql .= ",'".$db->escape($this->longpass_speed)."'";
        $sql .= ",'".$db->escape($this->shoot_accuracy)."'";
        $sql .= ",'".$db->escape($this->shoot_making)."'";
        $sql .= ",'".$db->escape($this->shoot_tech)."'";
        $sql .= ",'".$db->escape($this->freekick_accuracy)."'";
        $sql .= ",'".$db->escape($this->curve)."'";
        $sql .= ",'".$db->escape($this->ball_tech)."'";
        $sql .= ",'".$db->escape($this->offensive)."'";
        $sql .= ",'".$db->escape($this->pass_cut)."'";
        $sql .= ",'".$db->escape($this->tackle)."'";
        $sql .= ",'".$db->escape($this->man_marking)."'";
        $sql .= ",'".$db->escape($this->covering)."'";
        $sql .= ",'".$db->escape($this->chasing)."'";
        $sql .= ",'".$db->escape($this->saving)."'";
        $sql .= ",'".$db->escape($this->highball)."'";
        $sql .= ",'".$db->escape($this->heading)."'";
        $sql .= ",'".$db->escape($this->positioning)."'";
        $sql .= ",'".$db->escape($this->mentality)."'";
        $sql .= ",'".$db->escape($this->combination)."'";
        $sql .= ",'".$db->escape($this->condition_stability)."'";
        $sql .= ",'".$db->escape($this->strategic_eye)."'";
        $sql .= ",'".$db->escape($this->creativity)."'";
        $sql .= ",'".$db->escape($this->fair_play)."'";
        $sql .= ",'".$db->escape($this->fatigue)."'";
        if ($this->playerid > 0)
            $sql .= ",'".$db->escape($this->created)."'";
        else
            $sql .= ",NOW()";
        $sql .= ")";

        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=players");
    }

    function executeDeletePlayer()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $sql = "DELETE FROM players WHERE playerid='"
                .$db->escape($this->playerid)."'";
        $db->query($sql);
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=players");
    }

    function executeDownloadPlayers()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $res = $db->db->get_results("SELECT * FROM players");
        if ($db->error()) {
            die($db->error());
        }

        $s = "\"ID\"\t\"国籍\"\t\"選手区分\"\t\"ロングネーム\"\t\"ショートネーム\"\t\"身長\"\t\"体重\"\t\"プロフィール\"\t\"ポジション\"\t\"得意ポジション\"\t\"得意ポジション2\"\t\"得意ポジション3\"\t\"得意ポジション4\"\t\"得意ポジション5\"\t\"得意ポジション6\"\t\"パワー\"\t\"スタミナ\"\t\"トップスピード\"\t\"加速力\"\t\"レスポンス\"\t\"ジャンプ\"\t\"敏捷性\"\t\"ドリブル精度\"\t\"ドリブルスピード\"\t\"ショートパス精度\"\t\"ショートパススピード\"\t\"ロングパス精度\"\t\"ロングパススピード\"\t\"シュート精度\"\t\"シュート力\"\t\"シュートテクニック\"\t\"フリーキック精度\"\t\"カーブ\"\t\"ボールテクニック\"\t\"攻撃性\"\t\"パスカット\"\t\"タックル\"\t\"マンマーク\"\t\"カバーリング\"\t\"チェイシング\"\t\"セービング\"\t\"ハイボール処理\"\t\"ヘディング\"\t\"ポジショニング\"\t\"精神安定度\"\t\"連携\"\t\"コンディション安定度\"\t\"戦術眼\"\t\"創造性\"\t\"フェアプレー\"\t\"疲労度\"\t\"追加日時\"\n";

        foreach ($res as $r) {
            $s .= $r->playerid;
            $s .= "\t\"{$r->country}\"";
            $s .= "\t\"{$r->category}\"";
            $s .= "\t\"{$r->longname}\"";
            $s .= "\t\"{$r->name}\"";
            $s .= "\t{$r->height}";
            $s .= "\t{$r->weight}";
            $s .= "\t\"{$r->profile}\"";
            $s .= "\t\"{$r->mposition}\"";

            $a = explode(",", $r->positions);
            $n = count($a);
            for ($i = 0; $i < $n; $i++)
                $s .= "\t\"{$a[$i]}\"";
            for (; $i < 6; $i++)
                $s .= "\t\"\"";

            $s .= "\t{$r->power}";
            $s .= "\t{$r->stamina}";
            $s .= "\t{$r->top_speed}";
            $s .= "\t{$r->acceleration}";
            $s .= "\t{$r->response}";
            $s .= "\t{$r->jump}";
            $s .= "\t{$r->agility}";
            $s .= "\t{$r->dribble_accuracy}";
            $s .= "\t{$r->dribble_speed}";
            $s .= "\t{$r->shortpass_accuracy}";
            $s .= "\t{$r->shortpass_speed}";
            $s .= "\t{$r->longpass_accuracy}";
            $s .= "\t{$r->longpass_speed}";
            $s .= "\t{$r->shoot_accuracy}";
            $s .= "\t{$r->shoot_making}";
            $s .= "\t{$r->shoot_tech}";
            $s .= "\t{$r->freekick_accuracy}";
            $s .= "\t{$r->curve}";
            $s .= "\t{$r->ball_tech}";
            $s .= "\t{$r->offensive}";
            $s .= "\t{$r->pass_cut}";
            $s .= "\t{$r->tackle}";
            $s .= "\t{$r->man_marking}";
            $s .= "\t{$r->covering}";
            $s .= "\t{$r->chasing}";
            $s .= "\t{$r->saving}";
            $s .= "\t{$r->highball}";
            $s .= "\t{$r->heading}";
            $s .= "\t{$r->positioning}";
            $s .= "\t{$r->mentality}";
            $s .= "\t{$r->combination}";
            $s .= "\t{$r->condition_stability}";
            $s .= "\t{$r->strategic_eye}";
            $s .= "\t{$r->creativity}";
            $s .= "\t{$r->fair_play}";
            $s .= "\t{$r->fatigue}";
            $s .= "\t{$r->created}";
            $s .= "\n";
        }
        $s = mb_convert_encoding($s, 'SHIFT_JIS', 'UTF-8');

        header('Content-Type: text/tab-separated-values');
        $date = new DateTime(null, new DateTimeZone('Asia/Tokyo'));
        $fn = 'players_'.$date->format('Y-m-d_His').'.tsv';
        header('Content-Disposition: attachment; filename="'.$fn.'"');
        echo $s;
        exit;
    }

    function executeUploadPlayers()
    {
        $data = array();

        if (is_uploaded_file($_FILES["upfile"]["tmp_name"])) {
            if (($handle = fopen($_FILES["upfile"]["tmp_name"], "r"))
                !== FALSE) {
                while (($s = fgets($handle, 10000)) !== FALSE) {
                    $s = mb_convert_encoding($s, 'UTF-8', 'SHIFT_JIS');
                    $a = explode("\t", $s);
                    foreach ($a as &$c)
                        $c = trim($c, " \t\n\r\0\x0B\"");
                    $data[] = $a;
                }
                fclose($handle);
            } else {
                die("アップロードに失敗しました。");
            }
        } else {
            die("ファイルが選択されていません。");
        }

        $n = count($data);
        if ($n < 2) {
            die("追加するデータがありません。");
        }

        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);

        $db->begin();

        for ($i = 1; $i < $n; $i++) {
            $r =& $data[$i];
            if (count($r) != 52) {
                echo (count($r));
                die("データの項目数が異なります。");
            }

            $sql = "REPLACE players VALUES (";
            if ($r[0] > 0)
                $sql .= $r[0];
            else
                $sql .= "NULL";
            $sql .= ",'".$db->escape($r[4])."'";
            $sql .= ",'".$db->escape($r[3])."'";
            $sql .= ",'".$db->escape($r[1])."'";
            $sql .= ",'".$db->escape($r[2])."'";
            $sql .= ",'".$db->escape($r[5])."'";
            $sql .= ",'".$db->escape($r[6])."'";
            $sql .= ",'".$db->escape($r[7])."'";
            $sql .= ",'".$db->escape($r[8])."'";

            $positions = "";
            for ($j = 9; $j <= 14; $j++) {
                if ($r[$j] != "")
                    $positions .= ",".$r[$j];
            }
            $sql .= ",'".substr($positions, 1)."'";

            for ($j = 15; $j < 51; $j++)
                $sql .= ",'".$db->escape($r[$j])."'";

            if ($r[0] > 0)
                $sql .= ",'".$db->escape($r[51])."'";
            else
                $sql .= ",NOW()";
            $sql .= ")";

            $db->query($sql);
            if ($db->error()) {
                die($db->error());
            }
        }

        $db->commit();
        if ($db->error()) {
            die($db->error());
        }

        header("Location: {$this->root}admin/editor.php?action=players");
    }
}

// コントローラの実行
$controller = new EditorController();
$controller->process();

exit;
?>
