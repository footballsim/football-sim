<?php
require_once('ez_sql_core.php');
require_once('ez_sql_mysql.php');

class MyDB
{
    public $db;

    function __construct($dbusername, $dbpassword, $dbname) {
        $this->db = new ezSQL_mysql($dbusername, $dbpassword, $dbname);
        $this->db->hide_errors();
        $this->query('SET NAMES UTF8');
    }
    
    public function begin() {
        $this->db->query("START TRANSACTION");
    }

    public function commit() {
        $this->db->query("COMMIT");
    }

    public function rollback() {
        $this->db->query("ROLLBACK");
    }

    public function error() {
        return $this->db->last_error;
    }

    public function query($sql) {
        return $this->db->query($sql);
    }

    public function escape($str) {
        return mysql_real_escape_string(stripslashes($str));
    }
}
?>
