// html-video studio v0.3 — chat-driven HTML generation

const API = {
  projects: () => fetch('/api/projects').then(r => r.json()),
  createProject: b => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  getProject: id => fetch(`/api/projects/${id}`).then(r => r.json()),
  deleteProject: id => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(r => r.json()),
  templates: () => fetch('/api/templates').then(r => r.json()),
  agents: () => fetch('/api/agents').then(r => r.json()),
  setTemplate: (id, tid) => fetch(`/api/projects/${id}/template`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template_id: tid }) }).then(r => r.json()),
  setAgent: (id, aid) => fetch(`/api/projects/${id}/agent`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent_id: aid }) }).then(r => r.json()),
  preview: id => fetch(`/api/projects/${id}/preview`, { method: 'POST' }).then(r => r.json()),
  exportMp4: id => fetch(`/api/projects/${id}/export`, { method: 'POST' }).then(r => r.json()),
  getMessages: id => fetch(`/api/projects/${id}/messages`).then(r => r.json()),
};

const state = {
  projects: [],
  templates: [],
  agents: [],
  selectedId: null,
  selected: null,
  messages: [],
  composing: false,
  abortController: null,
};

// ============== boot ==============
async function init() {
  await Promise.all([refreshTemplates(), refreshAgents(), refreshProjects()]);
  renderToolbar();
}
async function refreshTemplates() {
  const r = await API.templates();
  state.templates = r.templates ?? [];
}
async function refreshAgents() {
  try {
    const r = await API.agents();
    state.agents = r.agents ?? [];
  } catch { state.agents = []; }
}
async function refreshProjects() {
  const r = await API.projects();
  state.projects = r.projects ?? [];
  renderSidebar();
}

async function selectProject(id) {
  state.selectedId = id;
  const r = await API.getProject(id);
  state.selected = r.project;
  try {
    const mr = await API.getMessages(id);
    state.messages = mr.messages ?? [];
  } catch { state.messages = []; }
  renderSidebar();
  renderToolbar();
  renderChatLog();
  renderPreview();
}

