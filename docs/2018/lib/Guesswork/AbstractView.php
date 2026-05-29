<?php
/**
 * Abstract view class.
 *
 * @author juno
 * @version $Id: AbstractView.php 10 2005-08-16 19:53:37Z juno $
 */
class AbstractView {
    /**
     * @access public
     * @param array $config Configuration values
     * @return boolean
     */
    function init($config)
    {
        return false;
    }

    /**
     * @access public
     * @param string $template Path to template file
     * @param array $model Array of model values
     * @return boolean
     */
    function process($template, $model)
    {
        return false;
    }

    /**
     * @access public
     * @return string
     */
    function getResult()
    {
        return '';
    }

    /**
     * @access public
     * @return boolean
     */
    function isTemplateExists($template)
    {
        return false;
    }
}
?>
