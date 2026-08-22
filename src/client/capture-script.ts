/**
 * The guided capture script users paste into the DevTools console on
 * platform.deepseek.com. Mirrors DeepSeekMonitorWindows' USAGE_SYNC_POLL_JS
 * injection: monkey-patch fetch/XHR to surface the next `Authorization:
 * Bearer …` header, then render a floating card with the token and a
 * copy button. Runs entirely in the platform page's own context — nothing
 * is transmitted anywhere.
 */

export const CAPTURE_SCRIPT = `(function(){
  if (window.__dshCapInstalled) { alert('已在监听中：刷新页面或点击任意功能即可捕获。'); return }
  window.__dshCapInstalled = true
  function deliver(token){
    token = String(token).trim()
    if (token.length < 20 || document.getElementById('__dshCapCard')) return
    var card = document.createElement('div')
    card.id = '__dshCapCard'
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;color:#111;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;width:340px;font:13px/1.5 system-ui,sans-serif'
    card.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">DeepSeek Monitor · 已捕获平台 Token</div>' +
      '<textarea readonly style="width:100%;height:72px;box-sizing:border-box;font:11px/1.4 monospace;border:1px solid #ddd;border-radius:6px;padding:6px"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="__copy" style="flex:1;padding:6px 10px;border:0;border-radius:6px;background:#4D6BFE;color:#fff;font-weight:600;cursor:pointer">复制 Token</button>' +
        '<button class="__close" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">关闭</button>' +
      '</div>' +
      '<div style="margin-top:6px;color:#888;font-size:11px">复制后回到 DeepSeek Harness 粘贴保存。</div>'
    document.body.appendChild(card)
    var area = card.querySelector('textarea')
    area.value = token
    card.querySelector('.__copy').addEventListener('click', function(){
      area.select()
      try { navigator.clipboard.writeText(token) } catch (e) { document.execCommand('copy') }
      this.textContent = '已复制 ✓'
    })
    card.querySelector('.__close').addEventListener('click', function(){ card.remove() })
  }
  function fromAuth(value){
    if (!value) return
    var m = /Bearer\\s+(\\S+)/i.exec(String(value))
    if (m && m[1] && m[1].length >= 20) deliver(m[1])
  }
  var origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init){
      try {
        var headers = (init && init.headers) || (input && input.headers)
        if (headers) {
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            fromAuth(headers.get('authorization'))
          } else if (Array.isArray(headers)) {
            for (var i = 0; i < headers.length; i++) {
              if (headers[i] && String(headers[i][0]).toLowerCase() === 'authorization') fromAuth(headers[i][1])
            }
          } else if (typeof headers === 'object') {
            for (var k in headers) {
              if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === 'authorization') fromAuth(headers[k])
            }
          }
        }
      } catch (e) {}
      return origFetch.apply(this, arguments)
    }
  }
  var origSet = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function(name, value){
    try { if (name && String(name).toLowerCase() === 'authorization') fromAuth(value) } catch (e) {}
    return origSet.apply(this, [name, value])
  }
  alert('监听已开启。请刷新页面或点击任意功能（如"用量"页），捕获后会弹出卡片。')
})()`
