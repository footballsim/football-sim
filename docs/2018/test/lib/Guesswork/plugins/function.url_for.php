<?php

function smarty_function_url_for($params, &$smarty)
{
    $action = $params['action'];

    $url = $_SERVER['SCRIPT_NAME'];
    $url .= "?action=" . $action;

    return $url;
}

?>
