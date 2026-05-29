<?php /* Smarty version 2.6.25-dev, created on 2016-04-07 17:21:20
         compiled from index/default.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'index/default.html', 11, false),)), $this); ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head>
    <meta charset="utf-8">
    <title>Sim Football</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body>
    <dl>
      <?php $_from = $this->_tpl_vars['data']; if (!is_array($_from) && !is_object($_from)) { settype($_from, 'array'); }$this->_foreach['list'] = array('total' => count($_from), 'iteration' => 0);
if ($this->_foreach['list']['total'] > 0):
    foreach ($_from as $this->_tpl_vars['i']):
        $this->_foreach['list']['iteration']++;
?>
      <dt><a href="single.html#?cardid=<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['cardid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</a></dt>
      <dd><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['description'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</dd>
      <?php endforeach; endif; unset($_from); ?>
    </dl>
  </body>
</html>