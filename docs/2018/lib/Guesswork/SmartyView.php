<?php
/**
 * Smarty view class.
 *
 * @author juno
 * @version $Id: SmartyView.php 11 2005-08-16 19:57:30Z juno $
 */
class SmartyView extends AbstractView {
    /**
     * Smarty instance
     *
     * @access private
     * @var object
     */
    var $smarty = null;

    /**
     * Result string
     *
     * @access private
     * @var string
     */
    var $result = null;

    /**
     * Initialize view instance.
     *
     * @access public
     * @param array $config
     * @return boolean
     */
    function init($config)
    {
        $smartyClass = '';
        $templateDir = '';
        $compileDir = '';
        $configDir = '';
        $cacheDir = '';
        $pluginsDir = array('plugins', GUESSWORK_LIB_DIR . DIRECTORY_SEPARATOR . 'plugins');

        if (isset($config['_gw_template_class'])) {
            $smartyClass = $config['_gw_template_class'];
        } else {
            trigger_error("Configuration parameter '_gw_template_class' is not defined.", E_USER_ERROR);
        }

        if (isset($config['_gw_template_templates_dir'])) {
            $templateDir = $config['_gw_template_templates_dir'];
        }

        if (isset($config['_gw_template_compile_dir'], $config)) {
            $compileDir = $config['_gw_template_compile_dir'];
        }

        if (isset($config['_gw_template_config_dir'], $config)) {
            $configDir = $config['_gw_template_config_dir'];
        }

        if (isset($config['_gw_template_cache_dir'], $config)) {
            $cacheDir = $config['_gw_template_cache_dir'];
        }

        if (!class_exists('Smarty')) {
            require_once $smartyClass;
        }

        $this->smarty = new Smarty;
        $this->smarty->template_dir = $templateDir;
        $this->smarty->compile_dir = $compileDir;
        $this->smarty->config_dir = $configDir;
        $this->smarty->cache_dir = $cacheDir;
        $this->smarty->plugins_dir = $pluginsDir;

        return true;
    }

    /**
     * Merge model data with template.
     *
     * @access public
     * @param string $template Path to template file
     * @param array $model Array of model values
     * @return boolean
     */
    function process($template, $model)
    {
        foreach ($model as $key => $value) {
            if (is_object($value)) {
                $this->smarty->assign_by_ref($key, $value);
            } else {
                $this->smarty->assign($key, $value);
            }
        }

        $this->result = $this->smarty->fetch($template);

        return true;
    }

    /**
     * Returns result string
     *
     * @access public
     * @return string
     */
    function getResult()
    {
        return $this->result;
    }

    /**
     * Returns whether template file exists.
     *
     * @access public
     * @return boolean
     */
    function isTemplateExists($template)
    {
        return $this->smarty->template_exists($template);
    }
}
?>
