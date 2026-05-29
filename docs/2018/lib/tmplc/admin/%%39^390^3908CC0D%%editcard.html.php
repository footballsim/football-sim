<?php /* Smarty version 2.6.25-dev, created on 2016-04-27 20:25:42
         compiled from editor/editcard.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'editor/editcard.html', 33, false),)), $this); ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />

    <title>Sim Football Data Editor</title>

    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="memeid.css" />
    <link rel="stylesheet" href="memeclass.css" />
    <link rel="stylesheet" href="memehtml.css" />
  </head>
  <body>
    <div id="wrapper">

      <div id="maintext">

        <div class="bodytext">
          <p>
          <a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=cards" class="btn">対戦カード</a> &nbsp; 
          <a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=teams" class="btn btn-secondary">チーム情報</a>&nbsp; 
          <a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=players" class="btn btn-sub">選 手 情 報</a>
          </p>
        </div>

        <div class="topcopy">
          <h3>対戦カード編集</h3>
        </div>

        <div class="bodytext">

          <form id="mainform" action="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php" method="post">
            <input type="hidden" name="cardid" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['cardid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"/>

            <table width="90%" border="0" cellspacing="2" cellpadding="5">
              <tbody>
                <tr class="gb1">
                  <td width="20%" align="right"><strong>対戦カード名</strong></td>
                  <td align="left">
                    <input name="name" type="text" id="CARD_NAME" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>Aチーム選択</strong></td>
                  <td align="left">
                    <select name="team1" id="#TEAM_A">
                      <option value="0">未選択</option>
                      <?php $_from = $this->_tpl_vars['teams']; if (!is_array($_from) && !is_object($_from)) { settype($_from, 'array'); }$this->_foreach['list'] = array('total' => count($_from), 'iteration' => 0);
if ($this->_foreach['list']['total'] > 0):
    foreach ($_from as $this->_tpl_vars['i']):
        $this->_foreach['list']['iteration']++;
?>
                      <option value="<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['teamid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" <?php if ($this->_tpl_vars['data']['team1'] == $this->_tpl_vars['i']['teamid']): ?>selected="selected"<?php endif; ?>><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
（<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['category'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
 / <?php echo ((is_array($_tmp=$this->_tpl_vars['i']['year'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
）</option>
                      <?php endforeach; endif; unset($_from); ?>
                    </select>
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>Bチーム選択</strong></td>
                  <td align="left">
                    <select name="team2" id="#TEAM_B">
                      <option value="0">未選択</option>
                      <?php $_from = $this->_tpl_vars['teams']; if (!is_array($_from) && !is_object($_from)) { settype($_from, 'array'); }$this->_foreach['list'] = array('total' => count($_from), 'iteration' => 0);
if ($this->_foreach['list']['total'] > 0):
    foreach ($_from as $this->_tpl_vars['i']):
        $this->_foreach['list']['iteration']++;
?>
                      <option value="<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['teamid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" <?php if ($this->_tpl_vars['data']['team2'] == $this->_tpl_vars['i']['teamid']): ?>selected="selected"<?php endif; ?>><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
（<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['category'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
 / <?php echo ((is_array($_tmp=$this->_tpl_vars['i']['year'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
）</option>
                      <?php endforeach; endif; unset($_from); ?>
                    </select>
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>対戦カード情報</strong></td>
                  <td align="left">
                    <textarea name="description" id="textarea" cols="45" rows="5"><?php echo ((is_array($_tmp=$this->_tpl_vars['data']['description'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</textarea>
                  </td>
                </tr>
              </tbody>
            </table>
            <p align="center">
            <input type="hidden" name="action" value="savecard"/>
            <input type="hidden" name="created" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['created'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"/>
            <input type="submit" name="submit" value="保存して終了"/>
            </p>
            <p align="center"><a href="javascript:history.back();">保存せず戻る</a></p>
          </form>
        </div>

      </div>

      <div class="clear"></div>
    </div>

    <script type="text/javascript">
(function () {
  window.onbeforeunload = function() { return "編集を終了します。"; };
}());
    </script>
  </body>
</html>