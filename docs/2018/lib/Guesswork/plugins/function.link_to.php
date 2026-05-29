<?php

function smarty_function_link_to($params, &$smarty)
{
    $parameters = array();
    $caption = '';
    $action = '';

    foreach ($params as $key => $value) {
        if (strtolower($key) == 'caption') {
            $caption = $value;
        } else if (strtolower($key) == 'action') {
            $action = $value;
        } else {
            $parameters[] = urlencode($key) . '=' . urlencode($value);
        }
    }

    $url = $_SERVER['SCRIPT_NAME'];
    $url .= '?action=' . $action;
    $url .= '&' . implode('&', $parameters);

    $buf = '';
    $buf .= '<a href="' . htmlspecialchars($url) . '">';
    $buf .= htmlspecialchars($caption);
    $buf .= '</a>';

    return $buf;
}

?>
