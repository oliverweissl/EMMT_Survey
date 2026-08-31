const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbws04TO2aHPf0ZYh_h3gJkDtJq2SptiJvNXxMSXWecg3dPntbWb__CipklOlnXe6ukg/exec';
const app = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const variant = params.get('variant');
const sessionId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
let workerId = '';
let sequence = [];
let position = 0;
let pendingResponses = [];
let uploadComplete = false;

window.addEventListener('beforeunload', event => {
  if (workerId && !uploadComplete) {
    event.preventDefault();
    event.returnValue = 'Your responses are not uploaded yet. Please stay on this page.';
  }
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rootPath = path => new URL(path, document.baseURI).href;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

function send(payload) {
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST', mode: 'no-cors', cache: 'no-store', keepalive: true,
    headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(payload)
  });
}

function basePayload(item, taskIndex) {
  return { annotator_id: workerId, session_id: sessionId, task_index: taskIndex,
    category: item.category || '', method: 'human_bbox_annotation', variant,
    filename: item.filename || '', label: item.attention ? item.case_id : (item.labels || []).join(', '),
    label_index: item.label_index ?? '', total_labels: item.labels?.length || '',
    timestamp: new Date().toISOString() };
}

function intro() {
  app.innerHTML = `<section class="intro"><h1>Image annotation study</h1>
    <p>You are shown 50 images with prompts. Please follow the instruction in each prompt. If either the image or the prompt is not clear, or you are not sure what to do, you can reject the sample for a specific reason or skip it. Otherwise, you may draw one or multiple boxes around the objects requested in the prompt.</p>
    <p><strong>Attention checks are included. Failure to follow an attention-check instruction may result in rejection of the HIT.</strong></p>
    <label for="worker-id">MTurk Worker ID</label><input id="worker-id" type="text" autocomplete="off" required>
    <div><button id="start">Start study</button></div><p class="message" id="message"></p></section>`;
  document.querySelector('#start').onclick = () => {
    workerId = document.querySelector('#worker-id').value.trim();
    if (!workerId) return (document.querySelector('#message').textContent = 'Worker ID is required.');
    position = 0; pendingResponses = []; uploadComplete = false; showCurrent();
  };
}

function showCurrent() {
  const item = sequence[position];
  if (!item) return finish();
  renderAnnotation(item);
}

function taskHeader(item) { return `<div class="progress">Task ${position + 1} of ${sequence.length}</div><p class="instruction">${esc(item.prompt)}</p>`; }

function renderAnnotation(item) {
  app.innerHTML = `<section><div>${taskHeader(item)}</div><div class="canvas-wrap"><img id="image" src="${rootPath(item.image)}" alt="Image to annotate"><canvas id="canvas"></canvas></div>
    <div class="controls"><button id="submit">Submit boxes</button><button class="reject-button" data-reason="unclear_label">Reject: unclear label</button><button class="reject-button" data-reason="unclear_image">Reject: unclear image</button><button class="reject-button" data-reason="other">Reject: other</button><button id="skip">Skip</button></div>
    <p class="message" id="message"></p></section>`;
  const image = document.querySelector('#image');
  image.onload = () => setupCanvas(image, item);
  document.querySelector('#submit').onclick = () => {
    const taskBoxes = currentBoxes();
    if (taskBoxes.length === 0 && !confirmedNoBoxes) {
      confirmedNoBoxes = true;
      document.querySelector('#message').textContent = 'No boxes drawn. Click "Submit boxes" again to submit without any boxes.';
      return;
    }
    submitAnnotation(item, 'bbox', '', taskBoxes);
  };
  document.querySelector('#skip').onclick = () => submitAnnotation(item, 'skip', '', []);
  document.querySelectorAll('.reject-button').forEach(button => {
    button.onclick = () => submitAnnotation(item, item.attention ? 'attention' : 'reject', button.dataset.reason, []);
  });
}

