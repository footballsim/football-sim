<?php
/**
 * Utility class.
 *
 * @author juno
 * @version $Id: ExpressionUtil.php 11 2005-08-16 19:57:30Z juno $
 */
class ExpressionUtil {
    /**
     * @access private
     * @param string $src Source string
     * @return string
     */
    function extractClassNameAndMethodName($src)
    {
        $buf = ExpressionUtil::normalizeExpression($src);
        if (strpos($buf, '::') === false) {
            return array($buf);
        }

        return explode('::', $buf);
    }

    /**
     * Normalize expression source string.
     * @access private
     * @param string $src Source string
     * @return string
     */
    function normalizeExpression($src)
    {
        return strtolower(ltrim(rtrim($src)));
    }
}
?>
