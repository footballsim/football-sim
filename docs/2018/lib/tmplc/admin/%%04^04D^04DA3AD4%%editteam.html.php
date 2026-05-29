<?php /* Smarty version 2.6.25-dev, created on 2018-04-02 23:34:15
         compiled from editor/editteam.html */ ?>
<?php require_once(SMARTY_CORE_DIR . 'core.load_plugins.php');
smarty_core_load_plugins(array('plugins' => array(array('modifier', 'escape', 'editor/editteam.html', 38, false),)), $this); ?>
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
    <style>
      .member {width: 10em; margin: 2px 5px 0 2px;}
    </style>
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
          <h3>チーム編集</h3>
        </div>

        <div class="bodytext">

          <form id="mainform" action="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php" method="post">
            <input type="hidden" name="teamid" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['teamid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
"/>

            <table width="90%" border="0" cellspacing="2" cellpadding="5">
              <tr class="gb2">
                <td align="right"><strong>チームID</strong></td>
                <td align="left"><?php echo ((is_array($_tmp=$this->_tpl_vars['data']['teamid'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
</td>
              </tr>
              <tbody>
                <tr class="gb1">
                  <td width="20%" align="right"><strong>チーム名</strong></td>
                  <td align="left">
                    <input name="name" type="text" id="CARD_NAME" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['name'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>チーム区分</strong></td>
                  <td align="left">
                    <input name="category" type="text" id="CARD_NAME3" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['category'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>年　号</strong></td>
                  <td align="left">
                    <input name="year" type="text" id="CARD_NAME4" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['data']['year'])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" />
                  </td>
                </tr>
                <tr class="gb2">
                  <td align="right"><strong>戦　術</strong></td>
                  <td align="left">
                    <select name="tactics" id="#TEAM_STRAT">
                      <option value="0" <?php if ($this->_tpl_vars['data']['tactics'] == 0): ?>selected="selected"<?php endif; ?>>ポゼッション重視</option>
                      <option value="1" <?php if ($this->_tpl_vars['data']['tactics'] == 1): ?>selected="selected"<?php endif; ?>>プレスディフェンス</option>
                      <option value="2" <?php if ($this->_tpl_vars['data']['tactics'] == 2): ?>selected="selected"<?php endif; ?>>カウンターアタック</option>
                      <option value="3" <?php if ($this->_tpl_vars['data']['tactics'] == 3): ?>selected="selected"<?php endif; ?>>カテナチオ</option>
                      <option value="4" <?php if ($this->_tpl_vars['data']['tactics'] == 4): ?>selected="selected"<?php endif; ?>>自由に戦え</option>
                    </select>
                  </td>
                </tr>
                <tr class="gb1">
                  <td align="right"><strong>システム</strong></td>
                  <td align="left">
                    <select name="system" id="#TEAM_SYSTEM">
                      <option value="0" <?php if ($this->_tpl_vars['data']['system'] == 0): ?>selected="selected"<?php endif; ?>>4-1-3-2</option>
                      <option value="1" <?php if ($this->_tpl_vars['data']['system'] == 1): ?>selected="selected"<?php endif; ?>>4-2-2-2</option>
                      <option value="2" <?php if ($this->_tpl_vars['data']['system'] == 2): ?>selected="selected"<?php endif; ?>>4-4-2</option>
                      <option value="3" <?php if ($this->_tpl_vars['data']['system'] == 3): ?>selected="selected"<?php endif; ?>>4-3-1-2</option>
                      <option value="4" <?php if ($this->_tpl_vars['data']['system'] == 4): ?>selected="selected"<?php endif; ?>>4-1-4-1</option>
                      <option value="5" <?php if ($this->_tpl_vars['data']['system'] == 5): ?>selected="selected"<?php endif; ?>>4-2-3-1</option>
                      <option value="6" <?php if ($this->_tpl_vars['data']['system'] == 6): ?>selected="selected"<?php endif; ?>>4-3-2-1A</option>
                      <option value="7" <?php if ($this->_tpl_vars['data']['system'] == 7): ?>selected="selected"<?php endif; ?>>4-3-2-1B</option>
                      <option value="8" <?php if ($this->_tpl_vars['data']['system'] == 8): ?>selected="selected"<?php endif; ?>>4-1-2-3</option>
                      <option value="9" <?php if ($this->_tpl_vars['data']['system'] == 9): ?>selected="selected"<?php endif; ?>>4-2-1-3</option>
                      <option value="10" <?php if ($this->_tpl_vars['data']['system'] == 10): ?>selected="selected"<?php endif; ?>>3-1-3-3</option>
                      <option value="11" <?php if ($this->_tpl_vars['data']['system'] == 11): ?>selected="selected"<?php endif; ?>>3-2-2-3</option>
                      <option value="12" <?php if ($this->_tpl_vars['data']['system'] == 12): ?>selected="selected"<?php endif; ?>>3-4-3</option>
                      <option value="13" <?php if ($this->_tpl_vars['data']['system'] == 13): ?>selected="selected"<?php endif; ?>>3-3-2-2</option>
                      <option value="14" <?php if ($this->_tpl_vars['data']['system'] == 14): ?>selected="selected"<?php endif; ?>>3-2-3-2</option>
                      <option value="15" <?php if ($this->_tpl_vars['data']['system'] == 15): ?>selected="selected"<?php endif; ?>>3-3-3-1</option>
                      <option value="16" <?php if ($this->_tpl_vars['data']['system'] == 16): ?>selected="selected"<?php endif; ?>>3-4-2-1</option>
                      <option value="17" <?php if ($this->_tpl_vars['data']['system'] == 17): ?>selected="selected"<?php endif; ?>>5-1-2-2</option>
                      <option value="18" <?php if ($this->_tpl_vars['data']['system'] == 18): ?>selected="selected"<?php endif; ?>>5-2-1-2</option>
                      <option value="19" <?php if ($this->_tpl_vars['data']['system'] == 19): ?>selected="selected"<?php endif; ?>>5-1-3-1</option>
                      <option value="20" <?php if ($this->_tpl_vars['data']['system'] == 20): ?>selected="selected"<?php endif; ?>>5-2-2-1</option>
                      <option value="21" <?php if ($this->_tpl_vars['data']['system'] == 21): ?>selected="selected"<?php endif; ?>>5-4-1</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="topcopy">
              <h3 align="center">登録選手</h3>
            </div>
            <p style="text-align: center"><a href="<?php echo $this->_tpl_vars['root']; ?>
admin/editor.php?action=players" target="_blank">選手リストを別タブで表示</a></p>
            <table width="90%" border="0" cellspacing="2" cellpadding="5">
              <tbody>
                <tr class="gb1">
                  <td width="10%" align="center" class="gb1">&nbsp;</td>
                  <td width="40%" align="center" class="gb1">選手</td>
                  <td width="10%" align="center">&nbsp;</td>
                  <td width="40%" align="center" class="gb1">選手</td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">01</td>
                  <td align="left"><input name="members[0]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][0])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">26</td>
                  <td align="left"><input name="members[25]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][25])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">02</td>
                  <td align="left"><input name="members[1]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][1])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">27</td>
                  <td align="left"><input name="members[26]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][26])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">03</td>
                  <td align="left"><input name="members[2]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][2])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">28</td>
                  <td align="left"><input name="members[27]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][27])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">04</td>
                  <td align="left"><input name="members[3]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][3])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">29</td>
                  <td align="left"><input name="members[28]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][28])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">05</td>
                  <td align="left"><input name="members[4]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][4])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">30</td>
                  <td align="left"><input name="members[29]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][29])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">06</td>
                  <td align="left"><input name="members[5]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][5])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">31</td>
                  <td align="left"><input name="members[30]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][30])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">07</td>
                  <td align="left"><input name="members[6]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][6])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">32</td>
                  <td align="left"><input name="members[31]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][31])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">08</td>
                  <td align="left"><input name="members[7]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][7])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">33</td>
                  <td align="left"><input name="members[32]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][32])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">09</td>
                  <td align="left"><input name="members[8]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][8])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">34</td>
                  <td align="left"><input name="members[33]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][33])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">10</td>
                  <td align="left"><input name="members[9]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][9])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">35</td>
                  <td align="left"><input name="members[34]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][34])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">11</td>
                  <td align="left"><input name="members[10]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][10])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">36</td>
                  <td align="left"><input name="members[35]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][35])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">12</td>
                  <td align="left"><input name="members[11]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][11])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">37</td>
                  <td align="left"><input name="members[36]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][36])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">13</td>
                  <td align="left"><input name="members[12]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][12])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">38</td>
                  <td align="left"><input name="members[37]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][37])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">14</td>
                  <td align="left"><input name="members[13]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][13])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">39</td>
                  <td align="left"><input name="members[38]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][38])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">15</td>
                  <td align="left"><input name="members[14]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][14])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">40</td>
                  <td align="left"><input name="members[39]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][39])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">16</td>
                  <td align="left"><input name="members[15]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][15])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">41</td>
                  <td align="left"><input name="members[40]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][40])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">17</td>
                  <td align="left"><input name="members[16]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][16])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">42</td>
                  <td align="left"><input name="members[41]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][41])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">18</td>
                  <td align="left"><input name="members[17]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][17])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">43</td>
                  <td align="left"><input name="members[42]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][42])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">19</td>
                  <td align="left"><input name="members[18]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][18])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">44</td>
                  <td align="left"><input name="members[43]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][43])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">20</td>
                  <td align="left"><input name="members[19]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][19])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">45</td>
                  <td align="left"><input name="members[44]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][44])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">21</td>
                  <td align="left"><input name="members[20]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][20])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">46</td>
                  <td align="left"><input name="members[45]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][45])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">22</td>
                  <td align="left"><input name="members[21]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][21])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">47</td>
                  <td align="left"><input name="members[46]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][46])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">23</td>
                  <td align="left"><input name="members[22]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][22])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">48</td>
                  <td align="left"><input name="members[47]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][47])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">24</td>
                  <td align="left"><input name="members[23]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][23])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">49</td>
                  <td align="left"><input name="members[48]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][48])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
                <tr class="gb2">
                  <td align="center" class="gb2">25</td>
                  <td align="left"><input name="members[24]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][24])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                  <td align="center">50</td>
                  <td align="left"><input name="members[49]" type="text" value="<?php echo ((is_array($_tmp=$this->_tpl_vars['members'][49])) ? $this->_run_mod_handler('escape', true, $_tmp) : smarty_modifier_escape($_tmp)); ?>
" class="member"/><span> </span></td>
                </tr>
              </tbody>
            </table>
            <p>&nbsp;</p>
            <p align="center">
            <input type="hidden" name="action" value="saveteam"/>
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
$(document).ready(function() {
  window.onbeforeunload = function() { return "編集を終了します。"; };

  $(".member").change(function(event) {
    $.get("<?php echo $this->_tpl_vars['root']; ?>
remote.php",
        { action: "getplayerinfo", id: event.target.value},
        function(data) {
          if (data == "")
            event.target.value = "0";
          event.target.nextSibling.innerHTML = data;
        });
  });

  $(".member").each(function() {
    var d = this;
    $.get("<?php echo $this->_tpl_vars['root']; ?>
remote.php",
        { action: "getplayerinfo", id: d.value},
        function(data) {
          if (data == "")
            d.value = "0";
          d.nextSibling.innerHTML = data;
        });
  });
});
    </script>
  </body>
</html>