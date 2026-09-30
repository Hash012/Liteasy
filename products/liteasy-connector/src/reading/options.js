(() => {
  'use strict';
  const status = document.getElementById('status');
  let busy = false;
  const say = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  async function rpc(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '扩展后台未响应');
    return result;
  }
  async function refresh() {
    const s = await rpc({type: 'CGR_STATS'});
    document.getElementById('stats').textContent = `${s.messages} 条消息 · ${s.read} 节已读 · ${(s.bytes / 1024 / 1024).toFixed(2)} / ${(s.quota / 1024 / 1024).toFixed(0)} MB`;
    const n=await rpc({type:'CGR_NOTE_STATS'});
    document.getElementById('notes-stats').textContent=`${n.active} 条批注 · ${n.trash} 条回收站记录 · ${n.drafts} 份恢复草稿 · ${n.characters.toLocaleString()} 正文字符（不代表磁盘字节数）`;
    if (s.bytes > s.quota * .8) say('本地空间已使用超过 80%。建议导出备份；达到配额时新的保存会报错，不会静默删除旧进度。', true);
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button,input').forEach((el) => { el.disabled = true; });
    try { await fn(); } catch (error) { say(String(error.message || error), true); }
    finally { busy = false; document.querySelectorAll('button,input').forEach((el) => { el.disabled = false; }); }
  }
  document.getElementById('open-notes').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('sidebar.html')}).catch(e=>say(e.message,true));
  document.getElementById('refresh').onclick = () => run(refresh);
  document.getElementById('export').onclick = () => run(async () => {
    const result = await rpc({type: 'CGR_EXPORT'});
    delete result.ok;
    const blob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `chatgpt-reading-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say('已生成备份文件，请检查浏览器下载列表并妥善保存。');
  });
  document.getElementById('import').onchange = (event) => run(async () => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) throw new Error('文件大于 12 MB，已拒绝读取。');
    const data = JSON.parse(await file.text());
    if (!confirm('将备份按逐节修改时间合并到本地？建议先导出当前进度。')) return;
    const result = await rpc({type: 'CGR_IMPORT', data});
    await refresh(); say(`已合并 ${result.messages} 条消息的进度。已打开的 ChatGPT 标签页会收到更新。`);
  });
  document.getElementById('clear').onclick = () => run(async () => {
    if (!confirm('确定清空本扩展的全部本地阅读进度？此操作不可撤销。请确认已导出备份。')) return;
    await rpc({type: 'CGR_CLEAR'}); await refresh(); say('已清空本地阅读进度。');
  });
  run(refresh);
})();
