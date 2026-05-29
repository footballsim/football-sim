<?php

function smarty_function_text_field($params, &$smarty)
{
    $name = $params['name'];
    $key = $params['key'];
    $size = $params['size'];
    $maxlength = $params['maxlength'];

    $value = '';

    $var = $smarty->get_template_vars($name);
    if (is_array($var)) {
        if (array_key_exists($key, $var)) {
            $value = $var[$key];
        }
    } else if (is_object($var)) {
        $value = $var->$key;
    }

    $buf = '';
    $buf .= '<input type="text"';
    $buf .= ' name="' . htmlspecialchars($name) . '[' . htmlspecialchars($key) . ']"';
    $buf .= ' value="' . htmlspecialchars($value) . '"';
    if (is_numeric($size)) {
        $buf .= ' size="' . htmlspecialchars($size) . '"';
    }
    if (is_numeric($maxlength)) {
        $buf .= ' maxlength="' . htmlspecialchars($maxlength) . '"';
    }
    $buf .= ' />';

    return $buf;
}

?>