// ============== sidebar ==============
function renderSidebar() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (!state.projects.length) {
    list.innerHTML = '<div class="empty-list">no projects yet</div>';
    return;
  }
  for (const p of state.projects) {
    const div = document.createElement('div');
    div.className = 'project-row' + (p.id === state.selectedId ? ' active' : '');
    div.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">${p.template_id ? escapeHtml(p.template_id) : 'no template'} · ${p.status}</div>
    `;
    div.onclick = () => selectProject(p.id);
    list.appendChild(div);
  }
}

// ============== toolbar ==============
function renderToolbar() {
  const p = state.selected;
  const nameInput = document.getElementById('proj-name');
  const tplSel = document.getElementById('template-select');
  const agentSel = document.getElementById('agent-select');
  const agentStatus = document.getElementById('agent-status');
  const exportBtn = document.getElementById('btn-export');

  nameInput.disabled = !p;
  nameInput.placeholder = p ? '' : '(no project)';
  nameInput.value = p?.name ?? '';

  // Template select
  tplSel.disabled = !p;
  tplSel.innerHTML = '<option value="">— choose —</option>' +
    state.templates.map(t => `<option value="${t.id}" ${p && p.templateId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');

  // Agent select
  const availableAgents = state.agents.filter(a => a.available);
  agentSel.disabled = !p || availableAgents.length === 0;
  agentSel.innerHTML = (availableAgents.length === 0
    ? '<option value="">— none detected —</option>'
    : availableAgents.map(a => `<option value="${a.id}" ${p && p.agentId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}${a.version ? ` · ${escapeHtml(a.version.split(' ')[0])}` : ''}</option>`).join(''));
  // Default to first available if none set
  if (p && !p.agentId && availableAgents[0]) {
    agentSel.value = availableAgents[0].id;
  }

  if (availableAgents.length > 0) {
    agentStatus.className = 'agent-status connected';
    agentStatus.textContent = '● connected';
  } else {
    agentStatus.className = 'agent-status missing';
    agentStatus.textContent = '○ install';
    agentStatus.title = 'No agent detected. Install Claude Code or Cursor Agent CLI.';
  }

  exportBtn.disabled = !p || !p.templateId;

  // Composer enable/disable
  const ta = document.getElementById('composer-input');
  const sendBtn = document.getElementById('btn-send');
  const ready = !!(p && p.templateId && availableAgents.length > 0);
  ta.disabled = !ready;
  sendBtn.disabled = !ready;
  ta.placeholder = !p ? 'Pick a project first…'
    : !p.templateId ? 'Pick a template above first…'
    : availableAgents.length === 0 ? 'Install Claude Code (claude CLI) to enable chat…'
    : 'Describe the video you want — content, names, data, mood…';

  // Footer status
  const fs = document.getElementById('footer-status');
  if (p) {
    fs.innerHTML = `<b>${escapeHtml(p.name)}</b> · ${p.templateId ? `template <b>${escapeHtml(p.templateId)}</b>` : 'no template'} · ${p.status}`;
  } else {
    fs.textContent = 'no project';
  }
}

// ============== chat log ==============
function renderChatLog() {
  const log = document.getElementById('chat-log');
  if (!state.selected) {
    log.innerHTML = `<div class="empty-state"><div><div class="ico">🎬</div>
      <h2>Pick or create a project</h2>
      <p>Each project is one video. Choose a template up top, then chat with your local coding agent to drive the HTML.</p></div></div>`;
    return;
  }
  if (!state.messages.length) {
    log.innerHTML = `<div class="chat-empty"><div><div class="ico">💬</div>
      Tell the agent what to make. The HTML preview on the right updates with each turn.
      <div class="examples">
        <b>"Brand outro for Open Design with tagline 'Design that evolves itself'"</b>
        <b>"Bar chart of OD plugins: Templates 231, Skills 15, Systems 150, Craft 11"</b>
        <b>"Glitch title saying SYSTEM ONLINE in cyan/magenta"</b>
      </div>
    </div></div>`;
    return;
  }
  log.innerHTML = state.messages.map(m => renderMessage(m)).join('');
  log.scrollTop = log.scrollHeight;
}

function renderMessage(m) {
  if (m.role === 'user') return `<div class="msg user">${escapeHtml(m.content)}</div>`;
  if (m.role === 'system') return `<div class="msg system">${escapeHtml(m.content)}</div>`;
  if (m.role === 'preview-event') return `<div class="msg preview-event">${escapeHtml(m.content)}</div>`;
  return `<div class="msg assistant">
    <div class="role">${escapeHtml(m.agent ?? 'agent')}</div>
    <div class="body">${renderMarkdown(m.content ?? '')}</div>
  </div>`;
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, body) =>
    `<pre><code>${body}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

// ============== preview ==============
function renderPreview() {
  const stage = document.getElementById('preview-stage');
  const p = state.selected;
  if (!p || !p.templateId) {
    stage.innerHTML = `<div class="preview-placeholder"><div>
      <div class="ico">🎞️</div>${p ? 'Pick a template above to preview.' : 'Pick a project first.'}</div></div>`;
    return;
  }
  stage.innerHTML = `<div class="preview-frame">
    <iframe id="preview-iframe" sandbox="allow-scripts" src="/preview/${p.id}?t=${Date.now()}"></iframe>
    <div class="stamp">${escapeHtml(p.templateId)}</div>
  </div>`;
}

function reloadPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (iframe && state.selected) {
    iframe.src = `/preview/${state.selected.id}?t=${Date.now()}`;
  }
}

// ============== send message ==============
async function sendMessage() {
  if (state.composing) return;
  const ta = document.getElementById('composer-input');
  const text = ta.value.trim();
  if (!text || !state.selected) return;
  ta.value = '';
  state.composing = true;
  document.getElementById('btn-send').disabled = true;

  state.messages.push({ role: 'user', content: text, ts: Date.now() });
  const asstIdx = state.messages.length;
  state.messages.push({ role: 'assistant', agent: state.selected.agentId ?? 'claude', content: '', ts: Date.now() });
  renderChatLog();

  state.abortController = new AbortController();
  try {
    const res = await fetch(`/api/projects/${state.selected.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: state.abortController.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      state.messages[asstIdx].content = `⚠️ ${err.error ?? 'Agent failed to start.'}`;
      renderChatLog();
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') {
              state.messages[asstIdx].content += ev.chunk;
              renderChatLog();
            } else if (ev.type === 'preview_ready') {
              state.messages[asstIdx].content = '✓ HTML preview updated';
              state.messages.push({
                role: 'preview-event',
                content: '🎞 preview reloaded',
                ts: Date.now(),
              });
              renderChatLog();
              reloadPreview();
              // refresh project status
              const pr = await API.getProject(state.selected.id);
              state.selected = pr.project;
              renderToolbar();
            } else if (ev.type === 'warning') {
              state.messages[asstIdx].content += '\n\n⚠️ ' + ev.message;
              renderChatLog();
            } else if (ev.type === 'error') {
              state.messages[asstIdx].content += '\n\n⚠️ ' + ev.message;
              renderChatLog();
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      state.messages[asstIdx].content += '\n\n⚠️ ' + (e.message ?? e);
      renderChatLog();
    }
  }
  state.composing = false;
  state.abortController = null;
  document.getElementById('btn-send').disabled = false;
  renderToolbar();
}

