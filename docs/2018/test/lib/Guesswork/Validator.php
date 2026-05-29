<?php
/**
 * Validator base class.
 *
 * @author juno
 * @version $Id: Validator.php 11 2005-08-16 19:57:30Z juno $
 */
class Validator
{
    /**
     * Array of error message
     *
     * @access private
     * @var array
     */
    var $errors = array();

    /**
     * Add error message with key.
     *
     * @access public
     * @param string $key
     * @param string $message
     */
    function addError($key, $message)
    {
        $this->errors[$key] = $message;
    }

    /**
     * Returns array of error message.
     *
     * @access public
     * @return array
     */
    function getErrors()
    {
        return $this->errors;
    }

    /**
     * Returns whether string is empty.
     *
     * @static
     * @param string $value
     * @return boolean
     */
    function isEmpty($value)
    {
        return ((string) $value == '');
    }
}
?>
