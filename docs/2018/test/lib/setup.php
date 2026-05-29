<?php
/** データベースのユーザ名 */
define('DB_USERNAME', 'fbsim');

/** データベースのパスワード */
define('DB_PASSWORD', '3Rc#cL$E');

/** データベース名 */
define('DB_NAME', 'fbsim');

/**
 * インストール先のルートURL (libがある場所)
 *
 * URLの最後にはスラッシュが必要。
 */
define('ROOT_URL', 'http://football-sim.com/test/');

/**
 * インストール先の絶対パス (libがある場所)
 *
 * パスの最後にはスラッシュが必要。
 */
define('ROOT_DIR', '/var/www/html/test/');

/**
 * データ保存先絶対パス
 *
 * パスの最後にはスラッシュが必要。
 */
define('DATA_DIR', ROOT_DIR.'data/');

/** Smarty.class.phpの絶対パス */
define('SMARTY_PATH', '/usr/local/share/php/smarty/Smarty.class.php');

/**
 * Smartyのテンプレートディレクトリの絶対パス
 *
 * パスの最後はスラッシュが必要。
 */
define('SMARTY_TMPL_DIR', ROOT_DIR.'lib/tmpl/');

/**
 * Smartyのコンパイル済みテンプレートディレクトリの絶対パス
 *
 * パスの最後はスラッシュが必要。
 * このディレクトリにウェブサーバから書き込みができるように設定すること。
 */
define('SMARTY_TMPLC_DIR', ROOT_DIR.'lib/tmplc/');


// 以下は変更不要

ini_set('include_path', ROOT_DIR.'lib/:'.ini_get('include_path'));

umask(002);

mb_language('ja');
mb_internal_encoding('UTF-8');

//require_once('version.php');

session_start();
?>
