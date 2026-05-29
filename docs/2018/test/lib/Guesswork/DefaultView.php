<?php
/**
 * Default view class.
 *
 * @author juno
 * @version $Id: DefaultView.php 11 2005-08-16 19:57:30Z juno $
 */
class DefaultView extends AbstractView {
    /** Templates directory path */
    var $templatesDir = '';

    /** Result string */
    var $result = null;

    /**
     * Initialize view instance.
     * @access public
     * @param array $config Configuration values
     * @return boolean
     */
    function init($config)
    {
        if (!isset($config['_gw_template_templates_dir'])) {
            trigger_error("Configuration parameter '_gw_template_templates_dir' is not defined.", E_USER_ERROR);
        }

        $templatesDir = $config['_gw_template_templates_dir'];
        if (substr($templatesDir, strlen($templatesDir) - 2, 1) === DIRECTORY_SEPARATOR) {
            // trim last separator char
            $templatesDir = substr($templatesDir, 0, strlen($templatesDir) - 2);
        }

        $this->templatesDir = $templatesDir;

        return true;
    }

    /**
     * @access public
     * @param string $template Path to template file
     * @param array $model Array of model values
     * @return boolean
     */
    function process($template, $model)
    {
        $m =& new DefaultViewModel;
        foreach ($model as $name => $value) {
            if (is_object($value)) {
                $m->$name =& $value;
            } else {
                $m->$name = $value;
            }
        }

        ob_start();

        require_once $this->templatesDir . DIRECTORY_SEPARATOR . $template;

        $this->result = ob_get_contents();
        ob_end_clean();

        return true;
    }

    /**
     * @access public
     * @return string
     */
    function getResult()
    {
        return $this->result;
    }

    /**
     * @access public
     * @return boolean
     */
    function isTemplateExists($template)
    {
        return file_exists($this->templatesDir . DIRECTORY_SEPARATOR . $template);
    }

    /**
     * @access public
     * @param string $value
     * @return string
     */
    function e($value)
    {
        if (is_string($value)) {
            return htmlspecialchars($value);
        }
        return $value;
    }
}

class DefaultViewModel {
}
?>
