<?php

function smarty_function_error($params, &$smarty)
{
    $name = (isset($params['name'])) ? (string)$params['name'] : '';
    $pre  = (isset($params['pre'])) ? (string)$params['pre'] : '<span class="validationError">';
    $post = (isset($params['post'])) ? (string)$params['post'] : '</span>';

    $errors = $smarty->get_template_vars('_errors');
    $message = '';
    if (is_array($errors) && array_key_exists($name, $errors)) {
        $message = $pre . $errors[$name] . $post;
    }

    return $message;
}

?>
