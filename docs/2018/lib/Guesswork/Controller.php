<?php
/**
 * Core controller class.
 *
 * @author juno
 * @version $Id: Controller.php 11 2005-08-16 19:57:30Z juno $
 */
class Controller {
    /** Key for action value */
    var $_gw_action_key = 'action';

    /** template file extension */
    var $_gw_template_ext = 'html';

    /** name of view engine */
    var $_gw_template_engine = 'smarty';

    /** name of default action */
    var $_gw_default_action = 'default';

    /** name of validator class */
    var $_gw_validator_class = null;

    /** name of form parameter callback method */
    var $_gw_form_parameter_callback = null;

    /** session disable flag */
    var $_gw_disable_session = false;

    /** array of before filter method names */
    var $_gw_before_filters = array();

    /** array of after filter method names */
    var $_gw_after_filters = array();

    /** array of around filter class names */
    var $_gw_around_filters = array();

    /** log level */
    var $_gw_log_level = GW_LOG_ERROR;

    /** log file name */
    var $_gw_log_file = null;


    /** specified action name */
    var $_gw_action = '';

    /** instance of view processor */
    var $_gw_view = null;

    /** request parameters  */
    var $_gw_params = array();

    /** flash variables */
    var $_gw_flash = array();

    /** instance of Request */
    var $_gw_request = null;

    /** array of validation error messages */
    var $_gw_errors = '';

    /** array of around filter instances */
    var $_gw_around_filter_instances = array();

    /** logger */
    var $_gw_logger = null;

    /**
     * Creates new instance.
     * @access public
     */
    function Controller()
    {
        // instantiate logger
        $this->_gw_logger = new Logger($this->_gw_log_level, $this->_gw_log_file);

        // set default validator class name
        if (is_null($this->_gw_validator_class)) {
            if (preg_match('/^([^_]+)_*Controller$/i', get_class($this), $matches)) {
                $baseName = ucFirst($matches[1]);
            } else {
                $baseName = ucFirst(get_class($this));
            }
            $this->_gw_validator_class = $baseName . 'Validator';
        }

        // populate http request
        $this->_gw_request =& Request::factory($this->_gw_action_key);
        $this->_gw_params = $this->_gw_request->getParameters();
    }

    /**
     * Returns logger instance.
     * @access public
     * @return object
     */
    function getLogger()
    {
        return $this->_gw_logger;
    }

    /**
     * Default action method stub.
     * @access public
     */
    function executeDefault()
    {
    }

    /**
     * Processing request.
     * @access public
     */
    function process()
    {
        $this->estimateAction();

        if (!$this->_gw_disable_session) {
            session_start();
        }

        $this->initView();

        $this->initializeController();
        $this->applyBeforeFilters();
        $this->applyAroundFiltersBeforeMethod();
        $this->invokePrepareMethod();
        $this->fireFlash();

        $result = $this->invokeMethod();

        if (count($this->_gw_flash) > 0) {
            $this->flash = $this->_gw_flash;
        }

        $this->clearFlash();

        if ($result === GW_TERMINATE_PROCESS) {
            return;
        }

        $this->render();

        $this->applyAroundFiltersAfterMethod();
        $this->applyAfterFilters();
    }


    // private methods

    function estimateAction()
    {
        $action = '';

        if (isset($this->_gw_default_action)) {
            $action = $this->_gw_default_action;
        }

        if ($this->_gw_request->getAction() != '') {
            $action = $this->_gw_request->getAction();
        }

        $this->_gw_action = $action;
    }

    /**
     * Initialize View instance.
     * @access private
     * @return boolean
     */
    function initView()
    {
        if (!is_string($this->_gw_template_engine) || $this->_gw_template_engine == '') {
            $message = "Template engine is not specified.\n"
                . "_gw_template_engine = " . $this->_gw_template_engine . "\n";;
            $this->renderError($message);
            return false;
        }

        $viewClassName = strtolower($this->_gw_template_engine) . 'view';
        if (!class_exists($viewClassName)) {
            trigger_error("View class '" . $viewClassName . "' is not exists.", E_USER_NOTICE);
            return false;
        }

        $this->_gw_view = new $viewClassName;
        $config = $this->getClassVarsAsConfig('template');
        if ($this->_gw_view->init($config) === false) {
            return false;
        }

        return true;
    }

