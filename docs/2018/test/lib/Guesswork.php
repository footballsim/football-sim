<?php
/**
 * Project:     Guesswork Classic: the PHP lightweight web framework
 * File:        Guesswork.php
 *
 * @link http://classic.guesswork.jp/
 * @copyright 2005 juno
 * @author juno
 * @package Guesswork
 * @version $Id: Guesswork.php 9 2005-08-16 19:52:13Z juno $
 */

define('GUESSWORK_LIB_DIR', dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Guesswork');

// Controller
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'Controller.php';

// Internals
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'Request.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'UploadFile.php';

// Utilities
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'ExpressionUtil.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'Logger.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'Utils.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'Validator.php';

// View
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'AbstractView.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'DefaultView.php';
require_once GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'SmartyView.php';

define('GW_SESSION_FLASH_KEY', 'jp.guesswork.session.flash');
define('GW_SESSION_FLASHES_KEY', 'jp.guesswork.session.flashes');

define('GW_CONTINUE_PROCESS', 1);
define('GW_TERMINATE_PROCESS', 2);

// log level
define('GW_LOG_TRACE', 1);
define('GW_LOG_DEBUG', 2);
define('GW_LOG_INFO', 3);
define('GW_LOG_WARN', 4);
define('GW_LOG_ERROR', 5);
define('GW_LOG_FATAL', 6);
?>