// ============== modal / toast / utils ==============
function openModal() {
  document.getElementById('modal-bg').classList.add('show');
  document.getElementById('modal-name').focus();
}
function closeModal() {
  document.getElementById('modal-bg').classList.remove('show');
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-intent').value = '';
}

document.getElementById('btn-new').onclick = openModal;
document.getElementById('modal-cancel').onclick = closeModal;
document.getElementById('modal-ok').onclick = async () => {
  const name = document.getElementById('modal-name').value.trim();
  const intent = document.getElementById('modal-intent').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  const r = await API.createProject({ name, ...(intent && { intent }) });
  closeModal();
  await refreshProjects();
  await selectProject(r.project.id);
  toast(`Created "${name}"`, 'success');
};
document.getElementById('modal-bg').addEventListener('click', e => {
  if (e.target.id === 'modal-bg') closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('template-select').onchange = async (e) => {
  if (!state.selected) return;
  const tid = e.target.value || null;
  if (!tid) return;
  const r = await API.setTemplate(state.selected.id, tid);
  state.selected = r.project;
  renderToolbar();
  renderPreview();
  toast(`Template: ${tid}`, 'success');
};

document.getElementById('agent-select').onchange = async (e) => {
  if (!state.selected) return;
  const aid = e.target.value || null;
  await API.setAgent(state.selected.id, aid);
  state.selected = (await API.getProject(state.selected.id)).project;
  renderToolbar();
};

document.getElementById('btn-export').onclick = async () => {
  if (!state.selected) return;
  if (!confirm(`Export "${state.selected.name}" to MP4?\n\n(v0.3 still uses the stub renderer; real Hyperframes wiring lands in v0.4.)`)) return;
  const r = await API.exportMp4(state.selected.id);
  if (r.error) { toast('Export failed: ' + r.error, 'error'); return; }
  state.selected = r.project;
  toast('Exported → ' + r.output_path, 'success');
  renderToolbar();
  refreshProjects();
};

document.getElementById('btn-reload').onclick = reloadPreview;

document.getElementById('btn-send').onclick = sendMessage;
document.getElementById('composer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('proj-name').addEventListener('blur', () => {
  // rename API not yet implemented; revert
  if (state.selected) document.getElementById('proj-name').value = state.selected.name;
});

function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  setTimeout(() => t.classList.remove('show'), 2500);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

init();