    /**
     * Initialize controller instance.
     * @access private
     * @return boolean
     */
    function initializeController()
    {
        // call initialize method
        $method_name = "init";
        if (method_exists($this, $method_name)) {
            call_user_func(array(&$this, $method_name));
        }

        // set acceptable form parameters to instance variable
        $vars = get_class_vars(get_class($this));
        $acceptable = array();
        foreach ($vars as $key => $value) {
            if (substr($key, 0, 1) == '_') {
                continue;
            }
            $acceptable[] = $key;
        }

        // call form parameter callback if defined
        if (is_string($this->_gw_form_parameter_callback)) {
            if (method_exists($this, $this->_gw_form_parameter_callback)) {
                $this->_gw_params = call_user_func(array(&$this, $this->_gw_form_parameter_callback), $this->_gw_params);
            }
        }

        foreach ($this->_gw_params as $key => $value) {
            if (in_array($key, $acceptable)) {
                $this->$key = $value;
            }
        }

        return true;
    }

    /**
     * @access private
     * @return boolean
     */
    function applyAroundFiltersBeforeMethod()
    {
        if (!is_array($this->_gw_around_filters)) {
            return false;
        }

        foreach ($this->_gw_around_filters as $filter) {
            $filter = strtolower(ltrim(rtrim($filter)));
            if (!class_exists($filter)) {
                trigger_error("Filter class '" . $filter . "' is not exists.", E_USER_NOTICE);
                continue;
            }

            $obj = new $filter();
            $this->_gw_around_filter_instances[] = $obj;

            if (!method_exists($obj, 'before')) {
                trigger_error("Filter method '" . $class . "#before' is not exists.", E_USER_NOTICE);
                continue;
            }
            call_user_func(array(&$obj, 'before'), $this);
        }

        return true;
    }

    /**
     * @access private
     * @return boolean
     */
    function applyAroundFiltersAfterMethod()
    {
        foreach (array_reverse($this->_gw_around_filter_instances) as $filter) {
            call_user_func(array(&$filter, 'after'), $this);
        }

        return true;
    }

    /**
     * Apply before filter methods.
     * @access private
     * @return boolean
     */
    function applyBeforeFilters()
    {
        if (!is_array($this->_gw_before_filters)) {
            return false;
        }

        foreach ($this->_gw_before_filters as $filter) {
            $tmp = ExpressionUtil::extractClassNameAndMethodName($filter);

            if (count($tmp) == 1) {
                // invoke filter method
                $method = $tmp[0];
                if (!method_exists($this, $method)) {
                    trigger_error("Filter method '" . $method . "' is not exists.", E_USER_NOTICE);
                    continue;
                }
                call_user_func(array(&$this, $method));
            } else {
                // invoke filter class method
                $class = $tmp[0];
                $method = $tmp[1];
                if (!class_exists($class)) {
                    trigger_error("Filter class '" . $class . "' is not exists.", E_USER_NOTICE);
                    continue;
                }

                $filter = new $class();
                if (!method_exists($filter, $method)) {
                    trigger_error("Filter method '" . $class . "#" . $method . "' is not exists.", E_USER_NOTICE);
                    continue;
                }
                call_user_func(array(&$filter, $method), $this);
            }
        }

        return true;
    }

