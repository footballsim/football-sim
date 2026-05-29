<?php
/**
 * すべてのコントローラクラスの親クラス定義
 *
 * @package    ahpcampaign
 * @author     Sato Kazuhiko <sato@memedes.com>
 * @copyright  Meme Design Ltd.
 * @version    SVN: $Id$
 */
require_once('setup.php');
require_once('Guesswork.php');

/**
 * すべてのコントローラクラスの親クラス
 */
class BaseController extends Controller
{
    var $_gw_disable_session = true;
    var $_gw_template_class = SMARTY_PATH;

    var $action;

    /**
     * 現在実行中のスクリプトのURL出力パラメータ
     *
     * @var string
     */
    var $selfURL;

    /**
     * ルートURL出力パラメータ
     *
     * @var string
     */
    var $root = "";

    /**
     * ルートディレクトリへの絶対パスの出力パラメータ
     *
     * @var string
     */
    var $rootpath = ROOT_DIR;

    /**
     * sessionIDパラメータ文字列
     *
     * @var string
     */
    var $sid = "";


    /**
     * コントローラの初期化
     */
    function init() {
        $this->_gw_view->smarty->left_delimiter = '{{';
        $this->_gw_view->smarty->right_delimiter = '}}';

        $this->selfURL = "http://{$_SERVER['HTTP_HOST']}{$_SERVER['PHP_SELF']}";
        $this->root = ROOT_URL;
        $this->sid = htmlspecialchars(SID);

        $this->_gw_view->smarty->template_dir = SMARTY_TMPL_DIR;
        $this->_gw_view->smarty->compile_dir = SMARTY_TMPLC_DIR;
    }
}
