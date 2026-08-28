const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzBUD3WYhiZFFJo9eqB_370FuSY4o4Hs3f_1Zin7SmxHYudU9mq1O15wfvlWOmPWRlR/exec';
const app = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const variant = params.get('variant');
const sessionId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
let workerId = '';
let sequence = [];
let position = 0;

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
    position = 0; showCurrent();
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
  document.querySelector('#submit').onclick = () => submitAnnotation(item, 'bbox', '', currentBoxes());
  document.querySelector('#skip').onclick = () => submitAnnotation(item, 'skip', '', []);
  document.querySelectorAll('.reject-button').forEach(button => {
    button.onclick = () => submitAnnotation(item, item.attention ? 'attention' : 'reject', button.dataset.reason, []);
  });
}

let boxes = [], active = null;
function setupCanvas(image, item) {
  const canvas = document.querySelector('#canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  const redraw = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, canvas.width / 500); boxes.concat(active ? [active] : []).forEach(b => ctx.strokeRect(b.x, b.y, b.w, b.h)); };
  const point = event => { const r = canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*canvas.width/r.width, y:(event.clientY-r.top)*canvas.height/r.height}; };
  canvas.onpointerdown = e => { canvas.setPointerCapture(e.pointerId); const p = point(e); active = {x:p.x,y:p.y,w:0,h:0}; redraw(); };
  canvas.onpointermove = e => { if (!active) return; const p = point(e); active.w = p.x-active.x; active.h = p.y-active.y; redraw(); };
  canvas.onpointerup = () => { if (!active) return; const b = {x:Math.min(active.x,active.x+active.w), y:Math.min(active.y,active.y+active.h), w:Math.abs(active.w), h:Math.abs(active.h)}; if (b.w > 2 && b.h > 2) boxes.push(b); active = null; redraw(); };
  boxes = []; redraw();
}
function currentBoxes() { return boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.x+b.w), Math.round(b.y+b.h)]); }
async function submitAnnotation(item, type, reason, taskBoxes) {
  const message = document.querySelector('#message'); message.textContent = 'Submitting…';
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  const payload = {...basePayload(item, position), response_type:type, reject_reason:reason, bboxes:JSON.stringify(item.attention ? {expected:'unclear_image', selected:reason, correct:reason === 'unclear_image'} : taskBoxes), num_bboxes:taskBoxes.length, image_width:document.querySelector('#image').naturalWidth, image_height:document.querySelector('#image').naturalHeight};
  try { await send(payload); position++; boxes = []; showCurrent(); } catch (error) { message.textContent = 'Submission failed. Please try again.'; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}

function finish() { app.innerHTML = '<section class="end"><h1>Thank you</h1><p>Your responses have been recorded.</p></section>'; }

async function start() {
  if (!['1','2','3'].includes(variant)) throw new Error('Use this survey with ?variant=1, ?variant=2, or ?variant=3.');
  const [tasks, clean] = await Promise.all([loadJson(`data/variants/variant-${variant}.json`), loadJson('data/clean-cases.json')]);
  const selected = [...clean].sort(() => Math.random() - .5).slice(0, 2).map(item => ({...item, type:'annotation', attention:true, prompt:`${item.prompt}\n\nSelect “unclear image” to reject this image. This is an attention question.`}));
  sequence = [...tasks.map(item => ({...item, type:'annotation'})), ...selected];
  selected.forEach(item => { const from = tasks.length ? Math.floor(Math.random() * (tasks.length + 1)) : 0; sequence.splice(from, 0, sequence.pop()); });
  intro();
}
start().catch(error => { app.innerHTML = `<section class="error"><h1>Survey configuration error</h1><p>${esc(error.message)}</p></section>`; });