    /**
     * Apply after filter methods.
     * @access private
     * @return boolean
     */
    function applyAfterFilters()
    {
        if (!is_array($this->_gw_after_filters)) {
            return false;
        }

        foreach ($this->_gw_after_filters as $filter) {
            $tmp = ExpressionUtil::extractClassNameAndMethodName($filter);

            if (count($tmp) == 1) {
                // invoke filter method
                $method = $tmp[0];
                if (!method_exists($this, $method)) {
                    trigger_error("Filter method '" . $method . "' is not exists.", E_USER_NOTICE);
                    continue;
                }
                call_user_func(array(&$this, $method));
            } else {
                // invoke filter class method
                $class = $tmp[0];
                $method = $tmp[1];
                if (!class_exists($class)) {
                    trigger_error("Filter class '" . $class . "' is not exists.", E_USER_NOTICE);
                    continue;
                }

                $filter = new $class();
                if (!method_exists($filter, $method)) {
                    trigger_error("Filter method '" . $class . "#" . $method . "' is not exists.", E_USER_NOTICE);
                    continue;
                }
                call_user_func(array(&$filter, $method), $this);
            }
        }

        return true;
    }

    /**
     * Invoke prepare methods.
     * @access private
     * @return boolean
     */
    function invokePrepareMethod()
    {
        $regex = "^prepare" . $this->_gw_action . "\$";
        $methods = get_class_methods($this);

        foreach ($methods as $method_name) {
            if (preg_match("/" . $regex . "/i", $method_name)) {
                call_user_func(array(&$this, $method_name));
            }
        }

        return true;
    }

    /**
     * Invoke action method.
     * @access private
     * @return integer
     */
    function invokeMethod()
    {
        $method_name = 'execute' . $this->_gw_action;
        if (!method_exists($this, $method_name)) {
            $method_name = 'execute' . $this->_gw_default_action;
        }

        if ($method_name == '') {
            return false;
        }

        return call_user_func(array(&$this, $method_name));
    }

    /**
     * Assign controller properties to view.
     * @access private
     * @return array
     */
    function getPropertiesAsModel()
    {
        $model = array();

        foreach (get_object_vars($this) as $key => $value) {
            if (preg_match('/^_.*/i', $key)) {
                continue;
            }
            $model[$key] = $value;
        }

        return $model;
    }

