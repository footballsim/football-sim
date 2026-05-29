<?php
/**
 * Uploaded file class.
 *
 * @author juno
 * @version $Id: UploadFile.php 11 2005-08-16 19:57:30Z juno $
 */
class UploadFile {
    /**
     * @access private
     * @var string
     */
    var $name = null;

    /**
     * @access private
     * @var string
     */
    var $mimeType = null;

    /**
     * @access private
     * @var string
     */
    var $tmpFilePath = null;

    /**
     * @access private
     * @var integer
     */
    var $errorCode = null;

    /**
     * @access private
     * @var integer
     */
    var $fileSize = null;

    /**
     * Creates new instance.
     *
     * @access public
     * @param array $param
     */
    function UploadFile($param = array())
    {
        if (array_key_exists('name', $param)) {
            $this->setName($param['name']);
        }
        if (array_key_exists('type', $param)) {
            $this->setMimeType($param['type']);
        }
        if (array_key_exists('tmp_name', $param)) {
            $this->setTmpFilePath($param['tmp_name']);
        }
        if (array_key_exists('error', $param)) {
            $this->setErrorCode($param['error']);
        }
        if (array_key_exists('size', $param)) {
            $this->setFileSize($param['size']);
        }
    }

    /**
     * Returns uploaded filename or null.
     *
     * @access public
     * @return string
     */
    function getName()
    {
        return $this->name;
    }

    /**
     * Sets uploaded filename.
     *
     * @access public
     * @param string $name
     */
    function setName($name)
    {
        $this->name = $name;
    }

    /**
     * Returns mime type of uploaded file or null.
     *
     * @access public
     * @return string
     */
    function getMimeType()
    {
        return $this->mimeType;
    }

    /**
     * Sets mime type of uploaded file.
     *
     * @access public
     * @param string $mimeType
     */
    function setMimeType($mimeType)
    {
        $this->mimeType = $mimeType;
    }

    /**
     * Returns temporary file path of uploaded file or null.
     *
     * @access public
     * @return string
     */
    function getTmpFilePath() {
        return $this->tmpFilePath;
    }

    /**
     * Sets temporary file path of uploaded file.
     *
     * @access public
     * @param string $tmpFilePath
     */
    function setTmpFilePath($tmpFilePath)
    {
        $this->tmpFilePath = $tmpFilePath;
    }

    /**
     * Returns error code or null.
     *
     * @access public
     * @return integer
     */
    function getErrorCode() {
        return $this->errorCode;
    }

    /**
     * Sets error code.
     *
     * @access public
     * @param integer $errorCode
     */
    function setErrorCode($errorCode) {
        $this->errorCode = $errorCode;
    }

    /**
     * Returns file size of uploaded file or null.
     *
     * @access public
     * @return integer
     */
    function getFileSize() {
        return $this->fileSize;
    }

    /**
     * Sets file size of uploaded file.
     *
     * @access public
     * @param integer $fileSize
     */
    function setFileSize($fileSize) {
        $this->fileSize = $fileSize;
    }
}
?>
