<?php /* Smarty version 2.6.25-dev, created on 2018-12-05 04:42:04
         compiled from editor/cards.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'editor/cards.html', 54, false),)), $this); ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />

    <title>Sim Football Data Editor</title>

    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="memeid.css" />
    <link rel="stylesheet" href="memeclass.css" />
    <link rel="stylesheet" href="memehtml.css" />
    <script type="text/javascript">
function deleteCard(cid){
  if (window.confirm('ID '+cid+' のデータを削除しますか？')) {
    location.href = "<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=deletecard&cardid="+cid;
  }
}
    </script>
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
          <h3>対戦カード一覧</h3>
        </div>

        <div class="bodytext">

          <p><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=editcard" class="btn">新規カード作成</a></p>

          <table width="90%" border="0" cellspacing="2" cellpadding="5">
            <tbody>
              <tr class="whitetitle">
                <td width="10%" align="center" bgcolor="#005296">カードID</td>
                <td width="15%" align="center" bgcolor="#005296">カード名</td>
                <td width="15%" align="center" bgcolor="#005296">Aチーム</td>
                <td width="15%" align="center" bgcolor="#005296">Bチーム</td>
                <td align="center" bgcolor="#005296">対戦カード情報</td>
                <td width="10%" align="center" bgcolor="#005296">登録日</td>
                <td width="10%" align="center" bgcolor="#005296">削除</td>
              </tr>
              <?php $_from = $this->_tpl_vars['data']; if (!is_array($_from) && !is_object($_from)) { settype($_from, 'array'); }$this->_foreach['list'] = array('total' => count($_from), 'iteration' => 0);
if ($this->_foreach['list']['total'] > 0):
    foreach ($_from as $this->_tpl_vars['i']):
        $this->_foreach['list']['iteration']++;
?>
              <tr class="gb1">
                <td><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=editcard&cardid=<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['cardid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['cardid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</a></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['team1name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['team2name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['description'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</td>
                <td><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['created'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</td>
                <td>【<a href="#" onclick="deleteCard(<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['cardid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
);">削除</a>】</td>
              </tr>
              <?php endforeach; endif; unset($_from); ?>
            </tbody>
          </table>
          <p align="center"><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php">TOPに戻る</a></p>
        </div>

      </div>

      <div class="clear"></div>
    </div>
  </body>
</html>