    /**
     * Rendering view.
     * @access private
     * @return integer
     */
    function render($template = null, $status_code = null)
    {
        if (!is_object($this->_gw_view)
            || strtolower(get_parent_class($this->_gw_view)) != 'abstractview') {
            $message = "View engine is not initialized correctly.\n"
                . "_gw_template_engine = " . $this->_gw_template_engine . "\n"
                . "_gw_template_ext = " . $this->_gw_template_ext . "\n";
            $this->renderError($message);
            return GW_TERMINATE_PROCESS;
        }

        $model = $this->getPropertiesAsModel();

        if (!is_null($status_code)) {
            $server_protocol = $_SERVER["SERVER_PROTOCOL"];
            if ($server_protocol == '') {
                $server_protocol = 'HTTP/1.0';
            }
            header($server_protocol . ' ' . $status_code);
        }

        if (is_null($template) || $template == '') {
            $class_name = strtolower(get_class($this));
            $base_name = '';

            // コントローラクラス名がControllerで終わる場合はその直前までを
            // コントローラ識別名として切り出す
            if (preg_match('/^([^_]+)_*Controller$/i', $class_name, $matches)) {
                $base_name = $matches[1];
            } else {
                $base_name = $class_name;
            }

            if ($this->_gw_action != '' && $this->isActionMethodExists($this->_gw_action)) {
                $template = $this->_gw_action;
            } else {
                $template = $this->_gw_default_action;
            }

            $template_path = $base_name . DIRECTORY_SEPARATOR . $template . '.' . $this->_gw_template_ext;

            if (!$this->_gw_view->isTemplateExists($template_path)) {
                $this->renderError("Template file '" . $this->_gw_template_templates_dir . DIRECTORY_SEPARATOR . $template_path . "' is not exists.");
                return GW_TERMINATE_PROCESS;
            }

            $this->_gw_view->process($template_path, $model);
            print $this->_gw_view->getResult();
            return true;
        }

        if ($this->_gw_view->isTemplateExists($template . '.' . $this->_gw_template_ext)) {
            $this->_gw_view->process($template . '.' . $this->_gw_template_ext, $model);
            print $this->_gw_view->getResult();
            return GW_TERMINATE_PROCESS;
        }

        $this->_gw_view->process($template_path, $model);
        print $this->_gw_view->getResult();

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Rendering action.
     * @access public
     */
    function renderAction($action_name, $status_code = null)
    {
        $model = $this->getPropertiesAsModel();

        if (!is_null($status_code)) {
            $server_protocol = $_SERVER["SERVER_PROTOCOL"];
            if ($server_protocol == '') {
                $server_protocol = 'HTTP/1.0';
            }
            header($server_protocol . ' ' . $status_code);
        }

        $class_name = get_class($this);
        $base_name = '';

        // コントローラクラス名がControllerで終わる場合はその直前までを
        // コントローラ識別名として切り出す
        if (function_exists('preg_match')) {
            if (preg_match('/^([^_]+)_*Controller$/i', $class_name, $matches)) {
                $base_name = $matches[1];
            } else {
                $base_name = $class_name;
            }
        } else {
            if (eregi('^([^_]+)_*Controller$', $class_name, $matches)) {
                $base_name = $matches[1];
            } else {
                $base_name = $class_name;
            }
        }

        $template_path = $base_name . DIRECTORY_SEPARATOR . $action_name . '.' . $this->_gw_template_ext;

        $this->_gw_view->process($template_path, $model);
        print $this->_gw_view->getResult();

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Render file.
     * @access public
     */
    function renderFile($file_path, $status_code = null)
    {
        $model = $this->getPropertiesAsModel();

        if (!is_null($status_code)) {
            $server_protocol = $_SERVER["SERVER_PROTOCOL"];
            if ($server_protocol == '') {
                $server_protocol = 'HTTP/1.0';
            }
            header($server_protocol . ' ' . $status_code);
        }

        $class_name = get_class($this);
        $base_name = '';

        // コントローラクラス名がControllerで終わる場合はその直前までを
        // コントローラ識別名として切り出す
        if (function_exists('preg_match')) {
            if (preg_match('/^([^_]+)_*Controller$/i', $class_name, $matches)) {
                $base_name = $matches[1];
            } else {
                $base_name = $class_name;
            }
        } else {
            if (eregi('^([^_]+)_*Controller$', $class_name, $matches)) {
                $base_name = $matches[1];
            } else {
                $base_name = $class_name;
            }
        }

        $template_path = 'file:' . $file_path;

        $this->_gw_view->process($template_path, $model);
        print $this->_gw_view->getResult();

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Render template string.
     * @access public
     */
    function renderTemplate($template_string, $status_code = null)
    {
        $model = $this->getPropertiesAsModel();

        if (!is_null($status_code)) {
            $server_protocol = $_SERVER["SERVER_PROTOCOL"];
            if ($server_protocol == '') {
                $server_protocol = 'HTTP/1.0';
            }
            header($server_protocol . ' ' . $status_code);
        }

        $model['_gw_eval_body'] = $template_string;
        $this->_gw_view->smarty->template_dir = GUESSWORK_LIB_DIR . '/templates';
        $this->_gw_view->process('eval.tpl', $model);
        print $this->_gw_view->getResult();

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Render text.
     * @access public
     */
    function renderText($text_string, $status_code = null)
    {
        if (!is_null($status_code)) {
            $server_protocol = $_SERVER["SERVER_PROTOCOL"];
            if ($server_protocol == '') {
                $server_protocol = 'HTTP/1.0';
            }
            header($server_protocol . ' ' . $status_code);
        }

        print $text_string;

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Redirect to action.
     * @access public
     */
    function redirectTo($action, $params = array())
    {
        $this->clearFlash();

        $url = 'http://' . $_SERVER['HTTP_HOST'] . $_SERVER['PHP_SELF'];
        $url .= '?action=' . $action . '&' . SID;

        $query = array();
        foreach ($params as $key => $value) {
            $query[] = urlencode($key) . '=' . urlencode($value);
        }

        $url .= '&' . implode('&', $query);
        header('Location: ' . $url);

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Redirect to relative-path.
     * @access public
     */
    function redirectToPath($path)
    {
        $this->clearFlash();
        header('Location: http://' . $_SERVER['HTTP_HOST'] . $path);

        return GW_TERMINATE_PROCESS;
    }

    /**
     * Redirect to URL.
     * @access public
     */
    function redirectToUrl($url)
    {
        $this->clearFlash();
        header('Location: ' . $url);

        return GW_TERMINATE_PROCESS;
    }

    /**
     * 指定されたアクション名に対応するアクションメソッドが定義されて
     * いるかどうかを返します。
     * @access private
     * @param string $action アクション名
     * @return boolean
     */
    function isActionMethodExists($action)
    {
        return method_exists($this, 'execute' . $action);
    }

    function fireFlash()
    {
        if ($this->_gw_disable_session) {
            return;
        }

        if (isset($_SESSION[GW_SESSION_FLASH_KEY])) {
            if (isset($_SESSION[GW_SESSION_FLASHES_KEY])
                && count($_SESSION[GW_SESSION_FLASHES_KEY]) > 0) {
                $_SESSION[GW_SESSION_FLASHES_KEY] += 1;
            }
            $this->_gw_flash = $_SESSION[GW_SESSION_FLASH_KEY];
        } else {
            $this->_gw_flash = array();
        }
    }

    function clearFlash()
    {
        if ($this->_gw_disable_session) {
            return;
        }

        if (isset($_SESSION[GW_SESSION_FLASH_KEY])
            && (!isset($_SESSION[GW_SESSION_FLASHES_KEY]) ||
                $_SESSION[GW_SESSION_FLASHES_KEY] >= 1)) {
            $_SESSION[GW_SESSION_FLASH_KEY] = array();
            $_SESSION[GW_SESSION_FLASHES_KEY] = 0;
        } else {
            $_SESSION[GW_SESSION_FLASH_KEY] = $this->_gw_flash;
        }
    }

    function validate()
    {
        if ($this->_gw_validator_class == '') {
            $this->renderError('Validator class not specified.');
            return false;
        }

        if (!class_exists($this->_gw_validator_class)) {
            $this->renderError("Validator class '" . $this->_gw_validator_class . "' is not exists.");
            return false;
        }

        $validator = new $this->_gw_validator_class;
        $method_name = 'validate' . ucfirst($this->_gw_action);

        // check validate method availability
        if (!method_exists($validator, $method_name)) {
            $this->renderError("Method '" . $this->_gw_validator_class . "::" . $method_name . "' is not exists.");
            return false;
        }

        $model = $this->getPropertiesAsModel();
        call_user_func_array(array(&$validator, $method_name), array($model));
        $this->_gw_errors = $validator->getErrors();

        return (count($this->_gw_errors) == 0);
    }

    function getErrors()
    {
        return $this->_gw_errors;
    }

    function renderError($message)
    {
        print "<html>\n";
        print "<head>\n";
        print "<title>Error</title>\n";
        print "</head>\n";
        print "<body>\n";
        print "<h1>[ERROR]</h1>\n";
        print nl2br(htmlspecialchars($message)) . "<br>\n";
        print "</body>\n";
        print "</html>\n";
    }

    /**
     * コントローラのクラス変数のうち、変数名が _$section で始まるもの
     * の値を配列に格納して返します。配列のキーは変数名となります。
     * @access private
     * @param string $section
     * @return array
     */
    function getClassVarsAsConfig($section)
    {
        $config = array();

        foreach (get_object_vars($this) as $key => $value) {
            if (preg_match('/^(_gw_' . $section . '_.*)/i', $key, $matches)) {
                $name = strtolower($matches[1]);
                $config[$name] = $value;
            }
        }

        return $config;
    }

    function getRawPostData()
    {
        if (($buf = file_get_contents("php://input")) === false) {
            return "";
        }

        return $buf;
    }
}
?>
