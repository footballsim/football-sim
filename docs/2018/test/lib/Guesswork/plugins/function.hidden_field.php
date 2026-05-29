<?php

function smarty_function_hidden_field($params, &$smarty)
{
    $name = $params['name'];
    $key = $params['key'];

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
    $buf .= '<input type="hidden"';
    $buf .= ' name="' . htmlspecialchars($name) . '[' . htmlspecialchars($key) . ']"';
    $buf .= ' value="' . htmlspecialchars($value) . '"';
    $buf .= ' />';

    return $buf;
}

?>
