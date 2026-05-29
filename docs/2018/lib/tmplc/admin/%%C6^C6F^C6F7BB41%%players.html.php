<?php /* Smarty version 2.6.25-dev, created on 2016-07-05 21:15:29
         compiled from editor/players.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'editor/players.html', 48, false),)), $this); ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />

    <title>Sim Football Data Editor</title>

    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="memeid.css" />
    <link rel="stylesheet" href="memeclass.css" />
    <link rel="stylesheet" href="memehtml.css" />
    <script type="text/javascript" src="../js/jquery-1.8.2.min.js"></script>
    <script type="text/javascript">
function deletePlayer(pid){
  if (window.confirm('ID '+pid+' のデータを削除しますか？')) {
    location.href = "<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=deleteplayer&playerid="+pid;
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
          <h3>選手一覧</h3>
        </div>

        <div class="bodytext">

          <p><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=editplayer" class="btn btn-sub">新規選手作成</a></p>

          <table width="90%" border="0" cellspacing="2" cellpadding="5">
            <tbody>
              <tr>
                <td colspan="6" align="right">
                  <form id="mainform" action="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php" method="post">
                    <input type="hidden" name="action" value="players"/>
                    <input name="kw" type="text" id="CARD_NAME2" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['kw'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" size="40" />で<input type="submit" name="submit" id="submit" value="絞り込み" />
                  </form>
                </td>
              </tr>
              <tr class="whitetitle">
                <td width="10%" align="center" bgcolor="#005296">選手ID（クリックで編集）</td>
                <td width="15%" align="center" bgcolor="#005296">国籍</td>
                <td width="15%" align="center" bgcolor="#005296">選手区分</td>
                <td align="center" bgcolor="#005296">選手名</td>
                <td width="15%" align="center" bgcolor="#005296">登録日</td>
                <td width="10%" align="center" bgcolor="#005296">削除</td>
              </tr>
              <?php $_from = $this->_tpl_vars['data']; if (!is_array($_from) && !is_object($_from)) { settype($_from, 'array'); }$this->_foreach['list'] = array('total' => count($_from), 'iteration' => 0);
if ($this->_foreach['list']['total'] > 0):
    foreach ($_from as $this->_tpl_vars['i']):
        $this->_foreach['list']['iteration']++;
?>
              <tr class="gb1">
                <td><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=editplayer&playerid=<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['playerid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['playerid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</a></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['country'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['category'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><strong><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['longname'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
 / <?php echo ((is_array($_tmp=$this->_tpl_vars['i']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</strong></td>
                <td><?php echo ((is_array($_tmp=$this->_tpl_vars['i']['created'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</td>
                <td>【<a href="#" onclick="deletePlayer(<?php echo ((is_array($_tmp=$this->_tpl_vars['i']['playerid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
);">削除</a>】</td>
              </tr>
              <?php endforeach; endif; unset($_from); ?>
            </tbody>
          </table>
          <div align="center" style="margin: 2em 0;"><input type="button" value="ダウンロード" onclick="location.href='<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=downloadplayers'"/></div>
          <div align="center" style="margin: 2em 0;">
            <form id="uploadform" action="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=uploadplayers" method="post" enctype="multipart/form-data">
              <input type="file" name="upfile" size="30" />
              <input type="submit" name="submit" value="アップロード" class="btn btn-sub"/>
            </form>
          </div>
          <br/>
          <p align="center"><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php">TOPに戻る</a></p>
        </div>

      </div>

      <div class="clear"></div>
    </div>
  </body>
</html>