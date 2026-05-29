<?php
require_once('lib/setup.php');
require_once('MyDB.class.php');
require_once('BaseController.class.php');

/**
 * コントローラクラス
 */
class GamelistController extends BaseController
{
    var $data;


    function executeDefault()
    {
        $db = new MyDB(DB_USERNAME, DB_PASSWORD, DB_NAME);
        $sql = "SELECT * FROM cards ORDER BY cardid DESC";
        $this->data = $db->db->get_results($sql, ARRAY_A);
        if ($db->error()) {
            die($db->error());
        }
    }
}

// コントローラの実行
$controller = new GamelistController();
$controller->process();

exit;
?>
