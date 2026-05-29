<?php /* Smarty version 2.6.25-dev, created on 2016-04-12 20:57:26
         compiled from editor/editplayer.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'editor/editplayer.html', 33, false),array('modifier', 'in_array', 'editor/editplayer.html', 91, false),)), $this); ?>
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
          <h3>選手プロフィール編集</h3>
        </div>

        <div class="bodytext">

          <form id="mainform" action="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php" method="post">
            <input type="hidden" name="playerid" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['playerid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"/>

            <table width="90%" border="0" cellspacing="2" cellpadding="5">
              <tbody>
                <tr class="gb2">
                  <td width="150" align="right"><strong>選手ID</strong></td>
                  <td align="left"><?php echo $this->_tpl_vars['data']['playerid']; ?>
</td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>名前</strong></td>
                  <td align="left">フルネーム
                    <input name="longname" type="text" id="CARD_NAME2" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['longname'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                    ／略称
                    <input name="name" type="text" id="CARD_NAME3" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>国籍</strong></td>
                  <td align="left">
                    <input name="country" type="text" id="CARD_NAME4" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['country'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>選手区分</strong></td>
                  <td align="left">
                    <input name="category" type="text" id="CARD_NAME" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['category'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" size="40" />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>身長体重</strong></td>
                  <td align="left">身長
                    <input name="height" type="text" id="CARD_NAME5" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['height'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                    cm／体重
                    <input name="weight" type="text" id="CARD_NAME6" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['weight'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                    kg
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>プロフィール</strong></td>
                  <td align="left">
                    <textarea name="profile" id="MEM_INFO" cols="45" rows="5"><?php echo ((is_array($_tmp=$this->_tpl_vars['data']['profile'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</textarea>
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>メインポジション</strong></td>
                  <td align="left">
                    <select name="mposition" id="MEM_POSITION">
                      <option value="" <?php if (! $this->_tpl_vars['data']['mposition']): ?>selected="selected"<?php endif; ?>>未選択</option>
                      <option value="FW" <?php if ($this->_tpl_vars['data']['mposition'] == 'FW'): ?>selected="selected"<?php endif; ?>>FW</option>
                      <option value="MF" <?php if ($this->_tpl_vars['data']['mposition'] == 'MF'): ?>selected="selected"<?php endif; ?>>MF</option>
                      <option value="DF" <?php if ($this->_tpl_vars['data']['mposition'] == 'DF'): ?>selected="selected"<?php endif; ?>>DF</option>
                      <option value="GK" <?php if ($this->_tpl_vars['data']['mposition'] == 'GK'): ?>selected="selected"<?php endif; ?>>GK</option>
                    </select>
                    ※必須					</td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>得意ポジション</strong></td>
                  <td align="left">
                    <input type="checkbox" name="positions[]" value="CF" <?php if (((is_array($_tmp='CF')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>CF
                    <input type="checkbox" name="positions[]" value="WG" <?php if (((is_array($_tmp='WG')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>WG
                    <input type="checkbox" name="positions[]" value="CMF" <?php if (((is_array($_tmp='CMF')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>CMF
                    <input type="checkbox" name="positions[]" value="SMF" <?php if (((is_array($_tmp='SMF')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>SMF
                    <input type="checkbox" name="positions[]" value="OMF" <?php if (((is_array($_tmp='OMF')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>OMF
                    <input type="checkbox" name="positions[]" value="DMF" <?php if (((is_array($_tmp='DMF')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>DMF
                    <input type="checkbox" name="positions[]" value="CB" <?php if (((is_array($_tmp='CB')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>CB
                    <input type="checkbox" name="positions[]" value="SB" <?php if (((is_array($_tmp='SB')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>SB
                    <input type="checkbox" name="positions[]" value="SW" <?php if (((is_array($_tmp='SW')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>SW
                    <input type="checkbox" name="positions[]" value="GK" <?php if (((is_array($_tmp='GK')) ? $this->_run_mod_handler('in_array', true, $_tmp, $this->_tpl_vars['data']['positions']) : in_array($_tmp, $this->_tpl_vars['data']['positions']))): ?>checked="checked"<?php endif; ?>>GK
                    ※必須<br />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right">攻撃系パラメータ</td>
                  <td>
                    <table border="0" cellpadding="2" cellspacing="0" align="left">
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">パワー</td>
                        <td align="left" nowrap="nowrap">
                          <input name="power" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['power'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">スタミナ</td>
                        <td align="left" nowrap="nowrap">
                          <input name="stamina" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['stamina'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">トップスピード</td>
                        <td align="left" nowrap="nowrap">
                          <input name="top_speed" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['top_speed'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">加速力</td>
                        <td align="left" nowrap="nowrap">
                          <input name="acceleration" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['acceleration'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">レスポンス</td>
                        <td align="left" nowrap="nowrap">
                          <input name="response" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['response'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ジャンプ</td>
                        <td align="left" nowrap="nowrap">
                          <input name="jump" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['jump'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">敏捷性</td>
                        <td align="left" nowrap="nowrap">
                          <input name="agility" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['agility'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ドリブル精度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="dribble_accuracy" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['dribble_accuracy'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ドリブルスピード</td>
                        <td align="left" nowrap="nowrap">
                          <input name="dribble_speed" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['dribble_speed'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ショートパス精度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="shortpass_accuracy" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['shortpass_accuracy'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ショートパススピード</td>
                        <td align="left" nowrap="nowrap">
                          <input name="shortpass_speed" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['shortpass_speed'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ロングパス精度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="longpass_accuracy" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['longpass_accuracy'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ロングパススピード</td>
                        <td align="left" nowrap="nowrap">
                          <input name="longpass_speed" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['longpass_speed'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">シュート精度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="shoot_accuracy" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['shoot_accuracy'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">シュート力</td>
                        <td align="left" nowrap="nowrap">
                          <input name="shoot_making" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['shoot_making'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">シュートテクニック</td>
                        <td align="left" nowrap="nowrap">
                          <input name="shoot_tech" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['shoot_tech'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">フリーキック精度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="freekick_accuracy" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['freekick_accuracy'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">カーブ</td>
                        <td align="left" nowrap="nowrap">
                          <input name="curve" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['curve'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ボールテクニック</td>
                        <td align="left" nowrap="nowrap">
                          <input name="ball_tech" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['ball_tech'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">攻撃性</td>
                        <td align="left" nowrap="nowrap">
                          <input name="offensive" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['offensive'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right">守備系パラメータ</td>
                  <td>
                    <table border="0" cellpadding="2" cellspacing="0" align="left">
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">パスカット</td>
                        <td align="left" nowrap="nowrap">
                          <input name="pass_cut" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['pass_cut'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">タックル</td>
                        <td align="left" nowrap="nowrap">
                          <input name="tackle" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['tackle'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">マンマーク</td>
                        <td align="left" nowrap="nowrap">
                          <input name="man_marking" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['man_marking'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">カバーリング</td>
                        <td align="left" nowrap="nowrap">
                          <input name="covering" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['covering'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">チェイシング</td>
                        <td align="left" nowrap="nowrap">
                          <input name="chasing" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['chasing'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">セービング</td>
                        <td align="left" nowrap="nowrap">
                          <input name="saving" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['saving'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ハイボール処理</td>
                        <td align="left" nowrap="nowrap">
                          <input name="highball" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['highball'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right">攻撃・守備系パラメータ</td>
                  <td>
                    <table border="0" cellpadding="2" cellspacing="0" align="left">
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ヘディング</td>
                        <td align="left" nowrap="nowrap">
                          <input name="heading" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['heading'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">ポジショニング</td>
                        <td align="left" nowrap="nowrap">
                          <input name="positioning" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['positioning'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right">メンタルパラメータ</td>
                  <td>
                    <table border="0" cellpadding="2" cellspacing="0" align="left">
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">精神安定度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="mentality" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['mentality'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">連携</td>
                        <td align="left" nowrap="nowrap">
                          <input name="combination" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['combination'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">コンディション安定度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="condition_stability" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['condition_stability'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">戦術眼</td>
                        <td align="left" nowrap="nowrap">
                          <input name="strategic_eye" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['strategic_eye'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">創造性</td>
                        <td align="left" nowrap="nowrap">
                          <input name="creativity" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['creativity'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">フェアプレー</td>
                        <td align="left" nowrap="nowrap">
                          <input name="fair_play" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['fair_play'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right">その他</td>
                  <td>
                    <table border="0" cellpadding="2" cellspacing="0" align="left">
                      <tr>
                        <td width="150" align="right" nowrap="nowrap">疲労度</td>
                        <td align="left" nowrap="nowrap">
                          <input name="fatigue" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['fatigue'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" type="text" size="4" maxlength="2" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
            <p align="center">
            <input type="hidden" name="action" value="saveplayer"/>
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