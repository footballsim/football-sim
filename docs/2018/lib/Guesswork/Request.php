<?php
/**
 * This class encupsled HTTP Request.
 *
 * @author juno
 * @version $Id: Request.php 11 2005-08-16 19:57:30Z juno $
 */
class Request {
    // invoked action name
    var $_action = '';

    // request parameters
    var $_params = array();

    /**
     * Factory method.
     * @access public
     * @param string key for action value
     * @return reference for object
     */
    function &factory($action_key)
    {
        if (!is_string($action_key) || $action_key == '') {
            trigger_error("Invalid action key '" . $action_key . "' specified.", E_USER_ERROR);
        }

        $request = new Request();

        if (isset($_GET[$action_key])) {
            $request->setAction($_GET[$action_key]);
        } else if (isset($_POST[$action_key])) {
            $request->setAction($_POST[$action_key]);
        }

        foreach ($_GET as $key => $value) {
            $request->setParam($key, $value);
        }

        foreach ($_POST as $key => $value) {
            $request->setParam($key, $value);
        }

        foreach ($_FILES as $key => $value) {
            if (is_array($value)) {
                $file = new UploadFile($value);
                $request->setParam($key, $file);
            } else {
                $request->setParam($key, $value);
            }
        }

        return $request;
    }

    function getAction()
    {
        return $this->_action;
    }

    function setAction($action)
    {
        $this->_action = $action;
    }

    function getParam($key)
    {
        if (!array_key_exists($key, $this->params)) {
            return null;
        }

        return $this->_params[$key];
    }

    function setParam($key, $value)
    {
        $this->_params[$key] = $value;
    }

    function setParamByReference($key, &$obj)
    {
        $this->_params[$key] = $obj;
    }

    function getParameters()
    {
        return $this->_params;
    }

    function getParamNames()
    {
        return array_keys($this->_params);
    }
}
?>
