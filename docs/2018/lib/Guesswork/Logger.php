<?php
/**
 * Logger class.
 *
 * @author juno
 * @version $Id: Logger.php 11 2005-08-16 19:57:30Z juno $
 */
class Logger
{
    var $level = null;
    var $filepath = null;

    /**
     * Constructor.
     * @access public
     * @param integer $level log level
     * @param string $filepath log file path or null
     * @return object
     */
    function Logger($level, $filepath)
    {
        $this->level = $level;
        $this->filepath = $filepath;
    }

    /**
     * Log trace message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function trace($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_TRACE) {
            return;
        }

        $line = $this->constructLogLine('TRACE', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * Log debug message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function debug($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_DEBUG) {
            return;
        }

        $line = $this->constructLogLine('DEBUG', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * Log info message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function info($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_INFO) {
            return;
        }

        $line = $this->constructLogLine('INFO', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * Log warning message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function warn($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_WARN) {
            return;
        }

        $line = $this->constructLogLine('WARN', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * Log error message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function error($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_ERROR) {
            return;
        }

        $line = $this->constructLogLine('ERROR', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * Log fatal message.
     * @access public
     * @param string $message message to log
     * @param string $filename Source file
     * @param integer $line Line number
     */
    function fatal($message, $filename = null, $line = null)
    {
        if ($this->level > GW_LOG_FATAL) {
            return;
        }

        $line = $this->constructLogLine('FATAL', $message, $filename, $line);
        $this->writeToFile($line);
    }

    /**
     * @access public
     * @return boolean
     */
    function isTrace()
    {
        return ($this->level <= GW_LOG_TRACE);
    }

    /**
     * @access public
     * @return boolean
     */
    function isDebug()
    {
        return ($this->level <= GW_LOG_DEBUG);
    }

    /**
     * @access public
     * @return boolean
     */
    function isInfo()
    {
        return ($this->level <= GW_LOG_INFO);
    }

    /**
     * @access public
     * @return boolean
     */
    function isWarn()
    {
        return ($this->level <= GW_LOG_WARN);
    }

    /**
     * @access public
     * @return boolean
     */
    function isError()
    {
        return ($this->level <= GW_LOG_ERROR);
    }

    /**
     * @access public
     * @return boolean
     */
    function isFatal()
    {
        return ($this->level >= GW_LOG_FATAL);
    }

    /**
     * @access private
     * @param string $level
     * @param string $message
     * @param string $filename
     * @param integer $line
     * @return string
     */
    function constructLogLine($level, $message, $filename, $line)
    {
        $buf = "" . date("Y/m/d H:i:s") . " [" . $level . "] " . $message;
        if (!is_null($filename) && !is_null($line)) {
            $buf .= " (" . $filename . ":" . $line . ")";
        }
        $buf .= "\n";

        return $buf;
    }

    /**
     * @access private
     * @param string $line
     * @return boolean
     */
    function writeToFile($line)
    {
        if (is_null($this->filepath)) {
            return true;
        }

        if (($fp = @fopen($this->filepath, "a")) === false) {
            trigger_error("Couldn't open log file '" . $this->filepath . "'.", E_USER_NOTICE);
            return false;
        }

        if (!flock($fp, LOCK_EX)) {
            @fclose($fp);
            trigger_error("Couldn't lock log file.", E_USER_NOTICE);
            return false;
        }

        if (fwrite($fp, $line) === false) {
            @flock($fp, LOCK_UN);
            @fclose($fp);
            trigger_error("Couldn't write to log file.", E_USER_NOTICE);
            return false;
        }

        if (!flock($fp, LOCK_UN)) {
            @fclose($fp);
            trigger_error("Couldn't unlock log file.", E_USER_NOTICE);
            return false;
        }

        if (!fclose($fp)) {
            trigger_error("Couldn't close log file.", E_USER_NOTICE);
            return false;
        }

        return true;
    }
}
?>
