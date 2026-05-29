<?php
/**
 * Utility class.
 *
 * @author juno
 * @version $Id: Utils.php 11 2005-08-16 19:57:30Z juno $
 */
class Utils {
    /**
     * Add DIRECTORY_SEPARATOR string to tail of path.
     *
     * @access static
     * @param string $src
     * @return string
     */
    function normalizeDirectoryPathStr($src)
    {
        $value = $src;

        if (substr($src, strlen($src) - 1, 1) != DIRECTORY_SEPARATOR) {
            $value .= DIRECTORY_SEPARATOR;
        }

        return $value;
    }
}

?>