let boxes = [], active = null, selected = -1, redrawCanvas = () => {}, confirmedNoBoxes = false;
function setupCanvas(image, item) {
  const canvas = document.querySelector('#canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  const handleSize = Math.max(10, canvas.width / 100);
  const deleteSize = handleSize * 1.6;
  const corners = b => [{x:b.x, y:b.y, corner:'tl'}, {x:b.x+b.w, y:b.y, corner:'tr'}, {x:b.x, y:b.y+b.h, corner:'bl'}, {x:b.x+b.w, y:b.y+b.h, corner:'br'}];
  const deletePos = b => ({x: b.x+b.w+deleteSize/2, y: b.y-deleteSize/2});
  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(2, canvas.width / 500);
    boxes.forEach((b, i) => {
      ctx.strokeStyle = i === selected ? '#e11' : '#39ff14';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (i === selected) {
        ctx.fillStyle = '#e11';
        corners(b).forEach(c => ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize));
        const d = deletePos(b);
        ctx.beginPath(); ctx.arc(d.x, d.y, deleteSize / 2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, deleteSize / 8);
        ctx.beginPath(); ctx.moveTo(d.x-deleteSize/4, d.y-deleteSize/4); ctx.lineTo(d.x+deleteSize/4, d.y+deleteSize/4);
        ctx.moveTo(d.x+deleteSize/4, d.y-deleteSize/4); ctx.lineTo(d.x-deleteSize/4, d.y+deleteSize/4); ctx.stroke();
      }
    });
    if (active) { ctx.strokeStyle = '#39ff14'; ctx.strokeRect(active.x, active.y, active.w, active.h); }
  };
  redrawCanvas = redraw;
  const point = event => { const r = canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*canvas.width/r.width, y:(event.clientY-r.top)*canvas.height/r.height}; };
  const hitDelete = p => { if (selected < 0) return false; const d = deletePos(boxes[selected]); return Math.hypot(p.x-d.x, p.y-d.y) <= deleteSize / 2; };
  const hitHandle = p => { if (selected < 0) return null; const hit = corners(boxes[selected]).find(c => Math.abs(p.x-c.x) <= handleSize && Math.abs(p.y-c.y) <= handleSize); return hit ? hit.corner : null; };
  const hitBox = p => { for (let i = boxes.length - 1; i >= 0; i--) { const b = boxes[i]; if (p.x >= b.x && p.x <= b.x+b.w && p.y >= b.y && p.y <= b.y+b.h) return i; } return -1; };
  let dragMode = null, dragCorner = null, dragOrig = null, dragStart = null;
  const resizeBox = p => {
    const b = boxes[selected], o = dragOrig;
    let x1 = o.x, y1 = o.y, x2 = o.x+o.w, y2 = o.y+o.h;
    if (dragCorner.includes('l')) x1 = p.x; if (dragCorner.includes('r')) x2 = p.x;
    if (dragCorner.includes('t')) y1 = p.y; if (dragCorner.includes('b')) y2 = p.y;
    b.x = Math.min(x1, x2); b.y = Math.min(y1, y2); b.w = Math.abs(x2-x1); b.h = Math.abs(y2-y1);
  };
  canvas.onpointerdown = e => {
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    if (hitDelete(p)) { boxes.splice(selected, 1); selected = -1; redraw(); return; }
    const handle = hitHandle(p);
    if (handle) { dragMode = 'resize'; dragCorner = handle; dragOrig = {...boxes[selected]}; redraw(); return; }
    const idx = hitBox(p);
    if (idx >= 0) { selected = idx; dragMode = 'move'; dragOrig = {...boxes[idx]}; dragStart = p; redraw(); return; }
    selected = -1; dragMode = 'draw'; active = {x:p.x,y:p.y,w:0,h:0}; redraw();
  };
  canvas.onpointermove = e => {
    if (!dragMode) return;
    const p = point(e);
    if (dragMode === 'draw') { active.w = p.x-active.x; active.h = p.y-active.y; }
    else if (dragMode === 'move') { const b = boxes[selected]; b.x = dragOrig.x + (p.x-dragStart.x); b.y = dragOrig.y + (p.y-dragStart.y); }
    else if (dragMode === 'resize') { resizeBox(p); }
    redraw();
  };
  canvas.onpointerup = () => {
    if (dragMode === 'draw' && active) {
      const b = {x:Math.min(active.x,active.x+active.w), y:Math.min(active.y,active.y+active.h), w:Math.abs(active.w), h:Math.abs(active.h)};
      if (b.w > 2 && b.h > 2) { boxes.push(b); selected = boxes.length - 1; }
      active = null;
    }
    dragMode = null; dragCorner = null; redraw();
  };
  boxes = []; selected = -1; confirmedNoBoxes = false; redraw();
}
function currentBoxes() { return boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.x+b.w), Math.round(b.y+b.h)]); }
async function submitAnnotation(item, type, reason, taskBoxes) {
  const message = document.querySelector('#message'); message.textContent = 'Saved for final submission.';
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  const payload = {...basePayload(item, position), response_type:type, reject_reason:reason, bboxes:JSON.stringify(item.attention ? {expected:'unclear_image', selected:reason, correct:reason === 'unclear_image'} : taskBoxes), num_bboxes:taskBoxes.length, image_width:document.querySelector('#image').naturalWidth, image_height:document.querySelector('#image').naturalHeight};
  pendingResponses.push(payload);
  position++; boxes = []; selected = -1; showCurrent();
}

async function finish() {
  document.title = 'Uploading responses…';
  app.innerHTML = `<section class="end"><h1>Please keep this page open</h1><p>Uploading all ${pendingResponses.length} responses now.</p><p><strong>Do not close this page, refresh it, or navigate away until the upload is complete.</strong></p><p class="message" id="message">Uploading…</p></section>`;
  try {
    await send({batch: true, responses: pendingResponses});
    uploadComplete = true;
    document.title = 'Image annotation study';
    app.innerHTML = `<section class="end"><h1>Thank you</h1><p>Your responses have been recorded.</p><p>Enter this completion code on MTurk: <strong>${esc(sessionId)}</strong></p></section>`;
  } catch (error) {
    app.innerHTML = '<section class="end"><h1>Submission problem</h1><p>Your responses could not be sent. Please keep this page open and try again.</p><button id="retry">Retry submission</button><p class="message" id="message"></p></section>';
    document.querySelector('#retry').onclick = finish;
  }
}

async function start() {
  if (!['1','2','3'].includes(variant)) throw new Error('Use this survey with ?variant=1, ?variant=2, or ?variant=3.');
  const [tasks, clean] = await Promise.all([loadJson(`data/variants/variant-${variant}.json`), loadJson('data/clean-cases.json')]);
  const selected = [...clean].sort(() => Math.random() - .5).slice(0, 2).map(item => ({...item, type:'annotation', attention:true, prompt:`${item.prompt}\n\nSelect “unclear image” to reject this image. This is an attention question.`}));
  sequence = [...tasks.map(item => ({...item, type:'annotation'})), ...selected];
  selected.forEach(item => { const from = tasks.length ? Math.floor(Math.random() * (tasks.length + 1)) : 0; sequence.splice(from, 0, sequence.pop()); });
  intro();
}
start().catch(error => { app.innerHTML = `<section class="error"><h1>Survey configuration error</h1><p>${esc(error.message)}</p></section>`; });
